"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import type { DashboardSpec, Widget } from "@/lib/schema";
import type { WidgetData } from "./widgets/types";
import type { DateRange } from "./DateRangePicker";
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
  /**
   * Optional date range filter. When provided, the renderer passes it down
   * to the fetch context. Widget SQL can use the date range by convention.
   * Currently stored in state for future use with parameterized queries.
   */
  dateRange?: DateRange;
}

// ---------------------------------------------------------------------------
// Per-widget state
// ---------------------------------------------------------------------------

interface WidgetState {
  /** For most widgets: single WidgetData. For kpi_row: array of WidgetData|null. */
  data: WidgetData | null | (WidgetData | null)[];
  /** Trend data for kpi_row items (indexed per item, only when trend_sql is set). */
  trendData?: (WidgetData | null)[];
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
    throw new Error(message || "Error al obtener datos del widget");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DashboardRenderer({ spec, refreshKey = 0, dateRange }: DashboardRendererProps) {
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
          // Fetch main KPI values in parallel
          const itemResults = await Promise.all(
            widget.items.map(async (item): Promise<WidgetData | null> => {
              try {
                return await fetchWidgetData(item.sql, signal);
              } catch {
                return null;
              }
            })
          );

          // Fetch trend values in parallel (for items that have trend_sql)
          const trendResults = await Promise.all(
            widget.items.map(async (item): Promise<WidgetData | null> => {
              if (!item.trend_sql) return null;
              try {
                return await fetchWidgetData(item.trend_sql, signal);
              } catch {
                return null;
              }
            })
          );

          if (!signal.aborted) {
            setWidgetStates((prev) => {
              const next = new Map(prev);
              next.set(idx, {
                data: itemResults,
                trendData: trendResults,
                loading: false,
                error: null,
              });
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

  // Build widget index map for section-based rendering
  const widgetIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    spec.widgets.forEach((w, idx) => {
      if (w.id) map.set(w.id, idx);
    });
    return map;
  }, [spec.widgets]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-tremor-content dark:text-dark-tremor-content">
          {spec.title}
        </h1>
        {spec.description && (
          <p className="mt-1 text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            {spec.description}
          </p>
        )}
      </div>

      {/* Tabbed layout (when sections are defined) */}
      {spec.sections && spec.sections.length > 0 ? (
        <TabGroup>
          <TabList className="mb-6 flex space-x-1 border-b border-tremor-border dark:border-dark-tremor-border">
            {spec.sections.map((section) => (
              <Tab
                key={section.id}
                className={({ selected }: { selected: boolean }) =>
                  "px-4 py-2 text-sm font-medium transition-colors focus:outline-none " +
                  (selected
                    ? "border-b-2 border-tremor-brand dark:border-dark-tremor-brand text-tremor-brand dark:text-dark-tremor-brand -mb-px"
                    : "text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis")
                }
              >
                {section.label}
              </Tab>
            ))}
          </TabList>

          <TabPanels>
            {spec.sections.map((section) => {
              // Resolve widget indices for this section
              const sectionWidgetIndices = section.widget_ids
                .map((wid) => widgetIndexMap.get(wid))
                .filter((idx): idx is number => idx !== undefined);

              return (
                <TabPanel key={section.id}>
                  <WidgetGrid
                    widgets={spec.widgets}
                    widgetIndices={sectionWidgetIndices}
                    widgetStates={widgetStates}
                    specChanged={specChanged}
                  />
                </TabPanel>
              );
            })}
          </TabPanels>
        </TabGroup>
      ) : (
        /* Flat layout (default, backwards compatible) */
        <WidgetGrid
          widgets={spec.widgets}
          widgetIndices={spec.widgets.map((_, i) => i)}
          widgetStates={widgetStates}
          specChanged={specChanged}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget grid
// ---------------------------------------------------------------------------

interface WidgetGridProps {
  widgets: Widget[];
  widgetIndices: number[];
  widgetStates: Map<number, WidgetState>;
  specChanged: boolean;
}

function WidgetGrid({ widgets, widgetIndices, widgetStates, specChanged }: WidgetGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {widgetIndices.map((idx) => {
        const widget = widgets[idx];
        if (!widget) return null;

        // When spec has changed but the effect hasn't run yet,
        // treat all widgets as loading to avoid stale data flash.
        const state = specChanged ? undefined : widgetStates.get(idx);
        const isFullWidth =
          widget.type === "kpi_row" || widget.type === "table";

        return (
          <div
            key={widget.id ?? `widget-${idx}`}
            className={isFullWidth ? "lg:col-span-2" : ""}
          >
            {/* Loading skeleton */}
            {(!state || state.loading) && (
              <WidgetSkeleton type={widget.type} />
            )}

            {/* Error state */}
            {state && !state.loading && state.error && (
              <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 p-4">
                <p className="text-sm font-medium text-red-800 dark:text-red-400">
                  Error en widget
                  {widget.type !== "kpi_row" && "title" in widget
                    ? `: ${widget.title}`
                    : ""}
                </p>
                <p className="mt-1 text-sm text-red-600 dark:text-red-500">
                  {state.error}
                </p>
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
  );
}

// ---------------------------------------------------------------------------
// Shaped skeleton placeholders (Task 4)
// ---------------------------------------------------------------------------

type WidgetType = Widget["type"];

function WidgetSkeleton({ type }: { type: WidgetType }) {
  switch (type) {
    case "kpi_row":
      return (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-testid="widget-skeleton"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
            >
              <div className="mb-2 h-3 w-2/3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
              <div className="h-8 w-1/2 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
            </div>
          ))}
        </div>
      );

    case "bar_chart":
      return (
        <div
          className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
          data-testid="widget-skeleton"
        >
          <div className="mb-4 h-4 w-1/3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="flex items-end gap-2 h-40">
            {[60, 85, 45, 70, 55, 90, 40].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="flex-1 h-3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle"
              />
            ))}
          </div>
        </div>
      );

    case "line_chart":
    case "area_chart":
      return (
        <div
          className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
          data-testid="widget-skeleton"
        >
          <div className="mb-4 h-4 w-1/3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="relative h-40">
            {/* Simulate a line chart wave */}
            <svg
              viewBox="0 0 300 100"
              className="h-full w-full opacity-20"
              preserveAspectRatio="none"
            >
              <polyline
                points="0,70 50,50 100,60 150,30 200,45 250,20 300,40"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-tremor-brand dark:text-dark-tremor-brand"
              />
            </svg>
          </div>
        </div>
      );

    case "donut_chart":
      return (
        <div
          className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
          data-testid="widget-skeleton"
        >
          <div className="mb-4 h-4 w-1/3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="flex items-center justify-center">
            <div className="h-40 w-40 rounded-full border-[20px] border-tremor-background-subtle dark:border-dark-tremor-background-subtle" />
          </div>
        </div>
      );

    case "table":
      return (
        <div
          className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
          data-testid="widget-skeleton"
        >
          <div className="mb-4 h-4 w-1/4 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          {/* Header row */}
          <div className="mb-3 grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle"
              />
            ))}
          </div>
          {/* Data rows */}
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="mb-2 grid grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((col) => (
                <div
                  key={col}
                  className="h-3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle opacity-60"
                  style={{ opacity: 0.4 + (4 - row) * 0.1 }}
                />
              ))}
            </div>
          ))}
        </div>
      );

    case "number":
    default:
      return (
        <div
          className="animate-pulse rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4"
          data-testid="widget-skeleton"
        >
          <div className="mb-3 h-4 w-1/3 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="h-12 w-1/2 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        </div>
      );
  }
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
          trendData={state.trendData}
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
