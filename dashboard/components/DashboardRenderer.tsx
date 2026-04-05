"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { DashboardSpec, Widget } from "@/lib/schema";
import type { WidgetData } from "./widgets/types";
import type { ApiErrorResponse } from "@/lib/errors";
import { ErrorDisplay } from "./ErrorDisplay";
import {
  KpiRow,
  BarChartWidget,
  LineChartWidget,
  AreaChartWidget,
  DonutChartWidget,
  TableWidget,
  NumberWidget,
} from "./widgets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardRendererProps {
  /** The dashboard specification to render. Callers may pass a new object
   *  on each render -- the component uses a stable JSON key internally to
   *  avoid unnecessary refetches. */
  spec: DashboardSpec;
  /** When this value changes, all widget queries are re-executed.
   *  Increment it to trigger a manual or auto-refresh. */
  refreshKey?: number;
}

// ---------------------------------------------------------------------------
// Per-widget state
// ---------------------------------------------------------------------------

interface WidgetState {
  /** For most widgets: single WidgetData. For kpi_row: array of WidgetData|null. */
  data: WidgetData | null | (WidgetData | null)[];
  loading: boolean;
  /** Structured error from the API (preferred) or plain string fallback. */
  error: ApiErrorResponse | string | null;
}

// ---------------------------------------------------------------------------
// Data fetching helper
// ---------------------------------------------------------------------------

