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
  /**
   * Optional anomaly data per KPI item (by index).
   * Each WidgetData should have N rows of single-column numeric values:
   * row 0 = current period, rows 1..N-1 = historical values.
   * A null entry means no anomaly_sql was set for this item.
   */
  anomalyData?: (WidgetData | null)[];
}

// ---------------------------------------------------------------------------
// Z-score computation (client-side)
// ---------------------------------------------------------------------------

const ANOMALY_Z_THRESHOLD = 2.0;
const MIN_HISTORICAL_VALUES = 4;

interface AnomalyInfo {
  isAnomaly: boolean;
  direction: "high" | "low" | "normal";
  explanation: string;
}

function computeAnomaly(data: WidgetData | null): AnomalyInfo | null {
  if (!data || data.rows.length === 0) return null;

  const values: number[] = [];
  for (const row of data.rows) {
    const raw = row[0];
    if (raw !== null && raw !== undefined) {
      const num = Number(raw);
      if (!isNaN(num)) values.push(num);
    }
  }

  if (values.length < MIN_HISTORICAL_VALUES + 1) return null;

  const currentValue = values[0];
  const historical = values.slice(1);
  const n = historical.length;
  const mean = historical.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    historical.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return null;

  const zScore = (currentValue - mean) / stddev;
  const isAnomaly = Math.abs(zScore) > ANOMALY_Z_THRESHOLD;

  if (!isAnomaly) return null;

  const direction: "high" | "low" =
    zScore > ANOMALY_Z_THRESHOLD ? "high" : "low";

  const pctChange =
    mean !== 0 ? ((currentValue - mean) / Math.abs(mean)) * 100 : 0;
  const absPct = Math.abs(pctChange).toFixed(0);
  const dirText = direction === "high" ? "por encima" : "por debajo";
  const fmt = (v: number) =>
    v.toLocaleString("es-ES", { maximumFractionDigits: 2 });

  const explanation = `El valor actual (${fmt(currentValue)}) está un ${absPct}% ${dirText} de la media de los últimos ${n} periodos (${fmt(mean)}).`;

  return { isAnomaly: true, direction, explanation };
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
// Anomaly badge
// ---------------------------------------------------------------------------

interface AnomalyBadgeProps {
  anomaly: AnomalyInfo | null;
}

function AnomalyBadge({ anomaly }: AnomalyBadgeProps) {
  if (!anomaly || !anomaly.isAnomaly) return null;

  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      title={anomaly.explanation}
      data-testid="anomaly-badge"
    >
      {/* Warning icon */}
      <svg
        className="h-3 w-3 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      Valor inusual
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KpiRow({ widget, data, trendData, anomalyData }: KpiRowProps) {
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

        // Anomaly — compute client-side from anomaly data rows
        const anomalyEntry = anomalyData?.[idx] ?? null;
        const anomaly = item.anomaly_sql ? computeAnomaly(anomalyEntry) : null;

        return (
          <Card key={idx} className="p-4">
            <p className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              {item.label}
            </p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {displayValue}
              </p>
              <div className="flex items-center gap-1 flex-wrap justify-end">
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
                <AnomalyBadge anomaly={anomaly} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
