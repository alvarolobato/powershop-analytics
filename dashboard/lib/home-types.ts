/**
 * HomeViewModel — the shape returned by GET /api/home
 * and consumed by the /inicio home page and its sub-components.
 *
 * Scope: retail-only. Wholesale ("mayorista") is intentionally NOT
 * represented here — the home page is dedicated to the retail business
 * and any wholesale view lives in its own panel.
 */

export type HomeViewModel = {
  asOf: string; // freshness label, e.g. "dom 03 may · 04:00"
  asOfDate: string; // ISO YYYY-MM-DD of the as-of business day
  /** Most recent business day with retail sales in the mirror.
   *  Used to clamp the date navigator's "next" arrow. */
  maxAvailableDate: string;
  hero: {
    todayValue: number; // EUR
    forecastEOD: number; // EUR projected end-of-day (= todayValue when no projection model)
    todayPace: number; // signed fraction (0 when no intraday data)
    vsYesterday: number; // signed fraction
    vsLY: number; // signed fraction
    yesterday: number; // EUR (full-day total — context line under the delta)
    lastYear: number; // EUR (full-day total — context line under the delta)
    /** Hour (0–23 in Europe/Madrid) used as the same-hour cutoff for the
     *  `vsYesterday` / `vsLY` deltas while the as-of day is still in
     *  progress. `null` when the as-of day is closed (full-day vs full-day
     *  is honest), in which case the deltas use `yesterday` and
     *  `lastYear`. */
    comparisonCutoffHour: number | null;
    /** Yesterday's running total up to (and including) `comparisonCutoffHour`.
     *  Set in tandem with `comparisonCutoffHour`; `null` when no cutoff is
     *  in effect. The UI shows it in small print to explain the delta. */
    yesterdayCutoff: number | null;
    /** Same as `yesterdayCutoff` for last year same date. */
    lastYearCutoff: number | null;
    status: "on-pace" | "below" | "above";
    hourly: (number | null)[]; // [] when mirror has no time-of-day data
    /** Cumulative-by-hour curve for the **same weekday one week earlier**
     *  (e.g. as-of Saturday → previous Saturday). Weekday-aligned so the
     *  comparison is meaningful for retail patterns; calendar-date-based
     *  comparisons (T-1 day, T-1 year) cross weekday boundaries and were
     *  previously mislabeled in the UI. */
    hourlyComparison: number[];
    /** Human-readable label for the comparison curve, derived in the API
     *  from the weekday of `asOfDate - 7 days` (e.g. "Sábado anterior"). */
    comparisonLabel: string;
  };
  periods: Array<{
    id: "hoy" | "semana" | "mes" | "anyo";
    label: string;
    value: number;
    deltaPrev: number;
    prevLabel: string;
    /** Year-over-year delta as a signed fraction. Nullable when YoY isn't
     *  available (e.g. brand-new metric / store, or first calendar year). */
    deltaYoY: number | null;
    yoyLabel: string;
    spark: number[];
    sparkLabels: string[];
    /** Number of consecutive complete ISO weeks where this period's sales
     *  were below the same ISO week of the prior year. 0 = no decline streak.
     *  Only meaningful on the "semana" period; undefined on others. */
    streakWeeks?: number;
    /** Direction of the spark trend derived from a linear slope over all
     *  spark data points. */
    trendDirection?: "up" | "flat" | "down";
  }>;
  dailyTrend: Array<{ day: number; actual: number | null; ly: number }>;
  /** Active retail stores (excluding tienda='99' and any store with zero
   *  sales in the last 30 days), sorted by sales DESC for the as-of
   *  date. `name` is derived in the API from `Tiendas.IdentificadorTienda`,
   *  falling back to `Poblacion`. */
  topStores: Array<{
    code: string;
    name: string;
    sales: number;
    /** Δ vs the same store's own 7-day average (excluding the as-of day). */
    delta: number;
    spark: number[]; // last 7 days
    status: "ok" | "watch" | "alert";
    /** Consecutive complete ISO weeks where this store's sales were below
     *  the same ISO week of the prior year. 0 = no decline streak. */
    streakWeeks: number;
  }>;
  /** Stores excluded from `topStores` because they had no sales in the
   *  last 30 days. Surfaced under "Ver tiendas inactivas" so they remain
   *  discoverable without burying the active list. */
  inactiveStores: Array<{
    code: string;
    name: string;
    /** Most recent date the store sold anything (any time, not limited
     *  to 30 days). `null` when the mirror has no record at all. */
    lastSaleDate: string | null;
  }>;
  opsRetail: Metric[];
  health: { syncAge: string; lastEtl: string; anomalies: number; rows: number };
};

/** Standalone alert type — no longer part of HomeViewModel (the home page
 *  is retail-only and does not surface alerts). Kept exported because the
 *  AlertsPanel component is still used in admin/diagnostic contexts. */
export type HomeAlert = {
  sev: "crit" | "warn" | "info";
  store: string;
  reason: string;
  expected: string;
  since: string;
  action: string;
  href?: string;
};

export type Metric = {
  id: string;
  label: string;
  value: number;
  format: "eur" | "eur2" | "int" | "pct" | "x";
  /** Signed fraction vs previous period, or null when no comparison data. */
  delta: number | null;
  inverted?: boolean; // true for "lower is better"
  sub?: string;
  suffix?: string;
};
