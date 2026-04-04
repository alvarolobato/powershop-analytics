"use client";

import { Card, LineChart } from "@tremor/react";
import type { LineChartWidget as LineChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE, resolveXY, safeNumber } from "./types";

interface LineChartWidgetProps {
  widget: LineChartWidgetSpec;
  data: WidgetData | null;
}

export function LineChartWidget({ widget, data }: LineChartWidgetProps) {
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
  const chartData = data.rows
    .filter((row) => safeNumber(row[yIdx]) !== null)
    .map((row) => ({
      [xCol]: String(row[xIdx]),
      [yCol]: safeNumber(row[yIdx])!,
    }));

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <LineChart
        data={chartData}
        index={xCol}
        categories={[yCol]}
        yAxisWidth={60}
      />
    </Card>
  );
}
