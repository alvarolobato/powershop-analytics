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
 *   - NDJSON stream (Content-Type: application/x-ndjson) when callLlm=true:
 *     - `{ type:"progress", requestId, logLine }` — progress frames
 *     - `{ type:"result", requestId, message: MessageRow }` — the assistant row
 *     - `{ type:"error", requestId, httpStatus, error, code }` — on failure
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  appendMessage,
  loadMessages,
  maybeGenerateTitle,
  setInitialContext,
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
import { buildFreeChatContext, buildFreeChatInitialContextSnapshot, type FreeChatContext } from "@/lib/conversation-context";
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

    // Accept logs only on the callLlm=false path (they're passed by the client
    // when persisting an assistant message that was already generated locally).
    const incomingLogs = !callLlm && Array.isArray(b.logs) ? (b.logs as unknown[]) : null;
    userMessage = await appendMessage(id, { role, content: { text: rawContent }, logs: incomingLogs });

    // initial_context is always set at conversation creation time in
    // POST /api/conversations. Guard here for the rare case where the
    // creation-time snapshot write failed (transient DB error) — if it did,
    // the "Contexto original" panel would stay blank forever without this
    // idempotent recovery path. setInitialContext is a no-op when the field
    // is already set (Copilot review on the conversations/route.ts change).
    if (role === "user" && conv.initial_context === null) {
      try {
        const cfg = loadDashboardLlmConfig();
        const flow = (flowRaw ?? conv.mode ?? "chat") as DashboardLlmFlow;
        if (isFreeChatConv && freeChatCtx) {
          await setInitialContext(id, buildFreeChatInitialContextSnapshot());
        } else {
          await setInitialContext(id, {
            model: getEffectiveDashboardModel(cfg, flow),
            provider: cfg.provider,
            driver: cfg.provider === "cli" ? cfg.cliDriver : null,
            system_prompt_stable: "",
            tools: [],
            config: { flow },
          });
        }
      } catch {
        // best-effort recovery — don't fail the message write
      }
    }

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

  // ── LLM phase: stream NDJSON response ────────────────────────────────────────
  // priorMessages was loaded in the DB phase above (all messages except the
  // latest user message, which is passed as userContent).
  //
  // We return an NDJSON stream so ConversationViewer can show a loading
  // indicator while the LLM is processing and receive the result frame
  // without a full page reload / poll cycle.
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        // Emit a progress frame so the client knows we started.
        enqueue({ type: "progress", requestId, logLine: { kind: "step", text: "Procesando…", elapsed: 0 } });

        // ── Determine system prompt (Feature 4: dashboard context) ────────────
        let systemPrompt = freeChatCtx?.systemPrompt.stable ?? "";

        const conv = conversation; // already loaded in DB phase
        const isDashboardConv =
          conv.context_kind === "dashboard" &&
          (conv.mode === "analyze" || conv.mode === "modify") &&
          conv.context_ref;

        if (isDashboardConv) {
          try {
            const { sql: sqlRead } = await import("@/lib/db-write");
            const specRows = await sqlRead<{ spec: unknown }>(
              `SELECT spec FROM dashboards WHERE id = $1`,
              [parseInt(conv.context_ref!, 10)],
            ).catch(() => [] as { spec: unknown }[]);
            const spec = specRows[0]?.spec;
            systemPrompt = spec
              ? `Eres un asistente de análisis para el cuadro de mandos. El cuadro contiene la siguiente configuración:\n\n${JSON.stringify(spec, null, 2)}\n\nResponde en español sobre los datos y configuración de este cuadro de mandos.`
              : freeChatCtx?.systemPrompt.stable ?? "";
          } catch {
            // best-effort — fall back to free-chat system prompt
          }
        }

        // ── Call LLM ─────────────────────────────────────────────────────────
        let assistantText: string;

        if (isFreeChatConv && freeChatCtx) {
          // Free-chat: use the full agentic runner with FREE_CHAT_TOOLS.
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
          // Non-free-chat: single-shot completion (generate/modify/analyze
          // routes handle their own LLM calls; this handles dashboard chat).
          const { llmComplete } = await import("@/lib/llm-client");
          const llmResponse = await llmComplete({
            flow: flowRaw ?? "summary",
            systemPrompt: { stable: systemPrompt },
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

        enqueue({ type: "result", requestId, message: assistantMessage });
        controller.close();
      } catch (err) {
        await touchConversation(id, "error").catch(() => {});
        console.error(`[${requestId}] POST /api/conversations/${id}/messages LLM error:`, err);

        if (err instanceof AgenticRunnerError) {
          const cfg = loadDashboardLlmConfig();
          const diagnostic = buildAgenticErrorDiagnostic(err, cfg);
          persistAgenticError("freeChat", err, diagnostic);
          enqueue({
            type: "error",
            requestId: err.requestId ?? requestId,
            httpStatus: 500,
            error: "El flujo de IA con herramientas no pudo completarse. Reformula el mensaje o inténtalo de nuevo.",
            code: "AGENTIC_RUNNER",
            details: diagnostic.subError,
            diagnostic,
          });
        } else {
          enqueue({
            type: "error",
            requestId,
            httpStatus: 500,
            error: "Error al procesar la respuesta del LLM.",
            code: "LLM_ERROR",
            details: sanitizeErrorMessage(err),
          });
        }
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
