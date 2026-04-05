"use client";

/**
 * Revisión Semanal — AI-generated weekly business review page.
 *
 * States:
 *   - list: shows past reviews and "Generar revisión" button
 *   - loading: skeleton while generating
 *   - review: shows the generated/loaded review via ReviewDisplay
 *   - error: shows ErrorDisplay
 */

import { useState, useEffect, useCallback } from "react";
import ReviewDisplay from "@/components/ReviewDisplay";
import ErrorDisplay from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import type { ReviewContent } from "@/lib/review-prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewSummary {
  id: number;
  week_start: string;
  executive_summary: string;
  created_at: string;
}

interface FullReview extends ReviewContent {
  id: number | null;
  week_start: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeekDate(dateStr: string): string {
  try {
    // dateStr is YYYY-MM-DD (Monday of that week)
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatRelativeTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 2) return "hace un momento";
    if (diffMins < 60) return `hace ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `hace ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `hace ${diffDays} días`;
  } catch {
    return isoStr;
  }
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" role="status">
      <p className="text-sm text-tremor-content dark:text-dark-tremor-content text-center py-2">
        Generando revisión... esto puede tardar hasta un minuto
      </p>
      {/* Executive summary skeleton */}
      <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 space-y-3">
        <div className="h-4 w-40 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="h-3 w-5/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="h-3 w-4/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="h-3 w-5/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        </div>
      </div>
      {/* Section skeletons */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 space-y-3"
        >
          <div className="h-4 w-36 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
            <div className="h-3 w-5/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
            <div className="h-3 w-full rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
            <div className="h-3 w-4/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          </div>
        </div>
      ))}
      {/* Action items skeleton */}
      <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 space-y-3">
        <div className="h-4 w-48 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 w-5/6 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReviewPage() {
  const [view, setView] = useState<"list" | "loading" | "review" | "error">("list");
  const [pastReviews, setPastReviews] = useState<ReviewSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<ApiErrorResponse | string | null>(null);
  const [currentReview, setCurrentReview] = useState<FullReview | null>(null);
  const [reviewError, setReviewError] = useState<ApiErrorResponse | string | null>(null);

  // Load past reviews list
  const fetchPastReviews = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/review");
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setListError(
          isApiErrorResponse(errBody) ? errBody : "Error al cargar las revisiones"
        );
        return;
      }
      const data: ReviewSummary[] = await res.json();
      setPastReviews(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Error al cargar las revisiones");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPastReviews();
  }, [fetchPastReviews]);

  // Generate a new review
  const handleGenerate = async () => {
    setView("loading");
    setReviewError(null);
    setCurrentReview(null);
    try {
      const res = await fetch("/api/review/generate", { method: "POST" });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setReviewError(
          isApiErrorResponse(errBody)
            ? errBody
            : (errBody?.error as string) || "Error al generar la revisión"
        );
        setView("error");
        return;
      }
      const data = await res.json();
      setCurrentReview(data.review as FullReview);
      setView("review");
      // Refresh the past reviews list in background
      fetchPastReviews();
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Error al generar la revisión"
      );
      setView("error");
    }
  };

  // Load a past review by ID
  const handleLoadReview = async (id: number) => {
    setView("loading");
    setReviewError(null);
    setCurrentReview(null);
    try {
      const res = await fetch(`/api/review/${id}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setReviewError(
          isApiErrorResponse(errBody)
            ? errBody
            : (errBody?.error as string) || "Error al cargar la revisión"
        );
        setView("error");
        return;
      }
      const data = await res.json();
      // data is { id, week_start, content, created_at }
      setCurrentReview({ ...data.content, id: data.id, week_start: data.week_start });
      setView("review");
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Error al cargar la revisión"
      );
      setView("error");
    }
  };

  const handleBackToList = () => {
    setCurrentReview(null);
    setReviewError(null);
    setView("list");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Revisión Semanal
          </h1>
          <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
            Análisis automático del negocio generado con inteligencia artificial
          </p>
        </div>
        {(view === "list" || view === "error") && (
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
            data-testid="generate-button"
          >
            Generar revisión semanal
          </button>
        )}
      </div>

      {/* Loading state */}
      {view === "loading" && <ReviewSkeleton />}

      {/* Review state */}
      {view === "review" && currentReview && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBackToList}
            className="text-sm text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            ← Volver a la lista
          </button>
          <ReviewDisplay review={currentReview} />
        </div>
      )}

      {/* Error state */}
      {view === "error" && reviewError && (
        <ErrorDisplay
          error={reviewError}
          onRetry={handleGenerate}
        />
      )}

      {/* List state */}
      {view === "list" && (
        <div className="space-y-4">
          {/* List loading */}
          {listLoading && (
            <div className="flex justify-center py-8">
              <div
                className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"
                role="status"
                aria-label="Cargando revisiones"
              />
            </div>
          )}

          {/* List error */}
          {!listLoading && listError && (
            <ErrorDisplay error={listError} onRetry={fetchPastReviews} />
          )}

          {/* Empty state */}
          {!listLoading && !listError && pastReviews.length === 0 && (
            <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-8 text-center">
              <p className="text-sm text-tremor-content-strong dark:text-dark-tremor-content-strong font-medium">
                No hay revisiones anteriores
              </p>
              <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
                Genera la primera revisión semanal del negocio.
              </p>
            </div>
          )}

          {/* Past reviews list */}
          {!listLoading && !listError && pastReviews.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content mb-3">
                Revisiones anteriores
              </h2>
              <div className="space-y-2">
                {pastReviews.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleLoadReview(r.id)}
                    data-testid={`past-review-${r.id}`}
                    className="w-full text-left rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4 hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                          Semana del {formatWeekDate(r.week_start)}
                        </p>
                        {r.executive_summary && (
                          <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-2">
                            {r.executive_summary.split("\n")[0]?.replace(/^[•\-–*]\s*/, "")}
                          </p>
                        )}
                      </div>
                      <span className="flex-shrink-0 text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                        {formatRelativeTime(r.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
