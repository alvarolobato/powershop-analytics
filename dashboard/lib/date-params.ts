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

export type ComparisonType =
  | "previous_period"
  | "previous_month"
  | "previous_quarter"
  | "previous_year"
  | "yoy"
  | "custom";

export interface ComparisonRange { from: Date; to: Date; }
export interface DateParamRanges { curr: { from: Date; to: Date }; comp?: ComparisonRange; }

function toDateStr(d: Date): string { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0"); return y + "-" + m + "-" + day; }
function toMesInt(d: Date): number { return d.getFullYear() * 100 + (d.getMonth() + 1); }

export function substituteDateParams(sql: string, ranges: DateParamRanges): string {
  let result = sql;
  result = result.replaceAll(CURR_FROM, "'" + toDateStr(ranges.curr.from) + "'");
  result = result.replaceAll(CURR_TO, "'" + toDateStr(ranges.curr.to) + "'");
  result = result.replaceAll(CURR_MES_FROM, String(toMesInt(ranges.curr.from)));
  result = result.replaceAll(CURR_MES_TO, String(toMesInt(ranges.curr.to)));
  if (ranges.comp) {
    result = result.replaceAll(COMP_FROM, "'" + toDateStr(ranges.comp.from) + "'");
    result = result.replaceAll(COMP_TO, "'" + toDateStr(ranges.comp.to) + "'");
    result = result.replaceAll(COMP_MES_FROM, String(toMesInt(ranges.comp.from)));
    result = result.replaceAll(COMP_MES_TO, String(toMesInt(ranges.comp.to)));
  }
  return result;
}

export function comparisonTypeLabel(type: ComparisonType): string {
  switch (type) {
    case "previous_period": return "vs período anterior";
    case "previous_month":  return "vs mes anterior";
    case "previous_quarter": return "vs trimestre anterior";
    case "previous_year":   return "vs año anterior";
    case "yoy":             return "vs mismo período año anterior";
    case "custom":          return "vs período personalizado";
  }
}
