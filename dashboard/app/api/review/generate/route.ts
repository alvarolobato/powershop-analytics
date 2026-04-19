/**
 * POST /api/review/generate
 *
 * Orchestration route for the automated weekly business review:
 * 1. Execute all predefined SQL queries
 * 2. Format results as text
 * 3. Build LLM prompt
 * 4. Call OpenRouter LLM (Claude)
 * 5. Parse and validate the structured review
 * 6. Persist to weekly_reviews table
 * 7. Return the full review with its DB id
 *
 * Error codes:
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
    // 1. Execute all predefined SQL queries (partial failures are tolerated)
    const queryResults = await executeReviewQueries(query);

    // 2. Format query results as text for the LLM
    const formattedResults = formatAllResults(queryResults);

    // 3. Build the LLM prompt
    const systemPrompt = buildReviewPrompt(formattedResults);

    // 4. Call the LLM
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

    // 5. Determine the Monday of the current week using PostgreSQL
    // (avoids timezone mismatches between Node.js and the DB)
    const weekStartResult = await query(
      `SELECT TO_CHAR(DATE_TRUNC('week', CURRENT_DATE)::date, 'YYYY-MM-DD') AS week_start`
    );
    const weekStartStr = (weekStartResult.rows[0]?.[0] as string | undefined) ?? new Date().toISOString().split("T")[0];

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
