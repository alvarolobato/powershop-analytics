/**
 * GET /api/review — List past weekly reviews (summary only).
 *
 * Returns: Array of { id, week_start, executive_summary, created_at }
 *
 * Error codes:
 *   503 — Database connection error
 *   500 — Unexpected error
 */

import { NextResponse } from "next/server";
import { ConnectionError } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { getReviews } from "@/lib/review-db";

export async function GET(): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    const reviews = await getReviews();
    return NextResponse.json(reviews);
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

    console.error(`[${requestId}] Error listing reviews:`, err);
    return NextResponse.json(
      formatApiError(
        "Error al obtener las revisiones.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId
      ),
      { status: 500 }
    );
  }
}
