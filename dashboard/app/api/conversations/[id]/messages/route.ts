/**
 * POST /api/conversations/:id/messages — append a message and optionally call the LLM.
 *
 * Body: { role, content, callLlm?: boolean, flow?: string }
 *
 * When callLlm=true: calls llmComplete and appends both the user message and
 * the resulting assistant message. On the first user message in a conversation,
 * snapshots initial_context (system prompt, tools, model/provider/driver).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversationWithMessages,
  appendMessage,
  setInitialContext,
  updateLastStatus,
} from "@/lib/conversations";
import { llmComplete } from "@/lib/llm-client";
import { loadDashboardLlmConfig, getEffectiveDashboardModel } from "@/lib/llm-provider/config";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";
import type { DashboardLlmFlow } from "@/lib/llm-provider/types";

const VALID_LLM_FLOWS: ReadonlySet<string> = new Set<DashboardLlmFlow>(["generate", "modify", "analyze", "weekly"]);

type RouteContext = { params: Promise<{ id: string }> };

function validateId(raw: string): string | null {
  return /^[a-f0-9]{12}$/.test(raw) ? raw : null;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: rawId } = await context.params;
  const id = validateId(rawId);
  if (!id) {
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
      formatApiError("El cuerpo de la solicitud no es JSON válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError("El cuerpo debe ser un objeto JSON.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;

  const role = b.role;
  if (typeof role !== "string" || !["user", "assistant", "tool"].includes(role)) {
    return NextResponse.json(
      formatApiError(
        "El campo 'role' debe ser 'user', 'assistant' o 'tool'.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  if (!("content" in b) || b.content === null || b.content === undefined) {
    return NextResponse.json(
      formatApiError("El campo 'content' es obligatorio y no puede ser nulo.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const MAX_CONTENT_BYTES = 256 * 1024;
  if (Buffer.byteLength(JSON.stringify(b.content), "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      formatApiError("El campo 'content' supera el límite de 256 KB.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const callLlm = b.callLlm === true;
  if (callLlm && role !== "user") {
    return NextResponse.json(
      formatApiError(
        "callLlm solo puede ser true cuando role es 'user'.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const rawFlow = typeof b.flow === "string" ? b.flow : undefined;
  const flow: DashboardLlmFlow | undefined =
    rawFlow !== undefined && VALID_LLM_FLOWS.has(rawFlow)
      ? (rawFlow as DashboardLlmFlow)
      : undefined;

  try {
    const conversation = await getConversationWithMessages(id);
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

    if (conversation.archived_at) {
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

    const isFirstUserMessage =
      role === "user" && conversation.messages.filter((m) => m.role === "user").length === 0;

    const userMessage = await appendMessage(id, {
      role,
      content: b.content,
    });

    if (isFirstUserMessage && conversation.initial_context === null) {
      try {
        const cfg = loadDashboardLlmConfig();
        const model = getEffectiveDashboardModel(cfg, flow);
        await setInitialContext(id, {
          model,
          provider: cfg.provider,
          driver: cfg.provider === "cli" ? cfg.cliDriver : null,
          systemPrompt: { stable: "", volatile: undefined },
          tools: [],
        });
      } catch (ctxErr) {
        console.warn(`[${requestId}] Could not snapshot initial_context for ${id}:`, ctxErr);
      }
    }

    if (!callLlm) {
      return NextResponse.json({ message: userMessage, conversationId: id });
    }

    // Build prior turns from existing messages (before the one we just added)
    const priorMessages = conversation.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const rawContent = m.content;
        const text =
          typeof rawContent === "string"
            ? rawContent
            : typeof rawContent === "object" &&
                rawContent !== null &&
                !Array.isArray(rawContent) &&
                typeof (rawContent as Record<string, unknown>).text === "string"
              ? (rawContent as Record<string, unknown>).text as string
              : JSON.stringify(rawContent);
        return { role: m.role as "user" | "assistant", content: text };
      });

    const userContent =
      typeof b.content === "string"
        ? b.content
        : typeof b.content === "object" &&
            b.content !== null &&
            !Array.isArray(b.content) &&
            typeof (b.content as Record<string, unknown>).text === "string"
          ? (b.content as Record<string, unknown>).text as string
          : JSON.stringify(b.content);

    priorMessages.push({ role: "user", content: userContent });

    let llmResponse;
    try {
      llmResponse = await llmComplete({
        flow: flow ?? "summary",
        systemPrompt: { stable: "" },
        messages: priorMessages,
        requestId,
      });
    } catch (llmErr) {
      await updateLastStatus(id, "error");
      console.error(`[${requestId}] llmComplete error for conversation ${id}:`, llmErr);
      return NextResponse.json(
        formatApiError(
          "Error al llamar al LLM.",
          "LLM_ERROR",
          sanitizeErrorMessage(llmErr),
          requestId,
        ),
        { status: 500 },
      );
    }

    const { usage } = llmResponse;
    const assistantMessage = await appendMessage(id, {
      role: "assistant",
      content: llmResponse.text,
      tokens_input: usage.prompt_tokens,
      tokens_output: usage.completion_tokens,
      tokens_cache_read: usage.cache_read_input_tokens ?? undefined,
      tokens_cache_creation: usage.cache_creation_input_tokens ?? undefined,
    });

    await updateLastStatus(id, "ok");

    return NextResponse.json({
      userMessage,
      assistantMessage,
      conversationId: id,
    });
  } catch (err) {
    console.error(`[${requestId}] POST /api/conversations/${rawId}/messages error:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo procesar el mensaje.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
