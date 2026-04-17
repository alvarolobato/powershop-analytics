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
// Preset types and helpers
// ---------------------------------------------------------------------------

export type TimeRangePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "current_month"
  | "last_month"
  | "year_to_date";

interface Preset {
  id: TimeRangePreset;
  label: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Map a preset ID to a DateRange. Captures the current date/time at call time.
 */
export function presetToDateRange(preset: TimeRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };

    case "last_7_days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: startOfDay(from), to: endOfDay(now) };
    }

    case "last_30_days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: startOfDay(from), to: endOfDay(now) };
    }

    case "current_month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }

    case "last_month": {
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const from = new Date(year, month, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0); // day=0 in JS Date === last day of the preceding month
      return { from: startOfDay(from), to: endOfDay(to) };
    }

    case "year_to_date": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }

    default: {
      const _exhaustive: never = preset;
      throw new Error("Unknown preset: " + String(preset));
    }
  }
}

const PRESETS: Preset[] = [
  { id: "today", label: "Hoy" },
  { id: "last_7_days", label: "Últimos 7 días" },
  { id: "last_30_days", label: "Últimos 30 días" },
  { id: "current_month", label: "Mes actual" },
  { id: "last_month", label: "Mes anterior" },
  { id: "year_to_date", label: "Año en curso" },
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
 * Designed to be used in the dashboard toolbar as a UX control for selecting
 * a date range. The picker itself only provides the selected range via `onChange`.
 * Callers are responsible for using the range to filter data — either by
 * re-running widget queries (e.g., incrementing refreshKey), by passing the
 * range to the LLM to regenerate SQL, or by applying `injectDateRange()` when
 * the widget SQL selects the date column directly.
 *
 * Usage:
 *   <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
 */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(toDateInputValue(value.from));
  const [customTo, setCustomTo] = useState(toDateInputValue(value.to));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  // Close on Escape key and return focus to trigger
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Sync custom inputs when value changes externally
  useEffect(() => {
    setCustomFrom(toDateInputValue(value.from));
    setCustomTo(toDateInputValue(value.to));
  }, [value]);

  function applyPreset(preset: Preset) {
    onChange(presetToDateRange(preset.id));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function applyCustomRange() {
    const from = new Date(customFrom + "T00:00:00.000");
    // Use T23:59:59.999 for consistency with endOfDay() used by presets
    const to = new Date(customTo + "T23:59:59.999");
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      onChange({ from, to });
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className="relative" ref={containerRef} data-testid="date-range-picker">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-2 text-sm font-medium text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tremor-brand dark:focus-visible:ring-dark-tremor-brand"
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
                key={preset.id}
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
/**
 * Pattern for safe SQL identifiers: letters, digits, and underscores only.
 * This prevents injection when `dateColumn` originates from untrusted input.
 */
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function injectDateRange(
  sql: string,
  range: DateRange,
  dateColumn = "fecha_creacion",
): string {
  if (!SAFE_IDENTIFIER_RE.test(dateColumn)) {
    throw new Error(
      `injectDateRange: dateColumn '${dateColumn}' is not a valid SQL identifier. ` +
      `Only letters, digits, and underscores are allowed.`
    );
  }
  // Trim a single trailing semicolon so the SQL can be embedded in a subquery.
  // Multi-statement SQL (multiple semicolons) is rejected at the server by the
  // read-only validator in /api/query.
  const normalizedSql = sql.trimEnd().replace(/;$/, "");
  const from = toDateInputValue(range.from);
  const to = toDateInputValue(range.to);
  // Wrap in subquery and apply date filter
  return `SELECT * FROM (${normalizedSql}) AS _drp_q WHERE _drp_q.${dateColumn} BETWEEN '${from}' AND '${to}'`;
}
