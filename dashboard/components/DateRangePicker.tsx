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

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// ISO week: Monday = day 1. Returns the Monday of the week containing `d`.
export function isoWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift so Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

export function currentQuarterStart(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

// Current-period presets (in-progress)
export const CURRENT_PRESETS: Preset[] = [
  {
    label: "Hoy",
    range: () => {
      const now = new Date();
      return { from: startOfDay(now), to: endOfDay(now) };
    },
  },
  {
    label: "Semana actual",
    range: () => {
      const now = new Date();
      const monday = isoWeekMonday(now);
      return { from: startOfDay(monday), to: endOfDay(now) };
    },
  },
  {
    label: "Mes actual",
    range: () => {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(firstOfMonth), to: endOfDay(now) };
    },
  },
  {
    label: "Trimestre actual",
    range: () => {
      const now = new Date();
      return { from: startOfDay(currentQuarterStart(now)), to: endOfDay(now) };
    },
  },
  {
    label: "Año actual",
    range: () => {
      const now = new Date();
      const jan1 = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(jan1), to: endOfDay(now) };
    },
  },
];

// Previous-period presets (complete periods)
export const PREVIOUS_PRESETS: Preset[] = [
  {
    label: "Ayer",
    range: () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    },
  },
  {
    label: "Semana anterior",
    range: () => {
      const now = new Date();
      const thisMonday = isoWeekMonday(now);
      const prevSunday = new Date(thisMonday);
      prevSunday.setDate(thisMonday.getDate() - 1);
      const prevMonday = new Date(thisMonday);
      prevMonday.setDate(thisMonday.getDate() - 7);
      return { from: startOfDay(prevMonday), to: endOfDay(prevSunday) };
    },
  },
  {
    label: "Mes anterior",
    range: () => {
      const now = new Date();
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfPrevMonth = new Date(firstOfThisMonth);
      lastOfPrevMonth.setDate(0); // last day of prev month
      const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
      return { from: startOfDay(firstOfPrevMonth), to: endOfDay(lastOfPrevMonth) };
    },
  },
  {
    label: "Trimestre anterior",
    range: () => {
      const now = new Date();
      const thisQStart = currentQuarterStart(now);
      const prevQEnd = new Date(thisQStart);
      prevQEnd.setDate(0); // last day of month before this quarter
      const prevQStart = currentQuarterStart(prevQEnd);
      return { from: startOfDay(prevQStart), to: endOfDay(prevQEnd) };
    },
  },
  {
    label: "Año anterior",
    range: () => {
      const prevYear = new Date().getFullYear() - 1;
      return {
        from: new Date(prevYear, 0, 1, 0, 0, 0, 0),
        to: new Date(prevYear, 11, 31, 23, 59, 59, 999),
      };
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
// Period detection and formatting
// ---------------------------------------------------------------------------

const MONTHS_ES_LONG = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const MONTHS_ES_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

const DAYS_ES_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function isoWeekNumber(d: Date): number {
  // Move to the Thursday of the week (ISO weeks are numbered by their Thursday)
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  );
}

export function detectPeriodType(
  range: DateRange,
): "day" | "week" | "month" | "quarter" | "year" | null {
  const { from, to } = range;

  // All named periods require from at start-of-day and to at end-of-day
  if (
    from.getHours() !== 0 ||
    from.getMinutes() !== 0 ||
    from.getSeconds() !== 0 ||
    from.getMilliseconds() !== 0
  ) {
    return null;
  }
  if (
    to.getHours() !== 23 ||
    to.getMinutes() !== 59 ||
    to.getSeconds() !== 59 ||
    to.getMilliseconds() !== 999
  ) {
    return null;
  }

  const today = new Date();
  const eodToday = endOfDay(today);
  const isEndToday = to.getTime() === eodToday.getTime();

  // --- day: from and to are on the same calendar date ---
  if (
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate()
  ) {
    return "day";
  }

  // --- month: from is 1st of any month ---
  // Checked before year so that "current month" in January (Jan 1 → today) is labelled
  // as "Enero 2026" rather than "2026" — a partial January matches both month and year
  // criteria and the more specific label wins. Also checked before quarter so that a
  // quarter-starting month (Jan/Apr/Jul/Oct) is labelled as a month when the range only
  // covers that single month.
  if (from.getDate() === 1) {
    const endOfMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);
    if (to.getTime() === endOfMonth.getTime()) return "month";
    if (
      isEndToday &&
      today.getFullYear() === from.getFullYear() &&
      today.getMonth() === from.getMonth()
    ) {
      return "month";
    }
  }

  // --- year: from is Jan 1, to is Dec 31 or end-of-today in same year ---
  // Checked after month so that a partial January (Jan 1 → today) is labelled as a month.
  if (from.getMonth() === 0 && from.getDate() === 1) {
    const endOfYear = new Date(from.getFullYear(), 11, 31, 23, 59, 59, 999);
    if (to.getTime() === endOfYear.getTime()) return "year";
    if (isEndToday && today.getFullYear() === from.getFullYear()) return "year";
  }

  // --- quarter: from is 1st of a quarter month (Jan/Apr/Jul/Oct) ---
  if (from.getDate() === 1 && from.getMonth() % 3 === 0) {
    const qEndMonth = from.getMonth() + 2;
    const endOfQuarter = new Date(from.getFullYear(), qEndMonth + 1, 0, 23, 59, 59, 999);
    if (to.getTime() === endOfQuarter.getTime()) return "quarter";
    if (isEndToday) {
      const todayQStart = currentQuarterStart(today);
      if (
        todayQStart.getFullYear() === from.getFullYear() &&
        todayQStart.getMonth() === from.getMonth()
      ) {
        return "quarter";
      }
    }
  }

  // --- week: from is ISO Monday ---
  {
    const monday = isoWeekMonday(from);
    if (monday.getTime() === from.getTime()) {
      const sunday = new Date(from);
      sunday.setDate(from.getDate() + 6);
      const endOfSunday = endOfDay(sunday);
      if (to.getTime() === endOfSunday.getTime()) return "week";
      if (isEndToday) {
        const todayMonday = isoWeekMonday(today);
        if (
          todayMonday.getFullYear() === from.getFullYear() &&
          todayMonday.getMonth() === from.getMonth() &&
          todayMonday.getDate() === from.getDate()
        ) {
          return "week";
        }
      }
    }
  }

  return null;
}

