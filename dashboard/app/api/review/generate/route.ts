/**
 * POST /api/review/generate — Generate or regenerate a weekly business review (v2).
 *
 * Body (JSON, optional):
 *   week_start?: "YYYY-MM-DD" (default: last completed ISO week)
 *   regenerate?: boolean (default false)
 *   mode?: "refresh_data" | "alternate_angle" (required when regenerate=true)
 */

import { NextRequest, NextResponse } from "next/server";
import { query, ConnectionError, QueryTimeoutError } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { executeReviewQueries, formatAllResults, type ReviewQueryResult } from "@/lib/review-queries";
import { buildReviewPrompt } from "@/lib/review-prompts";
import { generateReview, BudgetExceededError } from "@/lib/llm";
import {
  getLatestReviewIdForWeek,
  getMaxRevisionForWeek,
  saveReview,
} from "@/lib/review-db";
import { replaceActionsFromReviewContent } from "@/lib/review-actions-db";
import { addDaysIso } from "@/lib/review-dashboard-links";
import { getOrCreateReviewDashboardId } from "@/lib/review-dashboard-seed";
import { buildDashboardReviewHref } from "@/lib/review-dashboard-links";
import { enrichReviewContent, computeQueryFailureRate } from "@/lib/review-evidence";
import type { ReviewContent } from "@/lib/review-schema";
import { REVIEW_DASHBOARD_KEYS } from "@/lib/review-schema";

export const maxDuration = 90;

interface GenerateBody {
  week_start?: string;
  regenerate?: boolean;
  mode?: "refresh_data" | "alternate_angle";
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  const started = Date.now();

