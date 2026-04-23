"use client";

import { Card, BarChart } from "@tremor/react";
import type { BarChartWidget as BarChartWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { OnDataPointClick, WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY, safeNumber } from "./types";
import { CHART_COLORS } from "./chart-colors";
import { applyGlossary } from "@/lib/glossary";
import { WidgetSkeleton } from "./WidgetSkeleton";

interface BarChartWidgetProps {
  widget: BarChartWidgetSpec;
  data: WidgetData | null;
  /** Pre-fetched comparison period data. Present only when comparison_sql is set and a comparison range is active. */
  comparisonData?: WidgetData | null;
  /** Optional glossary entries for contextual tooltips on the title. */
  glossary?: GlossaryItem[];
  /** When set, clicking a bar invokes this with label/value context (Tremor `onValueChange`). */
  onDataPointClick?: OnDataPointClick;
}

/** Merge primary and comparison datasets into a two-series format for Tremor charts. */
export function mergeComparisonSeries(
  primary: WidgetData,
  comparison: WidgetData,
  xIdx: number,
  yIdx: number,
  xCol: string,
): Record<string, string | number | null>[] {
  // Build lookup: x-label → comparison y value
  const compMap = new Map<string, number | null>();
  for (const row of comparison.rows) {
    const xVal = String(row[xIdx] ?? "");
    compMap.set(xVal, safeNumber(row[yIdx]));
  }

  return primary.rows
    .filter((row) => safeNumber(row[yIdx]) !== null)
    .map((row) => ({
      [xCol]: String(row[xIdx] ?? ""),
      Actual: safeNumber(row[yIdx])!,
      Anterior: compMap.get(String(row[xIdx] ?? "")) ?? null,
    }));
}

export function BarChartWidget({
  widget,
  data,
  comparisonData,
  glossary,
  onDataPointClick,
}: BarChartWidgetProps) {
  const titleNode = applyGlossary(widget.title, glossary);

  if (data === null) {
    return (
      <Card className="p-4" aria-live="polite" aria-busy={true}>
        <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content-emphasis">
          {titleNode}
        </h3>
        <WidgetSkeleton type="chart" />
      </Card>
    );
  }

  if (data.rows.length === 0) {
    return (
      <Card className="p-4" aria-live="polite" aria-busy={false}>
        <h3 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content-emphasis">
          {titleNode}
        </h3>
        <p className="mt-4 text-center text-sm text-tremor-content dark:text-dark-tremor-content-emphasis">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const resolved = resolveXY(data, widget.x, widget.y);
  if (!resolved) {
    return (
      <Card className="p-4" aria-live="polite" aria-busy={false}>
        <h3 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content-emphasis">
          {titleNode}
        </h3>
        <p className="mt-4 text-center text-sm text-tremor-content dark:text-dark-tremor-content-emphasis">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const { xIdx, yIdx, xCol, yCol } = resolved;
  const hasComparison = comparisonData != null && comparisonData.rows.length > 0;

  const chartData = hasComparison
    ? mergeComparisonSeries(data, comparisonData!, xIdx, yIdx, xCol)
    : data.rows
        .filter((row) => safeNumber(row[yIdx]) !== null)
        .map((row) => ({
          [xCol]: row[xIdx],
          [yCol]: safeNumber(row[yIdx])!,
        }));

  const categories = hasComparison ? ["Actual", "Anterior"] : [yCol];

  const handleValueChange = (v: Record<string, unknown> | null | undefined) => {
    if (!onDataPointClick || !v) return;
    const label = String(v[xCol] ?? "");
    const seriesKey = v.categoryClicked;
    let raw: unknown;
    if (typeof seriesKey === "string" && seriesKey in v) {
      raw = v[seriesKey];
    } else {
      for (const c of categories) {
        if (c in v) {
          raw = v[c];
          break;
        }
      }
    }
    const value = raw !== undefined && raw !== null ? String(raw) : "";
    onDataPointClick({
      label,
      value,
      widgetTitle: widget.title,
      widgetType: "bar_chart",
    });
  };

  return (
    <Card className="p-4" aria-live="polite" aria-busy={false}>
      <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content-emphasis">
        {titleNode}
      </h3>

      <div
        role="img"
        aria-label={`Gráfico de barras: ${widget.title}. ${chartData.length} categorías.`}
        className={onDataPointClick ? "cursor-pointer" : undefined}
        title={onDataPointClick ? "Clic para explorar" : undefined}
      >
        <span className="sr-only">
          Gráfico de barras con {chartData.length} categorías.
        </span>

        {/* Mobile: no y-axis to prevent overflow */}
        <div className="sm:hidden">
          <BarChart
            data={chartData}
            index={xCol}
            categories={categories}
            colors={CHART_COLORS}
            showYAxis={false}
            showLegend={hasComparison}
            onValueChange={
              onDataPointClick
                ? (v) => handleValueChange(v as unknown as Record<string, unknown>)
                : undefined
            }
          />
        </div>

        {/* Desktop: full y-axis */}
        <div className="hidden sm:block">
          <BarChart
            data={chartData}
            index={xCol}
            categories={categories}
            colors={CHART_COLORS}
            yAxisWidth={60}
            showLegend={hasComparison}
            onValueChange={
              onDataPointClick
                ? (v) => handleValueChange(v as unknown as Record<string, unknown>)
                : undefined
            }
          />
        </div>
      </div>
    </Card>
  );
}
