"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardSpec, GlobalFilter } from "@/lib/schema";
import type { GlobalFilterValues } from "@/lib/sql-filters";
import type { DateRange } from "./DateRangePicker";

export interface DashboardFiltersBarProps {
  dashboardId: number;
  spec: DashboardSpec;
  dateRange?: DateRange;
  comparisonRange?: ComparisonRange;
  value: GlobalFilterValues;
  onChange: (next: GlobalFilterValues) => void;
}

type OptionRow = { value: string; label: string };

async function postOptions(
  body: Record<string, unknown>,
): Promise<OptionRow[]> {
  const res = await fetch("/api/dashboard/filters/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    const msg =
      j && typeof j === "object" && "error" in j && typeof j.error === "string"
        ? j.error
        : "Error al cargar opciones";
    throw new Error(msg);
  }
  const data = (await res.json()) as { options?: OptionRow[] };
  return Array.isArray(data.options) ? data.options : [];
}

export function DashboardFiltersBar({
  dashboardId,
  spec,
  dateRange,
  value,
  onChange,
}: DashboardFiltersBarProps) {
  const filters = useMemo(() => spec.filters ?? [], [spec.filters]);
  const [optionsById, setOptionsById] = useState<Record<string, OptionRow[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const rangePayload = useMemo(() => {
    if (!dateRange) return undefined;
    return { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() };
  }, [dateRange]);

  const loadOptions = useCallback(
    async (filter: GlobalFilter) => {
      setLoading((m) => ({ ...m, [filter.id]: true }));
      setErrors((m) => {
        const n = { ...m };
        delete n[filter.id];
        return n;
      });
      try {
        const opts = await postOptions({
          dashboardId,
          filterId: filter.id,
          dateRange: rangePayload,
          activeFilters: value,
        });
        setOptionsById((m) => ({ ...m, [filter.id]: opts }));
      } catch (e) {
        setErrors((m) => ({
          ...m,
          [filter.id]: e instanceof Error ? e.message : "Error",
        }));
      } finally {
        setLoading((m) => ({ ...m, [filter.id]: false }));
      }
    },
    [dashboardId, rangePayload, value],
  );

  useEffect(() => {
    if (filters.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const f of filters) {
        if (cancelled) return;
        await loadOptions(f);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, loadOptions]);

  if (filters.length === 0) return null;

  return (
    <div
      className="no-print mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-4"
      data-testid="global-filters-bar"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle w-full sm:w-auto">
        Filtros
      </span>
      {filters.map((f) => (
        <div key={f.id} className="flex min-w-[160px] flex-col gap-1">
          <label
            htmlFor={`gf-${f.id}`}
            className="text-xs text-tremor-content dark:text-dark-tremor-content"
          >
            {f.label}
          </label>
          {f.type === "single_select" ? (
            <select
              id={`gf-${f.id}`}
              aria-label={f.label}
              aria-busy={!!loading[f.id]}
              className="rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-2 py-1.5 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis"
              value={typeof value[f.id] === "string" ? (value[f.id] as string) : ""}
              disabled={!!loading[f.id]}
              onChange={(ev) => {
                const v = ev.target.value;
                const next = { ...value };
                if (!v) delete next[f.id];
                else next[f.id] = v;
                onChange(next);
              }}
            >
              <option value="">Todos</option>
              {(optionsById[f.id] ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              id={`gf-${f.id}`}
              multiple
              aria-label={f.label}
              aria-busy={!!loading[f.id]}
              size={Math.min(6, Math.max(3, (optionsById[f.id] ?? []).length || 3))}
              className="rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-2 py-1.5 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis min-h-[72px]"
              disabled={!!loading[f.id]}
              value={Array.isArray(value[f.id]) ? (value[f.id] as string[]) : []}
              onChange={(ev) => {
                const selected = Array.from(ev.target.selectedOptions).map((o) => o.value);
                const next = { ...value };
                if (selected.length === 0) delete next[f.id];
                else next[f.id] = selected;
                onChange(next);
              }}
            >
              {(optionsById[f.id] ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {errors[f.id] && (
            <span className="text-xs text-red-500">{errors[f.id]}</span>
          )}
        </div>
      ))}
    </div>
  );
}
