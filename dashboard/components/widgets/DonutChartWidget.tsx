"use client";

import { Card, DonutChart } from "@tremor/react";
import type { DonutChartWidget as DonutChartWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY, safeNumber } from "./types";
import { CHART_COLORS } from "./chart-colors";
import { applyGlossary } from "@/lib/glossary";
import type { ComparisonRange } from "@/components/DateRangePicker";

interface DonutChartWidgetProps {
  widget: DonutChartWidgetSpec;
  data: WidgetData | null;
  /** Optional glossary entries for contextual tooltips on the title. */
  glossary?: GlossaryItem[];
  comparisonRange?: ComparisonRange;
}

export function DonutChartWidget({ widget, data, glossary }: DonutChartWidgetProps) {
  const titleNode = applyGlossary(widget.title, glossary);

  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4">
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
      <Card className="p-4">
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

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{titleNode}</h3>
      <DonutChart
        data={chartData}
        category="value"
        index="name"
        colors={CHART_COLORS}
        showLabel
        showAnimation
      />
    </Card>
  );
}
