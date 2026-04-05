"use client";

import { Card } from "@tremor/react";
import type { KpiRowWidget } from "@/lib/schema";
import type { WidgetData } from "./types";
import { formatValue } from "./format";

interface KpiRowProps {
  widget: KpiRowWidget;
  /**
   * Array of query results, one per KPI item (by index).
   * Each WidgetData should have a single row with a single value.
   * A null entry means the query has not been executed or returned no data.
   */
  data: (WidgetData | null)[];
  /**
   * Optional trend data per KPI item (by index).
   * Each WidgetData should have a single row with a single numeric value
   * representing the comparison period value.
   */
  trendData?: (WidgetData | null)[];
}

// ---------------------------------------------------------------------------
// Trend badge
// ---------------------------------------------------------------------------

interface TrendBadgeProps {
  currentValue: number | null;
  comparisonValue: number | null;
}

function TrendBadge({ currentValue, comparisonValue }: TrendBadgeProps) {
  if (
    currentValue === null ||
    comparisonValue === null ||
    comparisonValue === 0
  ) {
    return null;
  }

  const pctChange =
    ((currentValue - comparisonValue) / Math.abs(comparisonValue)) * 100;
  const isPositive = pctChange >= 0;
  const formatted = `${isPositive ? "+" : ""}${pctChange.toFixed(1)}%`;

  return (
    <span
      className={
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold " +
        (isPositive
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")
      }
      title={`vs. período anterior`}
    >
      {/* Arrow icon */}
      <svg
        className="h-3 w-3 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        {isPositive ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3"
          />
        )}
      </svg>
      {formatted}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KpiRow({ widget, data, trendData }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {widget.items.map((item, idx) => {
        const entry = data[idx];
        const rawValue =
          entry && entry.rows.length > 0 ? entry.rows[0][0] : null;
        const displayValue = formatValue(rawValue, item.format, item.prefix);

        // Trend
        const trendEntry = trendData?.[idx];
        const trendRawValue =
          trendEntry && trendEntry.rows.length > 0
            ? trendEntry.rows[0][0]
            : null;
        const currentNum =
          rawValue !== null && rawValue !== undefined
            ? Number(rawValue)
            : null;
        const comparisonNum =
          trendRawValue !== null && trendRawValue !== undefined
            ? Number(trendRawValue)
            : null;

        return (
          <Card key={idx} className="p-4">
            <p className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              {item.label}
            </p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {displayValue}
              </p>
              {item.trend_sql && (
                <TrendBadge
                  currentValue={
                    currentNum !== null && !isNaN(currentNum) ? currentNum : null
                  }
                  comparisonValue={
                    comparisonNum !== null && !isNaN(comparisonNum)
                      ? comparisonNum
                      : null
                  }
                />
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
