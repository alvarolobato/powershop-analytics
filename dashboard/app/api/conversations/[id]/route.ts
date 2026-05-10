/**
 * GET    /api/conversations/:id — fetch single conversation
 * PATCH  /api/conversations/:id — partial update (title, archived)
 * DELETE /api/conversations/:id — 405 Method Not Allowed (no hard deletion)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getConversation,
  getConversationWithMessages,
  updateConversationTitle,
  setConversationArchived,
} from "@/lib/conversations";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

// Lowercase 12-char hex (6 random bytes). Matches generateConversationId().
const ID_PATTERN = /^[a-f0-9]{12}$/;

function rejectInvalidId(id: string, requestId: string): NextResponse | null {
  if (ID_PATTERN.test(id)) return null;
  return NextResponse.json(
    formatApiError("ID de conversación no válido.", "VALIDATION", undefined, requestId),
    { status: 400 },
  );
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id } = await context.params;
  const invalid = rejectInvalidId(id, requestId);
  if (invalid) return invalid;

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
  const invalid = rejectInvalidId(id, requestId);
  if (invalid) return invalid;

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

  try {
    const existing = await getConversation(id);
    if (!existing) {
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

    if (typeof b.title === "string" && b.title.trim() !== "") {
      await updateConversationTitle(id, b.title);
    }

    if (typeof b.archived === "boolean") {
      await setConversationArchived(id, b.archived);
    }

    const updated = await getConversation(id);
    return NextResponse.json(updated);
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
