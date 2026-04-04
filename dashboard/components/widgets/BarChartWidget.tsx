"use client";

import { Card, BarChart } from "@tremor/react";
import type { BarChartWidget as BarChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";

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

  const xIdx = data.columns.indexOf(widget.x);
  const yIdx = data.columns.indexOf(widget.y);

  const chartData = data.rows.map((row) => ({
    [widget.x]: row[xIdx >= 0 ? xIdx : 0],
    [widget.y]: Number(row[yIdx >= 0 ? yIdx : 1]),
  }));

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <BarChart
        data={chartData}
        index={widget.x}
        categories={[widget.y]}
        yAxisWidth={60}
        showLegend={false}
      />
    </Card>
  );
}
