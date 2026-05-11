/**
 * POST /api/conversations/:id/messages — append a message and optionally call the LLM.
 *
 * Body: { content: string, role?: "user" | "assistant" | "tool",
 *         callLlm?: boolean, flow?: string }
 *
 * - When `callLlm` is true, role defaults to "user", the LLM is invoked with the
 *   conversation history, and an assistant message is appended automatically.
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
  setInitialContext,
  touchConversation,
  type ConversationRow,
  type MessageRow,
} from "@/lib/conversations";
import type { InitialContext as ApiInitialContext } from "@/lib/conversation-types";
import { llmComplete } from "@/lib/llm-client";
import {
  getEffectiveDashboardModel,
  loadDashboardLlmConfig,
} from "@/lib/llm-provider/config";
import type { DashboardLlmFlow } from "@/lib/llm-provider/types";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

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
  let userMessage!: MessageRow;
  let priorMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const conversation: ConversationRow | null = await getConversation(id);
    if (!conversation) {
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

    if (conversation.archived_at !== null) {
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

    userMessage = await appendMessage(id, role, { text: rawContent });

    // Snapshot initial_context on the first user message of any conversation
    // (when it hasn't been set yet). The setter is idempotent — only writes
    // when initial_context IS NULL.
    if (role === "user" && conversation.initial_context === null) {
      try {
        const cfg = loadDashboardLlmConfig();
        const flow = (flowRaw ?? "summary") as DashboardLlmFlow;
        // Use the API InitialContext shape (conversation-types.ts) so the stored
        // snapshot matches what GET /api/conversations/:id returns to consumers.
        const snapshot: ApiInitialContext = {
          model: getEffectiveDashboardModel(cfg, flow),
          provider: cfg.provider,
          driver: cfg.provider === "cli" ? cfg.cliDriver : null,
          system_prompt_stable: "",
          tools: [],
          config: { flow },
        };
        await setInitialContext(id, snapshot as unknown as Parameters<typeof setInitialContext>[1]);
      } catch (snapshotErr) {
        console.warn(
          `[${requestId}] setInitialContext failed for ${id}:`,
          snapshotErr,
        );
      }
    }

    // Load message history in the DB phase so a PG failure is reported as
    // DB_ERROR rather than LLM_ERROR.
    if (callLlm) {
      const prior = await loadMessages(id);
      priorMessages = prior
        .filter((m) => m.role === "user" || m.role === "assistant")
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
  // priorMessages was loaded in the DB phase above.
  try {

    const llmResponse = await llmComplete({
      flow: flowRaw ?? "summary",
      systemPrompt: { stable: "" },
      messages: priorMessages,
      requestId,
    });

    const assistantMessage = await appendMessage(id, "assistant", {
      text: llmResponse.text,
    });
    await touchConversation(id, "ok");

    void maybeGenerateTitle(id, [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant", content: llmResponse.text },
    ]);

    return NextResponse.json({ ok: true, message: assistantMessage });
  } catch (err) {
    await touchConversation(id, "error").catch(() => {});
    console.error(`[${requestId}] POST /api/conversations/${id}/messages LLM error:`, err);
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
