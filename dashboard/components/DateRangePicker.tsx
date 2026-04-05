"use client";

import { useState, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  range: () => DateRange;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

const PRESETS: Preset[] = [
  {
    label: "Hoy",
    range: () => {
      const now = new Date();
      return { from: startOfDay(now), to: endOfDay(now) };
    },
  },
  {
    label: "Última semana",
    range: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 6);
      return { from: startOfDay(from), to: endOfDay(to) };
    },
  },
  {
    label: "Último mes",
    range: () => {
      const to = new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - 1);
      return { from: startOfDay(from), to: endOfDay(to) };
    },
  },
  {
    label: "Último trimestre",
    range: () => {
      const to = new Date();
      const from = new Date(to);
      from.setMonth(from.getMonth() - 3);
      return { from: startOfDay(from), to: endOfDay(to) };
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayRange(range: DateRange): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  const from = range.from.toLocaleDateString("es-ES", opts);
  const to = range.to.toLocaleDateString("es-ES", opts);
  return `${from} – ${to}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Date range picker with presets.
 * Designed to be used in the dashboard toolbar to filter widget queries by date.
 *
 * Usage:
 *   <DateRangePicker value={dateRange} onChange={setDateRange} />
 */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(toDateInputValue(value.from));
  const [customTo, setCustomTo] = useState(toDateInputValue(value.to));
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Sync custom inputs when value changes externally
  useEffect(() => {
    setCustomFrom(toDateInputValue(value.from));
    setCustomTo(toDateInputValue(value.to));
  }, [value]);

  function applyPreset(preset: Preset) {
    onChange(preset.range());
    setOpen(false);
  }

  function applyCustomRange() {
    const from = new Date(customFrom + "T00:00:00.000");
    // Use T23:59:59.999 for consistency with endOfDay() used by presets
    const to = new Date(customTo + "T23:59:59.999");
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      onChange({ from, to });
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef} data-testid="date-range-picker">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-2 text-sm font-medium text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
        aria-label="Seleccionar rango de fechas"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {/* Calendar icon */}
        <svg
          className="h-4 w-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
          />
        </svg>
        <span className="hidden sm:inline">{formatDisplayRange(value)}</span>
        <span className="sm:hidden">Fechas</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Selector de rango de fechas"
          className="absolute left-0 z-50 mt-2 w-72 rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background shadow-xl"
        >
          {/* Presets */}
          <div className="border-b border-tremor-border dark:border-dark-tremor-border p-2">
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              Preestablecidos
            </p>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div className="p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              Rango personalizado
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                  Desde
                </span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background-subtle px-2 py-1.5 text-sm text-tremor-content dark:text-dark-tremor-content focus:outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                  Hasta
                </span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background-subtle px-2 py-1.5 text-sm text-tremor-content dark:text-dark-tremor-content focus:outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={applyCustomRange}
              className="w-full rounded-lg bg-tremor-brand dark:bg-dark-tremor-brand px-3 py-2 text-sm font-medium text-tremor-brand-inverted dark:text-dark-tremor-brand-inverted hover:bg-tremor-brand-emphasis dark:hover:bg-dark-tremor-brand-emphasis transition-colors"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date range injection helper
// ---------------------------------------------------------------------------

/**
 * Inject a date range filter into a SQL query by wrapping it as a subquery.
 *
 * **Important limitation**: this helper only works when the original query's
 * SELECT list includes `dateColumn` (the raw date column). Many aggregate
 * queries (e.g. GROUP BY) do not select the raw date — in those cases,
 * the date range should be applied inside the original SQL's WHERE clause
 * instead. Use this helper only for simple row-level queries.
 *
 * Example output (using default `fecha_creacion` column):
 *   SELECT * FROM (<original sql>) AS _drp_q
 *   WHERE _drp_q.fecha_creacion BETWEEN '2026-01-01' AND '2026-03-31'
 *
 * @param sql - original SQL query (must SELECT `dateColumn` to work correctly)
 * @param range - date range to apply
 * @param dateColumn - column name to filter on (default: 'fecha_creacion')
 * @returns SQL with date filter applied via subquery
 */
export function injectDateRange(
  sql: string,
  range: DateRange,
  dateColumn = "fecha_creacion",
): string {
  const from = toDateInputValue(range.from);
  const to = toDateInputValue(range.to);
  // Wrap in subquery and apply date filter
  return `SELECT * FROM (${sql}) AS _drp_q WHERE _drp_q.${dateColumn} BETWEEN '${from}' AND '${to}'`;
}
