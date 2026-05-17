/**
 * POST /api/conversations/:id/messages — append a message and optionally call the LLM.
 *
 * Body: { content: string, role?: "user" | "assistant" | "tool",
 *         callLlm?: boolean, flow?: string }
 *
 * - When `callLlm` is true, role defaults to "user", the LLM is invoked with the
 *   conversation history, and an assistant message is appended automatically.
 *   For `context_kind='global'` (free-chat) conversations, the full agentic runner
 *   is used with FREE_CHAT_TOOLS and the data knowledge system prompt.
 * - When `callLlm` is false (default), the message is appended verbatim with the
 *   provided role (defaults to "user"). callLlm=true with role≠"user" is rejected.
 *
 * Returns:
 *   - `{ ok: true, message: MessageRow }` when callLlm=false
 *   - `{ ok: true, message: MessageRow }` (the assistant row) when callLlm=true
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  appendMessage,
  loadMessages,
  maybeGenerateTitle,
  touchConversation,
  type ConversationRow,
  type MessageRow,
} from "@/lib/conversations";
import {
  getEffectiveDashboardModel,
  getEffectiveOpenRouterProvider,
  loadDashboardLlmConfig,
} from "@/lib/llm-provider/config";
import type { DashboardLlmFlow } from "@/lib/llm-provider/types";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";
import { buildFreeChatContext, type FreeChatContext } from "@/lib/conversation-context";
import {
  runAgenticChat,
  AgenticRunnerError,
} from "@/lib/llm-tools/runner";
import { createDashboardAgenticAdapter } from "@/lib/llm-client";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { buildAgenticErrorDiagnostic, persistAgenticError } from "@/lib/llm-tools/diagnostic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const MAX_CONTENT_CHARS = 10_000;
const ID_PATTERN = /^[a-f0-9]{12}$/;
const VALID_ROLES = new Set(["user", "assistant", "tool"]);

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id } = await context.params;

  if (!ID_PATTERN.test(id)) {
    return NextResponse.json(
      formatApiError("ID de conversación no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("El cuerpo de la solicitud no es JSON válido.", "INVALID_BODY", undefined, requestId),
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError("El cuerpo debe ser un objeto JSON.", "INVALID_BODY", undefined, requestId),
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;
  const rawContent = b.content;

  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    return NextResponse.json(
      formatApiError(
        "El campo 'content' es obligatorio y no puede estar vacío.",
        "MISSING_CONTENT",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  if (rawContent.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      formatApiError(
        `El campo 'content' no puede superar los ${MAX_CONTENT_CHARS} caracteres.`,
        "CONTENT_TOO_LONG",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const callLlm = b.callLlm === true;
  const role = typeof b.role === "string" ? b.role : "user";
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json(
      formatApiError(`Rol no válido: ${role}.`, "INVALID_ROLE", undefined, requestId),
      { status: 400 },
    );
  }
  if (callLlm && role !== "user") {
    return NextResponse.json(
      formatApiError(
        "callLlm=true sólo es válido para mensajes con role='user'.",
        "INVALID_ROLE",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }
  const flowRaw = typeof b.flow === "string" ? b.flow : undefined;

  // ── DB phase: load conversation, append user message, load history ────────────
  let conversation!: ConversationRow;
  let userMessage!: MessageRow;
  let priorMessages: ChatCompletionMessageParam[] = [];
  // Hoisted so both the initial_context snapshot (first message) and the LLM
  // phase share a single classification and a single buildFreeChatContext() call.
  let isFreeChatConv = false;
  let freeChatCtx: FreeChatContext | null = null;
  try {
    const conv: ConversationRow | null = await getConversation(id);
    if (!conv) {
      return NextResponse.json(
        formatApiError(
          "Conversación no encontrada.",
          "NOT_FOUND",
          `No existe ninguna conversación con ID ${id}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    if (conv.archived_at !== null) {
      return NextResponse.json(
        formatApiError(
          "La conversación está archivada y no acepta nuevos mensajes.",
          "CONVERSATION_ARCHIVED",
          undefined,
          requestId,
        ),
        { status: 409 },
      );
    }
    conversation = conv;
    // Intentional ||: a conversation is free-chat when context_kind='global'
    // (the primary marker, always set today) OR when mode='chat' (forward-compat
    // for future named chat variants). Both conditions are currently always true
    // together for global conversations, so the || has no practical effect; it is
    // deliberate breadth — either signal alone should route to the agentic path.
    isFreeChatConv = conv.context_kind === "global" || conv.mode === "chat";
    // Build once here; reused by the initial_context snapshot below and the LLM
    // runner later in the same request, avoiding a second call on first messages.
    if (isFreeChatConv) freeChatCtx = buildFreeChatContext();

    userMessage = await appendMessage(id, role, { text: rawContent });

    // initial_context is now always set at conversation creation time in
    // POST /api/conversations — no fallback needed here.

    // Load message history in the DB phase so a PG failure is reported as
    // DB_ERROR rather than LLM_ERROR.
    if (callLlm) {
      const prior = await loadMessages(id);
      // Build full prior message history, excluding the just-appended user
      // message by its ID (safer than positional slicing under concurrent load).
      priorMessages = prior
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.id !== userMessage.id)
        .map((m) => {
          const c = m.content;
          const text =
            typeof c === "string"
              ? c
              : c !== null &&
                  typeof c === "object" &&
                  !Array.isArray(c) &&
                  typeof (c as Record<string, unknown>).text === "string"
                ? ((c as Record<string, unknown>).text as string)
                : JSON.stringify(c);
          return { role: m.role as "user" | "assistant", content: text };
        });
    }
  } catch (err) {
    await touchConversation(id, "error").catch(() => {});
    console.error(`[${requestId}] POST /api/conversations/${id}/messages DB error:`, err);
    return NextResponse.json(
      formatApiError(
        "Error de base de datos al procesar el mensaje.",
        "DB_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }

  if (!callLlm) {
    await touchConversation(id, "ok");
    return NextResponse.json({ ok: true, message: userMessage });
  }

  // ── LLM phase: call model, append assistant message ──────────────────────────
  // priorMessages was loaded in the DB phase above (all messages except the
  // latest user message, which is passed as userContent).
  try {
    let assistantText: string;

    if (isFreeChatConv && freeChatCtx) {
      // Free-chat: use the full agentic runner with FREE_CHAT_TOOLS and the
      // data knowledge system prompt so the LLM can inspect tables and dashboards.
      const cfg = loadDashboardLlmConfig();
      const model = getEffectiveDashboardModel(cfg);
      const openRouterProvider = getEffectiveOpenRouterProvider(cfg);
      const adapter = createDashboardAgenticAdapter();

      const agenticCtx: LlmAgenticContext = {
        requestId,
        endpoint: "freeChat",
        conversationId: id,
        llmProvider: cfg.provider,
        llmDriver: cfg.provider === "cli" ? cfg.cliDriver : null,
      };

      const { content } = await runAgenticChat({
        adapter,
        model,
        openRouterProvider,
        systemPrompt: freeChatCtx.systemPrompt.stable,
        userContent: rawContent,
        ctx: agenticCtx,
        temperature: 0.3,
        maxTokens: 4096,
        priorMessages,
        tools: freeChatCtx.tools,
      });
      assistantText = content;
    } else {
      // Non-free-chat fallback: single-shot completion without tools.
      // (generate/modify/analyze routes handle their own LLM calls.)
      const { llmComplete } = await import("@/lib/llm-client");
      const llmResponse = await llmComplete({
        flow: flowRaw ?? "summary",
        systemPrompt: { stable: "" },
        messages: priorMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        requestId,
      });
      assistantText = llmResponse.text;
    }

    const assistantMessage = await appendMessage(id, "assistant", {
      text: assistantText,
    });
    await touchConversation(id, "ok");

    void maybeGenerateTitle(id, [
      ...priorMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      { role: "user" as const, content: rawContent },
      { role: "assistant" as const, content: assistantText },
    ]);

    return NextResponse.json({ ok: true, message: assistantMessage });
  } catch (err) {
    await touchConversation(id, "error").catch(() => {});
    console.error(`[${requestId}] POST /api/conversations/${id}/messages LLM error:`, err);

    if (err instanceof AgenticRunnerError) {
      const cfg = loadDashboardLlmConfig();
      const diagnostic = buildAgenticErrorDiagnostic(err, cfg);
      persistAgenticError("freeChat", err, diagnostic);
      return NextResponse.json(
        formatApiError(
          "El flujo de IA con herramientas no pudo completarse. Reformula el mensaje o inténtalo de nuevo.",
          "AGENTIC_RUNNER",
          diagnostic.subError,
          err.requestId,
          diagnostic,
        ),
        { status: 500 },
      );
    }

    return NextResponse.json(
      formatApiError(
        "Error al procesar la respuesta del LLM.",
        "LLM_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
