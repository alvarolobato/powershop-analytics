"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardSpec, GlobalFilter } from "@/lib/schema";
import type { GlobalFilterValues } from "@/lib/sql-filters";
import type { DateRange } from "./DateRangePicker";

export interface DashboardFiltersBarProps {
  dashboardId: number;
  spec: DashboardSpec;
  dateRange?: DateRange;
  value: GlobalFilterValues;
  onChange: (next: GlobalFilterValues) => void;
}

type OptionRow = { value: string; label: string };

/** HTML `<select>` value is always string — coerce stored numbers for controlled value. */
function singleSelectFormValue(
  filter: GlobalFilter,
  value: GlobalFilterValues,
): string {
  const raw = value[filter.id];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") return raw;
  return "";
}

function multiSelectFormValue(
  filter: GlobalFilter,
  value: GlobalFilterValues,
): string[] {
  const raw = value[filter.id];
  if (!Array.isArray(raw)) return [];
  if (filter.value_type === "numeric") {
    return (raw as unknown[])
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .map(String);
  }
  return (raw as string[]).filter((x) => typeof x === "string");
}

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

// ---------------------------------------------------------------------------
// Pill select component (B3)
// ---------------------------------------------------------------------------

interface PillSelectProps {
  filter: GlobalFilter;
  options: OptionRow[];
  value: GlobalFilterValues;
  loading?: boolean;
  error?: string;
  onChange: (next: GlobalFilterValues) => void;
}

function PillSelect({ filter, options, value, loading, error, onChange }: PillSelectProps) {
  const pillStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: "4px 10px 4px 12px",
    fontSize: 12,
  };
  const selectStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: "var(--fg)",
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
    fontFamily: "inherit",
    paddingRight: 14,
  };

  if (filter.type === "single_select") {
    return (
      <label style={pillStyle}>
        <span style={{ color: "var(--fg-muted)", fontSize: 11 }}>{filter.label}</span>
        <select
          id={`gf-${filter.id}`}
          aria-label={filter.label}
          aria-busy={!!loading}
          style={selectStyle}
          value={singleSelectFormValue(filter, value)}
          disabled={!!loading}
          onChange={(ev) => {
            const v = ev.target.value;
            const next = { ...value };
            if (!v) delete next[filter.id];
            else if (filter.value_type === "numeric") {
              const n = Number(v);
              next[filter.id] = Number.isFinite(n) ? n : v;
            } else {
              next[filter.id] = v;
            }
            onChange(next);
          }}
        >
          <option value="" style={{ background: "var(--bg-1)" }}>Todos</option>
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ background: "var(--bg-1)" }}>
              {o.label}
            </option>
          ))}
        </select>
        {error && (
          <span style={{ fontSize: 10, color: "var(--down)" }}>{error}</span>
        )}
      </label>
    );
  }

  // multi_select — keep as a compact multi-select with pill wrapper
  return (
    <label style={{ ...pillStyle, alignItems: "flex-start", padding: "4px 10px 4px 12px" }}>
      <span style={{ color: "var(--fg-muted)", fontSize: 11, paddingTop: 4 }}>{filter.label}</span>
      <select
        id={`gf-${filter.id}`}
        multiple
        aria-label={filter.label}
        aria-busy={!!loading}
        size={Math.min(5, Math.max(2, options.length || 2))}
        style={{
          ...selectStyle,
          minHeight: 60,
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 6px",
        }}
        disabled={!!loading}
        value={multiSelectFormValue(filter, value)}
        onChange={(ev) => {
          const selected = Array.from(ev.target.selectedOptions).map((o) => o.value);
          const next = { ...value };
          if (selected.length === 0) delete next[filter.id];
          else if (filter.value_type === "numeric") {
            next[filter.id] = selected
              .map((s) => Number(s))
              .filter((n) => Number.isFinite(n));
          } else {
            next[filter.id] = selected;
          }
          onChange(next);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "var(--bg-1)" }}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <span style={{ fontSize: 10, color: "var(--down)" }}>{error}</span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// DashboardFiltersBar
// ---------------------------------------------------------------------------

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

  const hasActiveFilters = filters.some((f) => {
    const v = value[f.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-1)",
        flexWrap: "wrap",
      }}
      data-testid="global-filters-bar"
      className="no-print"
    >
      {/* Lead label */}
      <span
        style={{
          fontSize: 11,
          color: "var(--fg-subtle)",
          fontFamily: "var(--font-jetbrains, monospace)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginRight: 4,
          flexShrink: 0,
        }}
      >
        FILTROS
      </span>

      {filters.map((f) => (
        <PillSelect
          key={f.id}
          filter={f}
          options={optionsById[f.id] ?? []}
          value={value}
          loading={loading[f.id]}
          error={errors[f.id]}
          onChange={onChange}
        />
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange({})}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--fg-muted)",
            fontFamily: "inherit",
            padding: "4px 8px",
          }}
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
