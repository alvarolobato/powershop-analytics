"use client";

import { Card, DonutChart } from "@tremor/react";
import type { DonutChartWidget as DonutChartWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY, safeNumber } from "./types";
import { CHART_COLORS } from "./chart-colors";
import { applyGlossary } from "@/lib/glossary";
import { WidgetSkeleton } from "./WidgetSkeleton";

interface DonutChartWidgetProps {
  widget: DonutChartWidgetSpec;
  data: WidgetData | null;
  /** Pre-fetched comparison period data. When present, shows a comparison total label. */
  comparisonData?: WidgetData | null;
  /** Optional glossary entries for contextual tooltips on the title. */
  glossary?: GlossaryItem[];
}

export function DonutChartWidget({ widget, data, comparisonData, glossary }: DonutChartWidgetProps) {
  const titleNode = applyGlossary(widget.title, glossary);

  if (data === null) {
    return (
      <Card className="p-4" aria-live="polite" aria-busy={true}>
        <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content">
          {titleNode}
        </h3>
        <WidgetSkeleton type="chart" />
      </Card>
    );
  }

  if (data.rows.length === 0) {
    return (
      <Card className="p-4" aria-live="polite" aria-busy={false}>
        <h3 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{titleNode}</h3>
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
        <h3 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{titleNode}</h3>
        <p className="mt-4 text-center text-sm text-tremor-content dark:text-dark-tremor-content-emphasis">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const { xIdx, yIdx } = resolved;
  const chartData = data.rows
    .filter((row) => row[xIdx] != null && row[xIdx] !== "" && safeNumber(row[yIdx]) !== null)
    .map((row) => ({
      name: String(row[xIdx]),
      value: safeNumber(row[yIdx])!,
    }));

  let comparisonTotal: number | null = null;
  if (comparisonData && comparisonData.rows.length > 0) {
    const compResolved = resolveXY(comparisonData, widget.x, widget.y);
    if (compResolved) {
      let sum = 0;
      for (const row of comparisonData.rows) {
        const v = safeNumber(row[compResolved.yIdx]);
        if (v !== null) sum += v;
      }
      comparisonTotal = sum;
    }
  }

  const currentTotal = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="p-4" aria-live="polite" aria-busy={false}>
      <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{titleNode}</h3>

      <div
        role="img"
        aria-label={`Gráfico de donut: ${widget.title}. ${chartData.length} categorías.`}
      >
        <span className="sr-only">Gráfico de donut con {chartData.length} categorías.</span>
        <DonutChart
          data={chartData}
          category="value"
          index="name"
          colors={CHART_COLORS}
          showLabel
          showAnimation
        />
      </div>

      {comparisonTotal !== null && (
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-tremor-content dark:text-dark-tremor-content">
          <span className="font-medium">
            Actual: {currentTotal.toLocaleString("es-ES", { maximumFractionDigits: 0 })}
          </span>
          <span className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">|</span>
          <span>
            Anterior: {comparisonTotal.toLocaleString("es-ES", { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </Card>
  );
}
