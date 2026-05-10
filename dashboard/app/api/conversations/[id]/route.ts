/**
 * GET    /api/conversations/:id — fetch single conversation
 * PATCH  /api/conversations/:id — partial update (title, archived)
 * DELETE /api/conversations/:id — 405 Method Not Allowed (no hard deletion)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversationWithMessages,
  updateConversation,
} from "@/lib/conversations";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id } = await context.params;

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
    return NextResponse.json(conversation);
  } catch (err) {
    console.error(`[${requestId}] GET /api/conversations/${id} error:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo cargar la conversación.",
        "DB_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
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
  const updates: { title?: string; archived?: boolean } = {};

  if ("title" in b) {
    if (typeof b.title !== "string") {
      return NextResponse.json(
        formatApiError("El campo 'title' debe ser una cadena de texto.", "VALIDATION", undefined, requestId),
        { status: 400 },
      );
    }
    if (b.title.length > 500) {
      return NextResponse.json(
        formatApiError("El campo 'title' no puede superar los 500 caracteres.", "VALIDATION", undefined, requestId),
        { status: 400 },
      );
    }
    const trimmed = b.title.trim();
    if (trimmed) updates.title = trimmed;
  }

  if ("archived" in b) {
    if (typeof b.archived !== "boolean") {
      return NextResponse.json(
        formatApiError("El campo 'archived' debe ser booleano.", "VALIDATION", undefined, requestId),
        { status: 400 },
      );
    }
    updates.archived = b.archived;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      formatApiError("No se proporcionaron campos para actualizar.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  try {
    const result = await updateConversation(id, updates);
    if (!result) {
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
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[${requestId}] PATCH /api/conversations/${id} error:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo actualizar la conversación.",
        "DB_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}

// ── DELETE — intentionally disallowed ─────────────────────────────────────────

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json(
    formatApiError(
      "Las conversaciones no pueden eliminarse. Usa archive para archivarlas.",
      "METHOD_NOT_ALLOWED",
    ),
    { status: 405, headers: { Allow: "GET, PATCH" } },
  );
}