  let body: GenerateBody = {};
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    body = {};
  }

  const regenerate = Boolean(body.regenerate);
  const mode = body.mode;
  if (regenerate && (mode !== "refresh_data" && mode !== "alternate_angle")) {
    return NextResponse.json(
      formatApiError(
        "Si regenerate=true, mode debe ser refresh_data o alternate_angle.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  try {
    let weekStartStr: string;
    if (body.week_start) {
      if (!isIsoDate(body.week_start)) {
        return NextResponse.json(
          formatApiError("week_start debe ser YYYY-MM-DD.", "VALIDATION", undefined, requestId),
          { status: 400 },
        );
      }
      weekStartStr = body.week_start;
    } else {
      const boundsRes = await query(
        `SELECT TO_CHAR((DATE_TRUNC('week', CURRENT_DATE::timestamp) - INTERVAL '7 days')::date, 'YYYY-MM-DD') AS week_start`,
      );
      weekStartStr = String(boundsRes.rows[0]?.[0] ?? "");
      if (!weekStartStr) {
        return NextResponse.json(
          formatApiError("No se pudo calcular la semana de análisis.", "UNKNOWN", undefined, requestId),
          { status: 500 },
        );
      }
    }

    const weekEndSundayStr = addDaysIso(weekStartStr, 6);
    const weekEndExclusiveStr = addDaysIso(weekStartStr, 7);

    const latestId = await getLatestReviewIdForWeek(weekStartStr);

    if (!regenerate && latestId != null) {
      return NextResponse.json(
        {
          ...formatApiError(
            "Ya existe una revisión para esa semana. Use regenerate=true para crear una nueva versión.",
            "REVIEW_EXISTS",
            undefined,
            requestId,
          ),
          existing_id: latestId,
          week_start: weekStartStr,
        },
        { status: 409 },
      );
    }

    if (regenerate && latestId == null) {
      return NextResponse.json(
        formatApiError(
          "No existe ninguna revisión previa para esa semana; no se puede regenerar.",
          "NOT_FOUND",
          undefined,
          requestId,
        ),
        { status: 404 },
      );
    }

    const generationMode: "initial" | "refresh_data" | "alternate_angle" = regenerate
      ? (mode as "refresh_data" | "alternate_angle")
      : "initial";

    const queryResults: ReviewQueryResult[] = await executeReviewQueries(
      (sql, params) => query(sql, params),
      weekStartStr,
      weekEndExclusiveStr,
    );

    const failureRate = computeQueryFailureRate(queryResults);
    const failedNames = queryResults.filter((r) => r.error || !r.result).map((r) => r.query.name);

    const formattedResults = formatAllResults(queryResults);

    const reviewedWeekDescription =
      `Los resultados corresponden a la **semana ISO cerrada** del **${weekStartStr}** (lunes) al **${weekEndSundayStr}** (domingo). ` +
      `La semana en curso no se incluye (sigue en progreso).`;

    const systemPrompt = buildReviewPrompt(
      formattedResults,
      reviewedWeekDescription,
      generationMode,
    );

    let llmOut;
    try {
      llmOut = await generateReview(systemPrompt);
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
          requestId,
        ),
        { status: 502 },
      );
    }

    const generatedAt = llmOut.generated_at || new Date().toISOString();

    let content: ReviewContent = {
      review_schema_version: 2,
      executive_summary: llmOut.executive_summary,
      sections: llmOut.sections.map((s) => ({ ...s })),
      action_items: llmOut.action_items.map((a) => ({
        ...a,
        owner_name: "",
      })),
      data_quality_notes: [...llmOut.data_quality_notes],
      generated_at: generatedAt,
      quality_status: failureRate > 0.3 ? "degraded" : "ok",
    };

    if (failureRate > 0.3) {
      content.data_quality_notes.push(
        `Calidad degradada: ${Math.round(failureRate * 100)}% de consultas fallaron o sin resultado (${failedNames.join(", ") || "n/a"}).`,
      );
    }

    const dashboardUrls: Record<string, string> = {};
    for (const key of REVIEW_DASHBOARD_KEYS) {
      const dashId = await getOrCreateReviewDashboardId(key);
      dashboardUrls[key] = buildDashboardReviewHref(dashId, weekStartStr, weekEndSundayStr);
    }

    content = enrichReviewContent(content, queryResults, dashboardUrls);

    const nextRevision = (await getMaxRevisionForWeek(weekStartStr)) + 1;
    const supersedes = regenerate ? latestId : null;

    const durationMs = Date.now() - started;
    console.info(
      JSON.stringify({
        event: "review_generate",
        requestId,
        week_start: weekStartStr,
        revision: nextRevision,
        mode: generationMode,
        regenerate,
        query_failures: failedNames.length,
        query_total: queryResults.length,
        duration_ms: durationMs,
      }),
    );

    let reviewId: number;
    try {
      reviewId = await saveReview({
        weekStart: weekStartStr,
        windowStart: weekStartStr,
        windowEnd: weekEndSundayStr,
        revision: nextRevision,
        generationMode,
        supersedesReviewId: supersedes,
        content,
      });
      await replaceActionsFromReviewContent(reviewId, content);
    } catch (err) {
      console.error(`[${requestId}] Error saving review to DB:`, err);
      return NextResponse.json(
        formatApiError(
          "La revisión se generó, pero no se pudo guardar. Inténtalo de nuevo más tarde.",
          "REVIEW_PERSISTENCE",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        review: {
          ...content,
          id: reviewId,
          week_start: weekStartStr,
          revision: nextRevision,
          generation_mode: generationMode,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof ConnectionError) {
      console.error(`[${requestId}] DB connection error:`, err);
      return NextResponse.json(
        formatApiError(
          "No se pudo conectar a la base de datos. Inténtalo de nuevo más tarde.",
          "DB_CONNECTION",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 503 },
      );
    }
    if (err instanceof QueryTimeoutError) {
      console.error(`[${requestId}] Query timeout:`, err);
      return NextResponse.json(
        formatApiError(
          "Las consultas tardaron demasiado. Inténtalo de nuevo.",
          "TIMEOUT",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 503 },
      );
    }

    console.error(`[${requestId}] Unexpected error in review generation:`, err);
    return NextResponse.json(
      formatApiError(
        "Error inesperado al generar la revisión.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
