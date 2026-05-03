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
    yesterday: number; // EUR
    lastYear: number; // EUR
    status: "on-pace" | "below" | "above";
    hourly: (number | null)[]; // [] when mirror has no time-of-day data
    /** Cumulative-by-hour curve for the **same weekday one week earlier**
     *  (e.g. as-of Saturday → previous Saturday). Weekday-aligned so the
     *  comparison is meaningful for retail patterns; calendar-date-based
     *  comparisons (T-1 day, T-1 year) cross weekday boundaries and were
     *  previously mislabeled in the UI. */
    hourlyComparison: number[];
    /** Human-readable label for the comparison curve, derived in the API
     *  from `asOfDate - 7 days` (e.g. "Mismo sábado 26 abr"). */
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
  }>;
  dailyTrend: Array<{ day: number; actual: number | null; ly: number }>;
  /** All retail stores (excluding tienda='99') sorted by sales DESC for
   *  the as-of date. `name` is derived in the API from
   *  `Tiendas.IdentificadorTienda`, falling back to `Poblacion`. */
  topStores: Array<{
    code: string;
    name: string;
    sales: number;
    /** Δ vs the same store's own 7-day average (excluding the as-of day). */
    delta: number;
    spark: number[]; // last 7 days
    status: "ok" | "watch" | "alert";
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
  delta: number;
  inverted?: boolean; // true for "lower is better"
  sub?: string;
  suffix?: string;
};
