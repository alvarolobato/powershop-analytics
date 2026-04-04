"use client";

import { Card, DonutChart } from "@tremor/react";
import type { DonutChartWidget as DonutChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY } from "./types";

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

  const resolved = resolveXY(data, widget.x, widget.y);
  if (!resolved) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-medium text-gray-500">{widget.title}</h3>
        <p className="mt-4 text-center text-sm text-gray-400">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const { xIdx, yIdx } = resolved;
  const chartData = data.rows.map((row) => ({
    name: String(row[xIdx]),
    value: Number(row[yIdx]),
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
