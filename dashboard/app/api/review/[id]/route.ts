/**
 * GET /api/review/[id] — Get a single full weekly review by ID.
 *
 * Returns: { id, week_start, content, created_at }
 *
 * Error codes:
 *   400 — Invalid id parameter
 *   404 — Review not found
 *   503 — Database connection error
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { ConnectionError } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { getReviewById } from "@/lib/review-db";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: idParam } = await context.params;

  const id = parseInt(idParam, 10);
  if (isNaN(id) || id <= 0) {
    return NextResponse.json(
      formatApiError(
        "El parámetro 'id' debe ser un número entero positivo.",
        "VALIDATION",
        undefined,
        requestId
      ),
      { status: 400 }
    );
  }

  try {
    const review = await getReviewById(id);
    if (!review) {
      return NextResponse.json(
        formatApiError(
          `No se encontró ninguna revisión con id ${id}.`,
          "NOT_FOUND",
          undefined,
          requestId
        ),
        { status: 404 }
      );
    }
    return NextResponse.json(review);
  } catch (err) {
    if (err instanceof ConnectionError) {
      console.error(`[${requestId}] DB connection error:`, err);
      return NextResponse.json(
        formatApiError(
          "No se pudo conectar a la base de datos.",
          "DB_CONNECTION",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 503 }
      );
    }

    console.error(`[${requestId}] Error fetching review ${id}:`, err);
    return NextResponse.json(
      formatApiError(
        "Error al obtener la revisión.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId
      ),
      { status: 500 }
    );
  }
}
