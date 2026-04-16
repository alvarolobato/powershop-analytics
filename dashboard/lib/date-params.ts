/**
 * Date parameter substitution for widget SQL queries.
 *
 * Widgets can embed placeholder tokens in SQL strings. This module
 * replaces those tokens with actual date values from the selected range.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface DateParamRanges {
  curr: { from: Date; to: Date };
  comp?: { from: Date; to: Date };
}

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

export const CURR_FROM = "{{CURR_FROM}}";
export const CURR_TO = "{{CURR_TO}}";
export const COMP_FROM = "{{COMP_FROM}}";
export const COMP_TO = "{{COMP_TO}}";
export const CURR_MES_FROM = "{{CURR_MES_FROM}}";
export const CURR_MES_TO = "{{CURR_MES_TO}}";
export const COMP_MES_FROM = "{{COMP_MES_FROM}}";
export const COMP_MES_TO = "{{COMP_MES_TO}}";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns YYYY-MM-DD string for a Date. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

/**
 * Returns YYYYMM integer as string.
 * Dec 2025 -> "202512" (not "202600").
 */
function toMesInt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return y + m;
}

// ---------------------------------------------------------------------------
// substituteDateParams
// ---------------------------------------------------------------------------

/**
 * Replace date placeholder tokens in a SQL string with actual date values.
 *
 * CURR_* tokens are always replaced when ranges.curr is provided.
 * COMP_* tokens are only replaced when ranges.comp is provided;
 * if ranges.comp is undefined, COMP_* tokens are left unchanged
 * (safe for validation, do not execute SQL with unresolved COMP_* tokens).
 */
export function substituteDateParams(
  sql: string,
  ranges: DateParamRanges
): string {
  let result = sql;
  result = result.replaceAll(CURR_FROM, toDateStr(ranges.curr.from));
  result = result.replaceAll(CURR_TO, toDateStr(ranges.curr.to));
  result = result.replaceAll(CURR_MES_FROM, toMesInt(ranges.curr.from));
  result = result.replaceAll(CURR_MES_TO, toMesInt(ranges.curr.to));
  if (ranges.comp) {
    result = result.replaceAll(COMP_FROM, toDateStr(ranges.comp.from));
    result = result.replaceAll(COMP_TO, toDateStr(ranges.comp.to));
    result = result.replaceAll(COMP_MES_FROM, toMesInt(ranges.comp.from));
    result = result.replaceAll(COMP_MES_TO, toMesInt(ranges.comp.to));
  }
  return result;
}

// ---------------------------------------------------------------------------
// comparisonTypeLabel
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable Spanish label describing the comparison period.
 * Returns an empty string for "none" or unknown types.
 */
export function comparisonTypeLabel(type: ComparisonType): string {
  switch (type) {
    case "previous_period":
      return "vs período anterior";
    case "previous_month":
      return "vs mes anterior";
    case "previous_quarter":
      return "vs trimestre anterior";
    case "previous_year":
      return "vs año anterior";
    case "yoy":
      return "vs mismo período año anterior";
    case "custom":
      return "vs período personalizado";
    default:
      return "";
  }
}
