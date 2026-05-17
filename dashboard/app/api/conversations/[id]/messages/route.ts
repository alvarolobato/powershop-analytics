/**
 * POST /api/conversations/:id/messages — append a message (plain persistence only).
 *
 * Body: { content: string, role?: "user" | "assistant" | "tool", logs?: unknown[] }
 *
 * LLM calls have moved to POST /api/conversations/:id/turns.
 * Passing `callLlm: true` returns 410 Gone.
 *
 * Returns: `{ ok: true, message: MessageRow }`
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  appendMessage,
  setInitialContext,
  touchConversation,
} from "@/lib/conversations";
import {
  getEffectiveDashboardModel,
  loadDashboardLlmConfig,
} from "@/lib/llm-provider/config";
import type { DashboardLlmFlow } from "@/lib/llm-provider/types";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";
import { buildFreeChatContext, buildFreeChatInitialContextSnapshot } from "@/lib/conversation-context";

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

  if (b.callLlm === true) {
    return NextResponse.json(
      formatApiError(
        "callLlm=true ya no está soportado. Usa POST /api/conversations/:id/turns para invocar el LLM.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 410 },
    );
  }

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

  const role = typeof b.role === "string" ? b.role : "user";
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json(
      formatApiError(`Rol no válido: ${role}.`, "INVALID_ROLE", undefined, requestId),
      { status: 400 },
    );
  }

  const flowRaw = typeof b.flow === "string" ? b.flow : undefined;

  try {
    const conv = await getConversation(id);
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

    const isFreeChatConv = conv.context_kind === "global" || conv.mode === "chat";
    const freeChatCtx = isFreeChatConv ? buildFreeChatContext() : null;

    const incomingLogs = Array.isArray(b.logs) ? (b.logs as unknown[]) : null;
    const userMessage = await appendMessage(id, { role, content: { text: rawContent }, logs: incomingLogs });

    // Recovery: if initial_context was never written (rare transient DB failure at
    // conversation creation), write it now so the context panel isn't blank forever.
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
      } catch (snapshotErr) {
        console.warn(`[${requestId}] setInitialContext recovery failed for ${id}:`, snapshotErr);
      }
    }

    await touchConversation(id, "ok");
    return NextResponse.json({ ok: true, message: userMessage });
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
}
