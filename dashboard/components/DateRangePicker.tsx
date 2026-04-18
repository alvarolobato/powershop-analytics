"use client";

import { useState, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date;
  to: Date;
}

export type ComparisonType =
  | "none"
  | "previous_period"
  | "previous_month"
  | "previous_quarter"
  | "previous_year"
  | "yoy"
  | "custom";

export interface ComparisonRange {
  type: ComparisonType;
  from: Date;
  to: Date;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: { primary: DateRange; comparison?: ComparisonRange }) => void;
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
      // Use 30-day subtraction to avoid month-end overflow (e.g., Mar 31 - 1 month = Mar 3)
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 29);
      return { from: startOfDay(from), to: endOfDay(to) };
    },
  },
  {
    label: "Último trimestre",
    range: () => {
      // Use 90-day subtraction to avoid month-end overflow
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 89);
      return { from: startOfDay(from), to: endOfDay(to) };
    },
  },
];

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function isoWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function currentQuarterStart(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

// ---------------------------------------------------------------------------
// Period detection
// ---------------------------------------------------------------------------

export type PeriodType = "day" | "week" | "month" | "quarter" | "year";

/**
 * Detect whether a DateRange matches a known calendar period.
 * Returns null for custom/rolling ranges.
 * In-progress periods (to == end-of-today) are recognised for each type.
 */
export function detectPeriodType(range: DateRange): PeriodType | null {
  const { from, to } = range;
  const today = new Date();
  const todayEnd = endOfDay(today);

  const fromMidnight =
    from.getHours() === 0 &&
    from.getMinutes() === 0 &&
    from.getSeconds() === 0 &&
    from.getMilliseconds() === 0;
  const toEndOfDay =
    to.getHours() === 23 &&
    to.getMinutes() === 59 &&
    to.getSeconds() === 59 &&
    to.getMilliseconds() === 999;

  if (!fromMidnight || !toEndOfDay) return null;

  const toIsToday = to.getTime() === todayEnd.getTime();

  // Day: same calendar day
  if (
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate()
  ) {
    return "day";
  }

  // Week: from is ISO Monday, to is the following Sunday (or today for current week)
  const monday = isoWeekMonday(from);
  if (
    monday.getFullYear() === from.getFullYear() &&
    monday.getMonth() === from.getMonth() &&
    monday.getDate() === from.getDate()
  ) {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const expectedTo = endOfDay(sunday);
    const currentWeekMonday = isoWeekMonday(today);
    const isCurrentWeek =
      from.getFullYear() === currentWeekMonday.getFullYear() &&
      from.getMonth() === currentWeekMonday.getMonth() &&
      from.getDate() === currentWeekMonday.getDate();
    if (to.getTime() === expectedTo.getTime() || (toIsToday && isCurrentWeek)) {
      return "week";
    }
  }

  // Month: from is 1st of month, to is last of that same month (or today in that month)
  if (from.getDate() === 1) {
    const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const expectedTo = endOfDay(lastDay);
    if (to.getTime() === expectedTo.getTime()) {
      return "month";
    }
    if (
      toIsToday &&
      from.getFullYear() === to.getFullYear() &&
      from.getMonth() === to.getMonth()
    ) {
      return "month";
    }
  }

  // Quarter: from is 1st of a quarter start month (Jan/Apr/Jul/Oct),
  // to is last of that quarter (or today for current quarter past month 1)
  const qStartMonth = Math.floor(from.getMonth() / 3) * 3;
  if (from.getDate() === 1 && from.getMonth() === qStartMonth) {
    const lastOfQ = new Date(from.getFullYear(), qStartMonth + 3, 0);
    const expectedTo = endOfDay(lastOfQ);
    if (to.getTime() === expectedTo.getTime()) {
      return "quarter";
    }
    if (toIsToday) {
      // Only call it a quarter if we're past the first month of the quarter,
      // to avoid colliding with the 'month' case above.
      const qStart = currentQuarterStart(today);
      const isCurrentQ =
        from.getFullYear() === qStart.getFullYear() &&
        from.getMonth() === qStart.getMonth();
      if (isCurrentQ && today.getMonth() !== qStartMonth) {
        return "quarter";
      }
    }
  }

  // Year: from is Jan 1, to is Dec 31 (or today for current year past January)
  if (from.getMonth() === 0 && from.getDate() === 1) {
    const dec31 = new Date(from.getFullYear(), 11, 31);
    const expectedTo = endOfDay(dec31);
    if (to.getTime() === expectedTo.getTime()) {
      return "year";
    }
    if (
      toIsToday &&
      from.getFullYear() === today.getFullYear() &&
      today.getMonth() !== 0
    ) {
      return "year";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Period navigation
// ---------------------------------------------------------------------------

/**
 * Shift a DateRange by one period in the given direction.
 * The period type is detected automatically. Returns range unchanged for null (custom).
 * When navigating forward into the current period, `to` = end-of-today.
 */
export function navigatePeriod(range: DateRange, direction: -1 | 1): DateRange {
  const type = detectPeriodType(range);
  if (type === null) return range;

  const today = new Date();
  const todayEnd = endOfDay(today);

  function clampTo(newFrom: Date, fullTo: Date): Date {
    return fullTo.getTime() > todayEnd.getTime() && newFrom.getTime() <= today.getTime()
      ? todayEnd
      : fullTo;
  }

  switch (type) {
    case "day": {
      const d = new Date(range.from);
      d.setDate(d.getDate() + direction);
      return { from: startOfDay(d), to: endOfDay(d) };
    }
    case "week": {
      const newMonday = new Date(range.from);
      newMonday.setDate(newMonday.getDate() + direction * 7);
      const newFrom = startOfDay(newMonday);
      const sunday = new Date(newMonday);
      sunday.setDate(newMonday.getDate() + 6);
      return { from: newFrom, to: clampTo(newFrom, endOfDay(sunday)) };
    }
    case "month": {
      const newFrom = new Date(range.from.getFullYear(), range.from.getMonth() + direction, 1);
      const lastDay = new Date(newFrom.getFullYear(), newFrom.getMonth() + 1, 0);
      return { from: startOfDay(newFrom), to: clampTo(newFrom, endOfDay(lastDay)) };
    }
    case "quarter": {
      const newFrom = new Date(range.from.getFullYear(), range.from.getMonth() + direction * 3, 1);
      const lastDay = new Date(newFrom.getFullYear(), newFrom.getMonth() + 3, 0);
      return { from: startOfDay(newFrom), to: clampTo(newFrom, endOfDay(lastDay)) };
    }
    case "year": {
      const newYear = range.from.getFullYear() + direction;
      const newFrom = new Date(newYear, 0, 1);
      const dec31 = new Date(newYear, 11, 31);
      return { from: startOfDay(newFrom), to: clampTo(newFrom, endOfDay(dec31)) };
    }
  }
}

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
// computeComparisonRange
// ---------------------------------------------------------------------------

export function computeComparisonRange(
  primary: DateRange,
  type: ComparisonType,
): { from: Date; to: Date } | null {
  if (type === "none" || type === "custom") return null;

  const pFrom = primary.from;
  const pTo = primary.to;

  switch (type) {
    case "previous_period": {
      const durationMs = pTo.getTime() - pFrom.getTime();
      const compTo = new Date(pFrom.getTime() - 1);
      const compFrom = new Date(compTo.getTime() - durationMs);
      return { from: compFrom, to: compTo };
    }
    case "previous_month": {
      const y = pFrom.getFullYear();
      const m = pFrom.getMonth();
      const prevMonth = m === 0 ? 11 : m - 1;
      const prevYear = m === 0 ? y - 1 : y;
      return {
        from: new Date(prevYear, prevMonth, 1, 0, 0, 0, 0),
        to: new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999),
      };
    }
    case "previous_quarter": {
      const y = pFrom.getFullYear();
      const m = pFrom.getMonth();
      const currentQ = Math.floor(m / 3);
      const prevQ = currentQ === 0 ? 3 : currentQ - 1;
      const prevYear = currentQ === 0 ? y - 1 : y;
      const fromMonth = prevQ * 3;
      return {
        from: new Date(prevYear, fromMonth, 1, 0, 0, 0, 0),
        to: new Date(prevYear, fromMonth + 3, 0, 23, 59, 59, 999),
      };
    }
    case "previous_year": {
      const prevYear = pFrom.getFullYear() - 1;
      return {
        from: new Date(prevYear, 0, 1, 0, 0, 0, 0),
        to: new Date(prevYear, 11, 31, 23, 59, 59, 999),
      };
    }
    case "yoy": {
      const fromYoY = new Date(pFrom);
      fromYoY.setFullYear(fromYoY.getFullYear() - 1);
      const toYoY = new Date(pTo);
      toYoY.setFullYear(toYoY.getFullYear() - 1);
      return { from: fromYoY, to: toYoY };
    }
  }
}

// ---------------------------------------------------------------------------
// Comparison labels
// ---------------------------------------------------------------------------

const COMPARISON_LABELS: Record<ComparisonType, string> = {
  none: "Sin comparación",
  previous_period: "Período anterior",
  previous_month: "Mes anterior",
  previous_quarter: "Trimestre anterior",
  previous_year: "Año anterior (completo)",
  yoy: "Año sobre año (YoY)",
  custom: "Personalizado",
};

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
  const [comparisonType, setComparisonType] = useState<ComparisonType>("none");
  const [compCustomFrom, setCompCustomFrom] = useState("");
  const [compCustomTo, setCompCustomTo] = useState("");
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

  function buildPayload(
    primary: DateRange,
    cType: ComparisonType,
    cCustomFrom: string,
    cCustomTo: string,
  ): { primary: DateRange; comparison?: ComparisonRange } {
    if (cType === "none") return { primary };

    if (cType === "custom") {
      const from = new Date(cCustomFrom + "T00:00:00.000");
      const to = new Date(cCustomTo + "T23:59:59.999");
      if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
        return { primary, comparison: { type: "custom", from, to } };
      }
      return { primary };
    }

    const computed = computeComparisonRange(primary, cType);
    if (!computed) return { primary };
    return { primary, comparison: { type: cType, ...computed } };
  }

  function applyPreset(preset: Preset) {
    const primary = preset.range();
    onChange(buildPayload(primary, comparisonType, compCustomFrom, compCustomTo));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function applyCustomRange() {
    const from = new Date(customFrom + "T00:00:00.000");
    // Use T23:59:59.999 for consistency with endOfDay() used by presets
    const to = new Date(customTo + "T23:59:59.999");
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      const primary = { from, to };
      onChange(buildPayload(primary, comparisonType, compCustomFrom, compCustomTo));
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function handleComparisonTypeChange(cType: ComparisonType) {
    setComparisonType(cType);
    if (cType !== "custom") {
      onChange(buildPayload(value, cType, compCustomFrom, compCustomTo));
    }
  }

  const comparisonHint =
    comparisonType !== "none" && comparisonType !== "custom"
      ? computeComparisonRange(value, comparisonType)
      : null;

  const isComparisonActive = comparisonType !== "none";

  const periodType = detectPeriodType(value);
  const showNavButtons = periodType !== null;

  // → is disabled when the next period starts after today
  const nextPeriod = showNavButtons ? navigatePeriod(value, 1) : null;
  const startOfToday = startOfDay(new Date());
  const forwardDisabled = nextPeriod !== null && nextPeriod.from > startOfToday;

  const navButtonClass =
    "inline-flex items-center justify-center rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-2 py-2 text-sm text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tremor-brand dark:focus-visible:ring-dark-tremor-brand disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="relative" ref={containerRef} data-testid="date-range-picker">
      <div className="inline-flex items-center gap-1">
        {/* ← prev button */}
        {showNavButtons && (
          <button
            type="button"
            data-testid="nav-prev"
            aria-label="Período anterior"
            className={navButtonClass}
            onClick={() =>
              onChange(buildPayload(navigatePeriod(value, -1), comparisonType, compCustomFrom, compCustomTo))
            }
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}

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
          {isComparisonActive && (
            <span
              data-testid="vs-badge"
              className="inline-flex items-center rounded bg-tremor-brand/10 dark:bg-dark-tremor-brand/10 px-1.5 py-0.5 text-xs font-semibold text-tremor-brand dark:text-dark-tremor-brand"
            >
              vs
            </span>
          )}
        </button>

        {/* → next button */}
        {showNavButtons && (
          <button
            type="button"
            data-testid="nav-next"
            aria-label="Período siguiente"
            disabled={forwardDisabled}
            className={navButtonClass}
            onClick={() =>
              onChange(buildPayload(navigatePeriod(value, 1), comparisonType, compCustomFrom, compCustomTo))
            }
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Selector de rango de fechas"
          className="absolute left-0 z-50 mt-2 w-80 rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background shadow-xl"
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
          <div className="p-3 space-y-2 border-b border-tremor-border dark:border-dark-tremor-border">
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

          {/* Comparison period */}
          <div className="p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              Período de comparación
            </p>
            <select
              data-testid="comparison-type-select"
              value={comparisonType}
              onChange={(e) =>
                handleComparisonTypeChange(e.target.value as ComparisonType)
              }
              className="w-full rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background-subtle px-2 py-1.5 text-sm text-tremor-content dark:text-dark-tremor-content focus:outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
            >
              {(Object.keys(COMPARISON_LABELS) as ComparisonType[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {COMPARISON_LABELS[key]}
                  </option>
                ),
              )}
            </select>

            {comparisonHint && (
              <p
                data-testid="comparison-hint"
                className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle"
              >
                {formatDisplayRange(comparisonHint)}
              </p>
            )}

            {comparisonType === "custom" && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    Comp. desde
                  </span>
                  <input
                    type="date"
                    data-testid="comp-custom-from"
                    value={compCustomFrom}
                    onChange={(e) => setCompCustomFrom(e.target.value)}
                    className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background-subtle px-2 py-1.5 text-sm text-tremor-content dark:text-dark-tremor-content focus:outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    Comp. hasta
                  </span>
                  <input
                    type="date"
                    data-testid="comp-custom-to"
                    value={compCustomTo}
                    onChange={(e) => setCompCustomTo(e.target.value)}
                    className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background-subtle px-2 py-1.5 text-sm text-tremor-content dark:text-dark-tremor-content focus:outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
                  />
                </label>
                <button
                  type="button"
                  data-testid="apply-comparison-btn"
                  onClick={() =>
                    onChange(
                      buildPayload(
                        value,
                        "custom",
                        compCustomFrom,
                        compCustomTo,
                      ),
                    )
                  }
                  className="w-full rounded-lg bg-tremor-brand dark:bg-dark-tremor-brand px-3 py-2 text-sm font-medium text-tremor-brand-inverted dark:text-dark-tremor-brand-inverted hover:bg-tremor-brand-emphasis dark:hover:bg-dark-tremor-brand-emphasis transition-colors"
                >
                  Aplicar comparación
                </button>
              </div>
            )}
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
