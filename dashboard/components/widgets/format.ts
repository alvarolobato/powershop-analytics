/**
 * European number formatting utilities for Spanish business context.
 * Uses dot for thousands separator, comma for decimal separator.
 */
import type { KpiFormat } from "@/lib/schema";

const euroFormatter = new Intl.NumberFormat("es-ES", {
  useGrouping: true,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("es-ES", {
  useGrouping: true,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("es-ES", {
  useGrouping: true,
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Format a numeric value according to the given KPI format.
 * Returns a string like "1.234,56 €", "1.234", or "12,3%".
 */
export function formatValue(
  value: unknown,
  format: KpiFormat,
  prefix?: string,
): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "—";

  switch (format) {
    case "currency": {
      const formatted = euroFormatter.format(num);
      return prefix ? `${prefix}${formatted}` : formatted;
    }
    case "percent":
      return `${percentFormatter.format(num)}%`;
    case "number":
      return integerFormatter.format(num);
    default:
      return String(num);
  }
}
