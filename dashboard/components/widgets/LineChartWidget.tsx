"use client";

import { Card, LineChart } from "@tremor/react";
import type { LineChartWidget as LineChartWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY, safeNumber } from "./types";
import { CHART_COLORS } from "./chart-colors";
import { applyGlossary } from "@/lib/glossary";
import { mergeComparisonSeries } from "./BarChartWidget";
import { WidgetSkeleton } from "./WidgetSkeleton";

interface LineChartWidgetProps {
  widget: LineChartWidgetSpec;
  data: WidgetData | null;
  /** Pre-fetched comparison period data. Present only when comparison_sql is set and a comparison range is active. */
  comparisonData?: WidgetData | null;
  /** Optional glossary entries for contextual tooltips on the title. */
  glossary?: GlossaryItem[];
}

export function LineChartWidget({ widget, data, comparisonData, glossary }: LineChartWidgetProps) {
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
          [xCol]: String(row[xIdx]),
          [yCol]: safeNumber(row[yIdx])!,
        }));

  const categories = hasComparison ? ["Actual", "Anterior"] : [yCol];

  return (
    <Card className="p-4" aria-live="polite" aria-busy={false}>
      <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content-emphasis">
        {titleNode}
      </h3>

      <div role="img" aria-label={`Gráfico de líneas: ${widget.title}.`}>
        <span className="sr-only">Gráfico de líneas.</span>

        <div className="sm:hidden">
          <LineChart
            data={chartData}
            index={xCol}
            categories={categories}
            colors={CHART_COLORS}
            showYAxis={false}
            showLegend={hasComparison}
          />
        </div>

        <div className="hidden sm:block">
          <LineChart
            data={chartData}
            index={xCol}
            categories={categories}
            colors={CHART_COLORS}
            yAxisWidth={60}
            showLegend={hasComparison}
          />
        </div>
      </div>
    </Card>
  );
}