export function formatPeriodLabel(range: DateRange): string {
  const type = detectPeriodType(range);
  const { from } = range;
  const today = new Date();

  switch (type) {
    case "day": {
      const isToday =
        from.getFullYear() === today.getFullYear() &&
        from.getMonth() === today.getMonth() &&
        from.getDate() === today.getDate();
      if (isToday) return "Hoy";
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const isYesterday =
        from.getFullYear() === yesterday.getFullYear() &&
        from.getMonth() === yesterday.getMonth() &&
        from.getDate() === yesterday.getDate();
      if (isYesterday) return "Ayer";
      const dayName = DAYS_ES_SHORT[from.getDay()];
      return `${dayName} ${from.getDate()} ${MONTHS_ES_SHORT[from.getMonth()]} ${from.getFullYear()}`;
    }

    case "week": {
      const weekNum = isoWeekNumber(from);
      const eodToday = endOfDay(today);
      const isCurrentWeek = range.to.getTime() === eodToday.getTime();
      const startDay = from.getDate();
      const startMon = MONTHS_ES_SHORT[from.getMonth()];
      const startYear = from.getFullYear();
      if (isCurrentWeek) {
        return `Semana ${weekNum} • ${startDay} ${startMon} →`;
      }
      const sunday = new Date(from);
      sunday.setDate(from.getDate() + 6);
      const endDay = sunday.getDate();
      const endMon = MONTHS_ES_SHORT[sunday.getMonth()];
      const endYear = sunday.getFullYear();
      if (startMon === endMon && startYear === endYear) {
        return `Semana ${weekNum} • ${startDay}-${endDay} ${startMon} ${startYear}`;
      }
      return `Semana ${weekNum} • ${startDay} ${startMon} – ${endDay} ${endMon} ${endYear}`;
    }

    case "month":
      return `${MONTHS_ES_LONG[from.getMonth()]} ${from.getFullYear()}`;

    case "quarter": {
      const q = Math.floor(from.getMonth() / 3) + 1;
      const qStartMon = MONTHS_ES_SHORT[from.getMonth()];
      const qEndMon = MONTHS_ES_SHORT[from.getMonth() + 2];
      return `T${q} ${from.getFullYear()} • ${qStartMon}-${qEndMon}`;
    }

    case "year":
      return `${from.getFullYear()}`;

    default: {
      // Custom/null: compact date pair "D mon – D mon year" (year shown once if same year)
      const d1 = from.getDate();
      const m1 = MONTHS_ES_SHORT[from.getMonth()];
      const y1 = from.getFullYear();
      const d2 = range.to.getDate();
      const m2 = MONTHS_ES_SHORT[range.to.getMonth()];
      const y2 = range.to.getFullYear();
      if (y1 === y2) return `${d1} ${m1} – ${d2} ${m2} ${y2}`;
      return `${d1} ${m1} ${y1} – ${d2} ${m2} ${y2}`;
    }
  }
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
        <span className="hidden sm:inline">{formatPeriodLabel(value)}</span>
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

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Selector de rango de fechas"
          className="absolute left-0 z-50 mt-2 w-80 rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background shadow-xl"
        >
          {/* Presets — two-column grid */}
          <div className="border-b border-tremor-border dark:border-dark-tremor-border p-2">
            <div className="mb-1 grid grid-cols-2 gap-x-2 px-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Período actual
              </p>
              <p className="text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Período anterior
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-1">
              <div>
                {CURRENT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div>
                {PREVIOUS_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
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
