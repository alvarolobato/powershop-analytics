/**
 * Date-range parameter token substitution for dashboard SQL.
 *
 * SQL strings can embed placeholder tokens that are replaced at render time
 * with the actual date range values selected by the user.
 */

export const CURR_FROM = ":curr_from";
export const CURR_TO   = ":curr_to";
export const COMP_FROM = ":comp_from";
export const COMP_TO   = ":comp_to";

export const CURR_MES_FROM = ":curr_mes_from";
export const CURR_MES_TO   = ":curr_mes_to";
export const COMP_MES_FROM = ":comp_mes_from";
export const COMP_MES_TO   = ":comp_mes_to";

export interface DateParamRanges {
  curr: { from: Date; to: Date };
  comp?: { from: Date; to: Date };
}

function toDateStr(d: Date): string {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day   = String(d.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function toMesInt(d: Date): string {
  return String(d.getFullYear() * 100 + (d.getMonth() + 1));
}

export function substituteDateParams(
  sql: string,
  ranges: DateParamRanges,
): string {
  let result = sql
    .replaceAll(CURR_FROM, toDateStr(ranges.curr.from))
    .replaceAll(CURR_TO,   toDateStr(ranges.curr.to))
    .replaceAll(CURR_MES_FROM, toMesInt(ranges.curr.from))
    .replaceAll(CURR_MES_TO,   toMesInt(ranges.curr.to));

  if (ranges.comp !== undefined) {
    result = result
      .replaceAll(COMP_FROM, toDateStr(ranges.comp.from))
      .replaceAll(COMP_TO,   toDateStr(ranges.comp.to))
      .replaceAll(COMP_MES_FROM, toMesInt(ranges.comp.from))
      .replaceAll(COMP_MES_TO,   toMesInt(ranges.comp.to));
  }

  return result;
}
