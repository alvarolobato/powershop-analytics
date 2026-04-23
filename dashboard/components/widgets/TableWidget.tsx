"use client";

import { useState, useMemo } from "react";
import { Card } from "@tremor/react";
import type { TableWidget as TableWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { OnDataPointClick, WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";
import { applyGlossary } from "@/lib/glossary";

interface TableWidgetProps {
  widget: TableWidgetSpec;
  data: WidgetData | null;
  /** Optional glossary entries for contextual tooltips on the title. */
  glossary?: GlossaryItem[];
  onDataPointClick?: OnDataPointClick;
}

type SortDir = "asc" | "desc";

/** Shared formatter to avoid per-cell allocations. */
const cellFormatter = new Intl.NumberFormat("es-ES", { useGrouping: true });

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function TableWidget({ widget, data, glossary, onDataPointClick }: TableWidgetProps) {
  const titleNode = applyGlossary(widget.title, glossary);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedRows = useMemo(() => {
    if (!data || sortCol === null) return data?.rows ?? [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];

      // Nullish values always sort last regardless of direction
      if (isNullish(va) && isNullish(vb)) return 0;
      if (isNullish(va)) return 1;
      if (isNullish(vb)) return -1;

      const na = Number(va);
      const nb = Number(vb);
      // Numeric comparison when both are finite numbers
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        return sortDir === "asc" ? na - nb : nb - na;
      }
      // String comparison
      const sa = String(va);
      const sb = String(vb);
      return sortDir === "asc"
        ? sa.localeCompare(sb, "es")
        : sb.localeCompare(sa, "es");
    });
    return rows;
  }, [data, sortCol, sortDir]);

  function handleSort(colIdx: number) {
    if (sortCol === colIdx) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(colIdx);
      setSortDir("asc");
    }
  }

  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">{titleNode}</h3>
        <p className="mt-4 text-center text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">{titleNode}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" title={onDataPointClick ? "Clic para explorar" : undefined}>
          <thead>
            <tr className="border-b border-tremor-border dark:border-dark-tremor-border">
              {data.columns.map((col, idx) => (
                <th
                  key={`${idx}-${col}`}
                  className="px-3 py-2 text-left font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis"
                  aria-sort={
                    sortCol === idx
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort(idx)}
                    className="inline-flex items-center hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis"
                  >
                    {col}
                    {sortCol === idx && (
                      <span className="ml-1">
                        {sortDir === "asc" ? "\u2191" : "\u2193"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rIdx) => (
              <tr
                key={rIdx}
                className={
                  onDataPointClick
                    ? "border-b border-tremor-border dark:border-dark-tremor-border cursor-pointer hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle"
                    : "border-b border-tremor-border dark:border-dark-tremor-border hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle"
                }
                onClick={
                  onDataPointClick
                    ? () =>
                        onDataPointClick({
                          label: String(row[0] ?? ""),
                          value: "",
                          widgetTitle: widget.title,
                          widgetType: "table",
                        })
                    : undefined
                }
              >
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "\u2014";
  if (typeof value === "number") {
    return cellFormatter.format(value);
  }
  // Handle numeric strings from PostgreSQL NUMERIC columns
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return cellFormatter.format(num);
    }
  }
  return String(value);
}
