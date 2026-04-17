// ---------------------------------------------------------------------------
// Date param substitution tokens
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
// Types
// ---------------------------------------------------------------------------

export interface ComparisonRange {
  from: Date;
  to: Date;
}

export interface DateParamRanges {
  curr: { from: Date; to: Date };
  comp?: ComparisonRange;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// Returns YYYYMM integer. getMonth()+1 ensures Dec 2025 -> 202512, not 202600.
function toMesInt(d: Date): number {
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

// ---------------------------------------------------------------------------
// substituteDateParams
// ---------------------------------------------------------------------------

/**
 * Replace date param tokens in a SQL string with the concrete values from
 * the supplied ranges.  SQL that contains no tokens is returned unchanged
 * (no-op, safe to call on all queries).
 *
 * COMP_* tokens are left untouched when ranges.comp is undefined.
 */
export function substituteDateParams(
  sql: string,
  ranges: DateParamRanges,
): string {
  let result = sql;

  result = result.replaceAll(CURR_FROM, "'" + toDateStr(ranges.curr.from) + "'");
  result = result.replaceAll(CURR_TO, "'" + toDateStr(ranges.curr.to) + "'");
  result = result.replaceAll(
    CURR_MES_FROM,
    String(toMesInt(ranges.curr.from)),
  );
  result = result.replaceAll(CURR_MES_TO, String(toMesInt(ranges.curr.to)));

  if (ranges.comp) {
    result = result.replaceAll(COMP_FROM, "'" + toDateStr(ranges.comp.from) + "'");
    result = result.replaceAll(COMP_TO, "'" + toDateStr(ranges.comp.to) + "'");
    result = result.replaceAll(
      COMP_MES_FROM,
      String(toMesInt(ranges.comp.from)),
    );
    result = result.replaceAll(
      COMP_MES_TO,
      String(toMesInt(ranges.comp.to)),
    );
  }

  return result;
}
