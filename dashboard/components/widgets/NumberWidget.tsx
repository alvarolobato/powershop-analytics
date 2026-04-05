"use client";

import { Card } from "@tremor/react";
import type { NumberWidget as NumberWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";
import { formatValue } from "./format";

interface NumberWidgetProps {
  widget: NumberWidgetSpec;
  data: WidgetData | null;
}

export function NumberWidget({ widget, data }: NumberWidgetProps) {
  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{widget.title}</h3>
        <p className="mt-4 text-center text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  const rawValue = data.rows[0][0];
  const displayValue = formatValue(rawValue, widget.format, widget.prefix);

  return (
    <Card className="p-4">
      <p className="text-sm text-tremor-content dark:text-dark-tremor-content">{widget.title}</p>
      <p className="mt-2 text-4xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
        {displayValue}
      </p>
    </Card>
  );
}
