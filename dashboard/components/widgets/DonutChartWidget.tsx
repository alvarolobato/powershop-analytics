"use client";

import { Card, DonutChart } from "@tremor/react";
import type { DonutChartWidget as DonutChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";

interface DonutChartWidgetProps {
  widget: DonutChartWidgetSpec;
  data: WidgetData | null;
}

export function DonutChartWidget({ widget, data }: DonutChartWidgetProps) {
  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-medium text-gray-500">{widget.title}</h3>
        <p className="mt-4 text-center text-sm text-gray-400">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const xCol = widget.x ?? data.columns[0];
  const yCol = widget.y ?? data.columns[1];
  const xIdx = data.columns.indexOf(xCol);
  const yIdx = data.columns.indexOf(yCol);

  const chartData = data.rows.map((row) => ({
    name: String(row[xIdx >= 0 ? xIdx : 0]),
    value: Number(row[yIdx >= 0 ? yIdx : 1]),
  }));

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <DonutChart
        data={chartData}
        category="value"
        index="name"
        showLabel
        showAnimation
      />
    </Card>
  );
}
