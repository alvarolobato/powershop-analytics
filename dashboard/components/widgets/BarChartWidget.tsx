"use client";

import { Card, BarChart } from "@tremor/react";
import type { BarChartWidget as BarChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY } from "./types";

interface BarChartWidgetProps {
  widget: BarChartWidgetSpec;
  data: WidgetData | null;
}

export function BarChartWidget({ widget, data }: BarChartWidgetProps) {
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

  const { xIdx, yIdx, xCol, yCol } = resolved;
  const chartData = data.rows.map((row) => ({
    [xCol]: row[xIdx],
    [yCol]: Number(row[yIdx]),
  }));

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <BarChart
        data={chartData}
        index={xCol}
        categories={[yCol]}
        yAxisWidth={60}
        showLegend={false}
      />
    </Card>
  );
}
