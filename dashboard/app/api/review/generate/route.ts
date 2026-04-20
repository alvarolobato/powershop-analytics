/**
 * POST /api/review/generate
 *
 * Orchestration route for the automated weekly business review:
 * 1. Resolve the **last completed ISO week** (Mon–Sun before the current week)
 * 2. Skip with 409 if a review for that week_start already exists
 * 3. Execute all predefined SQL queries for that window ($1/$2 bounds)
 * 4. Format results as text, build LLM prompt, call OpenRouter
 * 5. Parse and validate the structured review
 * 6. Persist to weekly_reviews table
 * 7. Return the full review with its DB id
 *
 * Error codes:
 *   409 — Review already stored for that closed week
 *   503 — Database connection error
 *   502 — LLM error
 *   500 — Unexpected error
 */

import { NextResponse } from "next/server";
import { query, ConnectionError, QueryTimeoutError } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { executeReviewQueries, formatAllResults } from "@/lib/review-queries";
import { buildReviewPrompt } from "@/lib/review-prompts";
import { generateReview, BudgetExceededError } from "@/lib/llm";
import { saveReview } from "@/lib/review-db";

// Allow up to 90 seconds for the full review generation flow
export const maxDuration = 90;

export async function POST(): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    // 1. Last **completed** ISO week: Monday = DATE_TRUNC('week', today) - 7 days
    const boundsRes = await query(
      `SELECT
         TO_CHAR((DATE_TRUNC('week', CURRENT_DATE::timestamp) - INTERVAL '7 days')::date, 'YYYY-MM-DD') AS week_start,
         TO_CHAR((DATE_TRUNC('week', CURRENT_DATE::timestamp) - INTERVAL '1 day')::date, 'YYYY-MM-DD') AS week_end_sunday,
         TO_CHAR(DATE_TRUNC('week', CURRENT_DATE::timestamp)::date, 'YYYY-MM-DD') AS week_end_exclusive`
    );
    const weekStartStr = String(boundsRes.rows[0]?.[0] ?? "");
    const weekEndSundayStr = String(boundsRes.rows[0]?.[1] ?? "");
    const weekEndExclusiveStr = String(boundsRes.rows[0]?.[2] ?? "");
    if (!weekStartStr || !weekEndExclusiveStr) {
      return NextResponse.json(
        formatApiError(
          "No se pudo calcular la semana de análisis.",
          "UNKNOWN",
          undefined,
          requestId,
        ),
        { status: 500 },
      );
    }

    // 2. Do not regenerate if this closed week was already analyzed
    const existingRes = await query(
      `SELECT id FROM weekly_reviews WHERE week_start = $1::date ORDER BY id DESC LIMIT 1`,
      [weekStartStr],
    );
    const existingId = existingRes.rows[0]?.[0];
    if (existingId != null && existingId !== undefined) {
      return NextResponse.json(
        {
          ...formatApiError(
            "Ya existe una revisión para la última semana cerrada. Ábrala desde el historial; no se volverá a generar hasta una nueva semana completa.",
            "REVIEW_EXISTS",
            undefined,
            requestId,
          ),
          existing_id: Number(existingId),
          week_start: weekStartStr,
        },
        { status: 409 },
      );
    }

    // 3. Execute all predefined SQL queries (partial failures are tolerated)
    const queryResults = await executeReviewQueries(
      (sql, params) => query(sql, params),
      weekStartStr,
      weekEndExclusiveStr,
    );

    // 4. Format query results as text for the LLM
    const formattedResults = formatAllResults(queryResults);

    const reviewedWeekDescription =
      `Los resultados corresponden a la **semana ISO cerrada** del **${weekStartStr}** (lunes) al **${weekEndSundayStr}** (domingo). ` +
      `La semana en curso no se incluye (sigue en progreso).`;

    // 5. Build the LLM prompt
    const systemPrompt = buildReviewPrompt(formattedResults, reviewedWeekDescription);

    // 6. Call the LLM
    let reviewContent;
    try {
      reviewContent = await generateReview(systemPrompt);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return NextResponse.json(
          formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId),
          { status: 429 },
        );
      }
      console.error(`[${requestId}] LLM error during review generation:`, err);
      return NextResponse.json(
        formatApiError(
          "Error al generar la revisión con el modelo de IA. Inténtalo de nuevo.",
          "LLM_ERROR",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 502 }
      );
    }

    // Ensure generated_at is set
    if (!reviewContent.generated_at) {
      reviewContent.generated_at = new Date().toISOString();
    }

    let reviewId: number;
    try {
      reviewId = await saveReview(weekStartStr, reviewContent);
    } catch (err) {
      console.error(`[${requestId}] Error saving review to DB:`, err);
      // Return review even if persistence fails — the user still gets value
      return NextResponse.json(
        { review: { ...reviewContent, id: null, week_start: weekStartStr } },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        review: {
          ...reviewContent,
          id: reviewId,
          week_start: weekStartStr,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof ConnectionError) {
      console.error(`[${requestId}] DB connection error:`, err);
      return NextResponse.json(
        formatApiError(
          "No se pudo conectar a la base de datos. Inténtalo de nuevo más tarde.",
          "DB_CONNECTION",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 503 }
      );
    }
    if (err instanceof QueryTimeoutError) {
      console.error(`[${requestId}] Query timeout:`, err);
      return NextResponse.json(
        formatApiError(
          "Las consultas tardaron demasiado. Inténtalo de nuevo.",
          "TIMEOUT",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 503 }
      );
    }

    console.error(`[${requestId}] Unexpected error in review generation:`, err);
    return NextResponse.json(
      formatApiError(
        "Error inesperado al generar la revisión.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId
      ),
      { status: 500 }
    );
  }
}
