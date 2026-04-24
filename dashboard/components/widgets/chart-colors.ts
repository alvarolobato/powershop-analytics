/**
 * Chart color palette using CSS variable references.
 * Resolves to the current theme accent/semantic colors at render time.
 */

/**
 * Legacy string[] palette for Tremor components that require an array.
 * New custom SVG widgets should use resolveChartColor() instead.
 */
export const CHART_COLORS_ARRAY: string[] = [
  "indigo",
  "cyan",
  "rose",
  "amber",
  "violet",
  "emerald",
  "orange",
  "sky",
  "fuchsia",
  "teal",
];

export const CHART_COLORS = {
  primary: "var(--accent)",
  secondary: "var(--accent-2)",
  amber: "#f59e0b",
  pink: "#ec4899",
  emerald: "#34d399",
  up: "var(--up)",
  down: "var(--down)",
  warn: "var(--warn)",
} as const;

/**
 * Resolve a chart color for a given series index and optional semantic kind.
 * kind overrides the index-based categorical palette.
 */
export function resolveChartColor(index: number, kind?: "up" | "down" | "warn"): string {
  if (kind === "up") return CHART_COLORS.up;
  if (kind === "down") return CHART_COLORS.down;
  if (kind === "warn") return CHART_COLORS.warn;
  const categorical: string[] = [
    CHART_COLORS.primary,
    CHART_COLORS.secondary,
    CHART_COLORS.amber,
    CHART_COLORS.pink,
    CHART_COLORS.emerald,
  ];
  return categorical[index % categorical.length];
}
