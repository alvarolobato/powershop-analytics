"use client";

import { Card, AreaChart } from "@tremor/react";
import type { AreaChartWidget as AreaChartWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";

interface AreaChartWidgetProps {
  widget: AreaChartWidgetSpec;
  data: WidgetData | null;
}

export function AreaChartWidget({ widget, data }: AreaChartWidgetProps) {
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
    [xCol]: String(row[xIdx >= 0 ? xIdx : 0]),
    [yCol]: Number(row[yIdx >= 0 ? yIdx : 1]),
  }));

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <AreaChart
        data={chartData}
        index={xCol}
        categories={[yCol]}
        yAxisWidth={60}
      />
    </Card>
  );
}
