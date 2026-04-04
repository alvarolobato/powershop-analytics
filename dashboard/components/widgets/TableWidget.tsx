"use client";

import { useState, useMemo } from "react";
import { Card } from "@tremor/react";
import type { TableWidget as TableWidgetSpec } from "@/lib/schema";
import type { WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";

interface TableWidgetProps {
  widget: TableWidgetSpec;
  data: WidgetData | null;
}

type SortDir = "asc" | "desc";

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function TableWidget({ widget, data }: TableWidgetProps) {
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
        <h3 className="text-sm font-medium text-gray-500">{widget.title}</h3>
        <p className="mt-4 text-center text-sm text-gray-400">
          {EMPTY_MESSAGE}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-500">{widget.title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {data.columns.map((col, idx) => (
                <th
                  key={`${idx}-${col}`}
                  onClick={() => handleSort(idx)}
                  className="cursor-pointer px-3 py-2 text-left font-medium text-gray-600 hover:text-gray-900"
                >
                  {col}
                  {sortCol === idx && (
                    <span className="ml-1">
                      {sortDir === "asc" ? "\u2191" : "\u2193"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-gray-100 hover:bg-gray-50">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-gray-700">
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
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "number") {
    return new Intl.NumberFormat("es-ES", { useGrouping: true }).format(value);
  }
  // Handle numeric strings from PostgreSQL NUMERIC columns
  if (typeof value === "string" && value !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return new Intl.NumberFormat("es-ES", { useGrouping: true }).format(num);
    }
  }
  return String(value);
}
