/**
 * HomeViewModel — the shape returned by GET /api/home
 * and consumed by the /inicio home page and its sub-components.
 */

export type HomeViewModel = {
  asOf: string; // "lun 04 may · 11:42"
  hero: {
    todayValue: number; // EUR partial
    forecastEOD: number; // EUR projected end-of-day
    todayPace: number; // signed fraction (e.g. +0.062)
    vsYesterday: number; // signed fraction
    vsLY: number; // signed fraction
    yesterday: number; // EUR
    lastYear: number; // EUR
    status: "on-pace" | "below" | "above";
    hourly: (number | null)[]; // length 24, null after current hour
    hourlyYesterday: number[]; // length 24
  };
  periods: Array<{
    id: "hoy" | "semana" | "mes" | "anyo";
    label: string;
    value: number;
    deltaPrev: number;
    prevLabel: string;
    deltaYoY: number;
    yoyLabel: string;
    spark: number[];
    sparkLabels: string[];
  }>;
  dailyTrend: Array<{ day: number; actual: number | null; ly: number }>;
  topStores: Array<{
    code: string;
    name: string;
    sales: number;
    delta: number; // vs network avg
    spark: number[]; // last 7 days
    status: "ok" | "watch" | "alert";
  }>;
  alerts: Array<{
    sev: "crit" | "warn" | "info";
    store: string; // "{code} — {name}"
    reason: string;
    expected: string;
    since: string;
    action: string; // CTA label
    href?: string;
  }>;
  opsRetail: Metric[];
  opsWholesale: Metric[];
  health: { syncAge: string; lastEtl: string; anomalies: number; rows: number };
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
