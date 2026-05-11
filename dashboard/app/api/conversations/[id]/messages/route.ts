/**
 * POST /api/conversations/:id/messages — append a message and optionally call the LLM.
 *
 * Body: { content: string, callLlm?: boolean, flow?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  appendMessage,
  loadMessages,
  maybeGenerateTitle,
  touchConversation,
} from "@/lib/conversations";
import { llmComplete } from "@/lib/llm-client";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const MAX_CONTENT_CHARS = 10_000;

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id } = await context.params;

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
  const flowRaw = typeof b.flow === "string" ? b.flow : undefined;

  try {
    const conversation = await getConversation(id);
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

    await appendMessage(id, "user", { text: rawContent });

    if (!callLlm) {
      await touchConversation(id, "ok");
      return NextResponse.json({ ok: true });
    }

    const prior = await loadMessages(id);
    const priorMessages = prior
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

    const llmResponse = await llmComplete({
      flow: flowRaw ?? "summary",
      systemPrompt: { stable: "" },
      messages: priorMessages,
      requestId,
    });

    await appendMessage(id, "assistant", { text: llmResponse.text });
    await touchConversation(id, "ok");

    // Best-effort title generation for newly created conversations
    void maybeGenerateTitle(id, [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant", content: llmResponse.text },
    ]);

    return NextResponse.json({ message: llmResponse.text });
  } catch (err) {
    await touchConversation(id, "error").catch(() => {});
    console.error(`[${requestId}] POST /api/conversations/${id}/messages error:`, err);
    return NextResponse.json(
      formatApiError(
        "Error al procesar el mensaje.",
        "LLM_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
