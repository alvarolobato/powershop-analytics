"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardSpec, Widget } from "@/lib/schema";
import type { WidgetData } from "./widgets/types";
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
  spec: DashboardSpec;
}

// ---------------------------------------------------------------------------
// Per-widget state
// ---------------------------------------------------------------------------

interface WidgetState {
  /** For most widgets: single WidgetData. For kpi_row: array of WidgetData|null. */
  data: WidgetData | null | (WidgetData | null)[];
  loading: boolean;
  error: string | null;
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
    let message = "";
    try {
      const errorBody = await res.json();
      if (
        errorBody &&
        typeof errorBody === "object" &&
        "error" in errorBody &&
        typeof errorBody.error === "string"
      ) {
        message = errorBody.error;
      }
    } catch {
      try {
        message = await res.text();
      } catch {
        message = "";
      }
    }
    throw new Error(message || "Failed to fetch widget data");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardRenderer({ spec }: DashboardRendererProps) {
  const [widgetStates, setWidgetStates] = useState<Map<number, WidgetState>>(
    new Map()
  );
  const abortRef = useRef<AbortController | null>(null);

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
        const message =
          err instanceof Error ? err.message : "Error al ejecutar la consulta";
        setWidgetStates((prev) => {
          const next = new Map(prev);
          next.set(idx, { data: null, loading: false, error: message });
          return next;
        });
      }
    });

    await Promise.all(promises);
  }, []);

  useEffect(() => {
    if (spec.widgets.length > 0) {
      fetchAll(spec.widgets);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [spec, fetchAll]);

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
          const state = widgetStates.get(idx);
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
                <div className="rounded-lg border border-red-300 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-800">
                    Error en widget
                  </p>
                  <p className="mt-1 text-sm text-red-600">{state.error}</p>
                </div>
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
