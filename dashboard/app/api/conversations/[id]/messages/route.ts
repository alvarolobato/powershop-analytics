/**
 * POST /api/conversations/:id/messages — append a message and optionally call the LLM.
 *
 * Body: { role: string, content: string, callLlm?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversationWithMessages,
  appendMessage,
  updateLastStatus,
} from "@/lib/conversations";
import { llmComplete } from "@/lib/llm-client";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

const MAX_CONTENT_CHARS = 256 * 1024;

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
  if (typeof role !== "string" || !role.trim()) {
    return NextResponse.json(
      formatApiError("El campo 'role' es obligatorio.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const rawContent = b.content;
  if (typeof rawContent !== "string" || rawContent.trim() === "") {
    return NextResponse.json(
      formatApiError("El campo 'content' es obligatorio y no puede estar vacío.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (rawContent.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      formatApiError(
        `El campo 'content' no puede superar los ${MAX_CONTENT_CHARS} caracteres.`,
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const callLlm = b.callLlm === true;

  if (callLlm && role !== "user") {
    return NextResponse.json(
      formatApiError("Solo los mensajes de usuario pueden disparar al LLM.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

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

    await appendMessage(id, { role, content: rawContent });

    if (!callLlm) {
      return NextResponse.json({ conversationId: id });
    }

    try {
      const priorMessages = [
        ...conversation.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          })),
        { role: "user" as const, content: rawContent },
      ];

      const llmResponse = await llmComplete({
        flow: "chat",
        systemPrompt: { stable: "" },
        messages: priorMessages,
        requestId,
      });

      const assistantMessage = await appendMessage(id, {
        role: "assistant",
        content: llmResponse.text,
      });
      await updateLastStatus(id, "ok");

      return NextResponse.json({ conversationId: id, assistantMessage });
    } catch (llmErr) {
      await updateLastStatus(id, "error").catch(() => {});
      console.error(`[${requestId}] POST /api/conversations/${id}/messages LLM error:`, llmErr);
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
  } catch (err) {
    console.error(`[${requestId}] POST /api/conversations/${id}/messages error:`, err);
    return NextResponse.json(
      formatApiError(
        "Error al procesar el mensaje.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
