"use client";

import { Card } from "@tremor/react";
import type { KpiRowWidget } from "@/lib/schema";
import { formatValue } from "./format";

interface KpiRowProps {
  widget: KpiRowWidget;
  /** Map from item index to its query result value. */
  data: Map<number, { value: string | number }>;
}

export function KpiRow({ widget, data }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {widget.items.map((item, idx) => {
        const entry = data.get(idx);
        const displayValue =
          entry !== undefined
            ? formatValue(entry.value, item.format, item.prefix)
            : "—";

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
