"use client";

import { Card } from "@tremor/react";
import type { KpiRowWidget } from "@/lib/schema";
import type { WidgetData } from "./types";
import { formatValue } from "./format";

interface KpiRowProps {
  widget: KpiRowWidget;
  /**
   * Array of query results, one per KPI item (by index).
   * Each WidgetData should have a single row with a single value.
   * A null entry means the query has not been executed or returned no data.
   */
  data: (WidgetData | null)[];
}

export function KpiRow({ widget, data }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {widget.items.map((item, idx) => {
        const entry = data[idx];
        const rawValue =
          entry && entry.rows.length > 0 ? entry.rows[0][0] : null;
        const displayValue = formatValue(rawValue, item.format, item.prefix);

        return (
          <Card key={idx} className="p-4">
            <p className="text-sm text-gray-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {displayValue}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