async function fetchWidgetData(
  sql: string,
  signal?: AbortSignal,
): Promise<WidgetData> {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
    signal,
  });
  if (!res.ok) {
    let errorPayload: ApiErrorResponse | null = null;
    let fallbackMessage = "Error al obtener datos del widget";
    try {
      const body = await res.json();
      if (body && typeof body === "object") {
        // Check if it matches our structured error format
        if ("error" in body && "code" in body && "requestId" in body) {
          errorPayload = body as ApiErrorResponse;
        } else if ("error" in body && typeof body.error === "string") {
          // Non-structured error with a message
          fallbackMessage = body.error as string;
        }
      }
    } catch {
      // ignore parse failure
    }
    if (errorPayload) {
      const err = new Error(errorPayload.error) as Error & { structured?: ApiErrorResponse };
      err.structured = errorPayload;
      throw err;
    }
    throw new Error(fallbackMessage);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardRenderer({ spec, refreshKey = 0 }: DashboardRendererProps) {
  const [widgetStates, setWidgetStates] = useState<Map<number, WidgetState>>(
    new Map()
  );
  const abortRef = useRef<AbortController | null>(null);
  // Stable key derived from spec content (not referential identity) so
  // parent re-renders that recreate the same spec object don't trigger refetches.
  const specKey = useMemo(() => JSON.stringify(spec), [spec]);
  // Track the specKey that widgetStates corresponds to, so we show skeletons
  // (not stale data) when spec changes before the effect runs.
  const renderedKeyRef = useRef<string>(specKey);
  const specChanged = renderedKeyRef.current !== specKey;

  // Fetch all widgets for a given spec
  const fetchAll = useCallback(async (widgets: Widget[]) => {
    // Abort any in-flight requests from a previous spec
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Initialize all widgets to loading state
    const initial = new Map<number, WidgetState>();
    widgets.forEach((_, idx) => {
      initial.set(idx, { data: null, loading: true, error: null });
    });
    setWidgetStates(new Map(initial));

    // Fetch data for each widget in parallel
    const promises = widgets.map(async (widget, idx) => {
      try {
        if (widget.type === "kpi_row") {
          // Fetch each KPI item in parallel
          const itemResults = await Promise.all(
            widget.items.map(async (item): Promise<WidgetData | null> => {
              try {
                return await fetchWidgetData(item.sql, signal);
              } catch {
                return null;
              }
            })
          );
          if (!signal.aborted) {
            setWidgetStates((prev) => {
              const next = new Map(prev);
              next.set(idx, { data: itemResults, loading: false, error: null });
              return next;
            });
          }
        } else {
          const data = await fetchWidgetData(widget.sql, signal);
          if (!signal.aborted) {
            setWidgetStates((prev) => {
              const next = new Map(prev);
              next.set(idx, { data, loading: false, error: null });
              return next;
            });
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        const structured =
          err instanceof Error && "structured" in err
            ? (err as Error & { structured?: ApiErrorResponse }).structured
            : undefined;
        const errorValue: ApiErrorResponse | string = structured
          ? structured
          : err instanceof Error
          ? err.message
          : "Error al ejecutar la consulta";
        setWidgetStates((prev) => {
          const next = new Map(prev);
          next.set(idx, { data: null, loading: false, error: errorValue });
          return next;
        });
      }
    });

    await Promise.all(promises);
  }, []);

  // Retry a single widget by re-fetching it
  const retryWidget = useCallback(
    async (widget: Widget, idx: number) => {
      // Abort any previous in-flight retry for this widget (via shared abort ref)
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      setWidgetStates((prev) => {
        const next = new Map(prev);
        next.set(idx, { data: null, loading: true, error: null });
        return next;
      });

      try {
        if (widget.type === "kpi_row") {
          const itemResults = await Promise.all(
            widget.items.map(async (item): Promise<WidgetData | null> => {
              try {
                return await fetchWidgetData(item.sql, signal);
              } catch {
                return null;
              }
            })
          );
          if (!signal.aborted) {
            setWidgetStates((prev) => {
              const next = new Map(prev);
              next.set(idx, { data: itemResults, loading: false, error: null });
              return next;
            });
          }
        } else {
          const data = await fetchWidgetData(widget.sql, signal);
          if (!signal.aborted) {
            setWidgetStates((prev) => {
              const next = new Map(prev);
              next.set(idx, { data, loading: false, error: null });
              return next;
            });
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        const structured =
          err instanceof Error && "structured" in err
            ? (err as Error & { structured?: ApiErrorResponse }).structured
            : undefined;
        const errorValue: ApiErrorResponse | string = structured
          ? structured
          : err instanceof Error
          ? err.message
          : "Error al ejecutar la consulta";
        setWidgetStates((prev) => {
          const next = new Map(prev);
          next.set(idx, { data: null, loading: false, error: errorValue });
          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    renderedKeyRef.current = specKey;
    if (spec.widgets.length > 0) {
      fetchAll(spec.widgets);
    }
    return () => {
      abortRef.current?.abort();
    };
    // refreshKey is included so incrementing it re-runs all queries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, spec.widgets, fetchAll, refreshKey]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{spec.title}</h1>
        {spec.description && (
          <p className="mt-1 text-sm text-gray-500">{spec.description}</p>
        )}
      </div>

      {/* Widget grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {spec.widgets.map((widget, idx) => {
          // When spec has changed but the effect hasn't run yet,
          // treat all widgets as loading to avoid stale data flash.
          const state = specChanged ? undefined : widgetStates.get(idx);
          const isFullWidth =
            widget.type === "kpi_row" || widget.type === "table";

          return (
            <div
              key={widget.id ?? `widget-${idx}`}
              className={isFullWidth ? "md:col-span-2" : ""}
            >
              {/* Loading skeleton */}
              {(!state || state.loading) && <WidgetSkeleton />}

              {/* Error state */}
              {state && !state.loading && state.error && (
                <ErrorDisplay
                  error={state.error}
                  title={
                    widget.type !== "kpi_row" && "title" in widget
                      ? (widget.title as string)
                      : undefined
                  }
                  onRetry={() => retryWidget(widget, idx)}
                  className="w-full"
                />
              )}

              {/* Success state */}
              {state && !state.loading && !state.error && (
                <WidgetSwitch widget={widget} state={state} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function WidgetSkeleton() {
  return (
    <div
      className="animate-pulse rounded-lg bg-gray-100 p-4"
      data-testid="widget-skeleton"
    >
      <div className="mb-3 h-4 w-1/3 rounded bg-gray-200" />
      <div className="h-32 rounded bg-gray-200" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget type switch
// ---------------------------------------------------------------------------

function WidgetSwitch({
  widget,
  state,
}: {
  widget: Widget;
  state: WidgetState;
}) {
  switch (widget.type) {
    case "kpi_row":
      return (
        <KpiRow
          widget={widget}
          data={state.data as (WidgetData | null)[]}
        />
      );
    case "bar_chart":
      return (
        <BarChartWidget widget={widget} data={state.data as WidgetData | null} />
      );
    case "line_chart":
      return (
        <LineChartWidget widget={widget} data={state.data as WidgetData | null} />
      );
    case "area_chart":
      return (
        <AreaChartWidget widget={widget} data={state.data as WidgetData | null} />
      );
    case "donut_chart":
      return (
        <DonutChartWidget widget={widget} data={state.data as WidgetData | null} />
      );
    case "table":
      return (
        <TableWidget widget={widget} data={state.data as WidgetData | null} />
      );
    case "number":
      return (
        <NumberWidget widget={widget} data={state.data as WidgetData | null} />
      );
    default:
      return null;
  }
}
