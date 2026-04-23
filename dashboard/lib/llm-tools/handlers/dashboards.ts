/**
 * Dashboard context tools (saved specs in PostgreSQL).
 */

import { z } from "zod";
import { sql } from "@/lib/db-write";
import { DashboardSpecSchema, type DashboardSpec } from "@/lib/schema";
import { substituteDateParams, type DateParamRanges } from "@/lib/date-params";
import { validateReadOnly, query, SqlValidationError } from "@/lib/db";
import { validateQueryCost, QueryTooExpensiveError } from "@/lib/query-validator";
import { lintWidgetSql } from "@/lib/sql-heuristics";
import { extractDashboardSqlRefs } from "../dashboard-query-extractor";
import type { LlmAgenticContext } from "../types";
import { toolError, toolOk, type ToolResponseBody } from "../tool-payload";
import { getAgenticConfig } from "../config";

const LimitSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const IdSchema = z.object({
  dashboard_id: z.number().int().positive(),
});

const WidgetRawSchema = z.object({
  dashboard_id: z.number().int().positive(),
  widget_index: z.number().int().min(0),
  kpi_item_index: z.number().int().min(0).optional(),
  date_range: z
    .object({
      curr_from: z.string().optional(),
      curr_to: z.string().optional(),
      comp_from: z.string().optional(),
      comp_to: z.string().optional(),
    })
    .optional(),
});

function parseDayStartUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) throw new Error("bad date");
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function parseDayEndUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) throw new Error("bad date");
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

function defaultRanges(): DateParamRanges {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { curr: { from, to } };
}

function rangesFromTool(
  dr: z.infer<typeof WidgetRawSchema>["date_range"],
): DateParamRanges {
  if (dr?.curr_from && dr?.curr_to) {
    try {
      const curr = {
        from: parseDayStartUtc(dr.curr_from),
        to: parseDayEndUtc(dr.curr_to),
      };
      const comp =
        dr.comp_from && dr.comp_to
          ? {
              from: parseDayStartUtc(dr.comp_from),
              to: parseDayEndUtc(dr.comp_to),
            }
          : undefined;
      return { curr, comp };
    } catch {
      return defaultRanges();
    }
  }
  return defaultRanges();
}

async function loadSpecRow(
  dashboardId: number,
  ctx: LlmAgenticContext,
): Promise<{ spec: DashboardSpec } | ToolResponseBody> {
  const rows = await sql<{ spec: unknown }>(
    `SELECT spec FROM dashboards WHERE id = $1`,
    [dashboardId],
  );
  if (!rows.length) {
    return toolError("NOT_FOUND", `Dashboard ${dashboardId} not found.`, ctx);
  }
  const parsed = DashboardSpecSchema.safeParse(rows[0].spec);
  if (!parsed.success) {
    return toolError("INVALID_SPEC", "Stored dashboard spec failed validation.", ctx);
  }
  return { spec: parsed.data };
}

export async function handleListDashboards(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let limit = 30;
  try {
    const j = JSON.parse(rawArgs || "{}");
    const p = LimitSchema.safeParse(j);
    if (p.success && p.data.limit) limit = p.data.limit;
  } catch {
    /* default */
  }
  try {
    const rows = await sql<{
      id: number;
      name: string;
      description: string | null;
      updated_at: Date;
    }>(
      `SELECT id, name, description, updated_at
       FROM dashboards
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    );
    return toolOk({
      dashboards: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        updated_at: r.updated_at,
      })),
    });
  } catch {
    return toolError("DB_ERROR", "Could not list dashboards.", ctx);
  }
}

export async function handleGetDashboardSpec(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: z.infer<typeof IdSchema>;
  try {
    args = IdSchema.parse(JSON.parse(rawArgs || "{}"));
  } catch {
    return toolError("INVALID_ARGS", "Invalid arguments for get_dashboard_spec.", ctx);
  }
  const row = await loadSpecRow(args.dashboard_id, ctx);
  if (!("spec" in row)) return row;
  return toolOk({ dashboard_id: args.dashboard_id, spec: row.spec });
}

export async function handleGetDashboardQueries(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: z.infer<typeof IdSchema>;
  try {
    args = IdSchema.parse(JSON.parse(rawArgs || "{}"));
  } catch {
    return toolError("INVALID_ARGS", "Invalid arguments for get_dashboard_queries.", ctx);
  }
  const row = await loadSpecRow(args.dashboard_id, ctx);
  if (!("spec" in row)) return row;
  const refs = extractDashboardSqlRefs(row.spec);
  return toolOk({
    dashboard_id: args.dashboard_id,
    queries: refs.map((r) => ({
      widget_index: r.widgetIndex,
      widget_id: r.widgetId ?? null,
      label: r.label,
      kind: r.kind,
      kpi_item_index: r.kpiItemIndex ?? null,
      sql: r.sql,
    })),
  });
}

export async function handleGetDashboardWidgetRawValues(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  const { maxRows, maxColumns } = getAgenticConfig();
  let args: z.infer<typeof WidgetRawSchema>;
  try {
    args = WidgetRawSchema.parse(JSON.parse(rawArgs || "{}"));
  } catch {
    return toolError(
      "INVALID_ARGS",
      "Invalid arguments for get_dashboard_widget_raw_values.",
      ctx,
    );
  }
  const row = await loadSpecRow(args.dashboard_id, ctx);
  if (!("spec" in row)) return row;
  const spec = row.spec;
  const widget = spec.widgets[args.widget_index];
  if (!widget) {
    return toolOk({
      error: `widget_index ${args.widget_index} out of range`,
      rows: [],
      columns: [],
    });
  }

  let sqlText: string;
  let label: string;
  if (widget.type === "kpi_row") {
    if (args.kpi_item_index === undefined) {
      return toolOk({
        error: "kpi_item_index is required for kpi_row widgets.",
        rows: [],
        columns: [],
      });
    }
    const item = widget.items[args.kpi_item_index];
    if (!item) {
      return toolOk({
        error: `kpi_item_index ${args.kpi_item_index} out of range`,
        rows: [],
        columns: [],
      });
    }
    sqlText = item.sql;
    label = item.label;
  } else {
    sqlText = widget.sql;
    label = widget.title;
  }

  const ranges = rangesFromTool(args.date_range);
  const filled = substituteDateParams(sqlText, ranges);

  try {
    validateReadOnly(filled);
  } catch (e) {
    if (e instanceof SqlValidationError) {
      return toolOk({
        error: e.message,
        label,
        rows: [],
        columns: [],
      });
    }
    return toolError("VALIDATION_FAILED", "SQL validation failed.", ctx);
  }

  try {
    await validateQueryCost(filled);
  } catch (e) {
    if (e instanceof QueryTooExpensiveError) {
      return toolOk({
        error: "Query exceeds configured cost limit.",
        label,
        estimated_cost: e.cost,
        cost_limit: e.limit,
        rows: [],
        columns: [],
      });
    }
  }

  try {
    const res = await query(filled);
    const colCount = Math.min(res.columns.length, maxColumns);
    const clippedCols = res.columns.slice(0, colCount);
    const clippedRows = res.rows.slice(0, maxRows).map((r) => r.slice(0, colCount));
    return toolOk({
      label,
      columns: clippedCols,
      rows: clippedRows,
      truncated: res.rows.length > maxRows || res.columns.length > maxColumns,
    });
  } catch {
    return toolOk({
      error: "Query execution failed.",
      label,
      rows: [],
      columns: [],
    });
  }
}

export async function handleGetDashboardAllWidgetStatus(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: z.infer<typeof IdSchema>;
  try {
    args = IdSchema.parse(JSON.parse(rawArgs || "{}"));
  } catch {
    return toolError(
      "INVALID_ARGS",
      "Invalid arguments for get_dashboard_all_widget_status.",
      ctx,
    );
  }
  const row = await loadSpecRow(args.dashboard_id, ctx);
  if (!("spec" in row)) return row;
  const refs = extractDashboardSqlRefs(row.spec);
  const statuses: {
    widget_index: number;
    label: string;
    kind: string;
    ok: boolean;
    lint_issues: string[];
    cost?: number;
    error?: string;
  }[] = [];

  for (const r of refs) {
    const lint_issues = lintWidgetSql(r.sql);
    try {
      validateReadOnly(r.sql);
    } catch (e) {
      statuses.push({
        widget_index: r.widgetIndex,
        label: r.label,
        kind: r.kind,
        ok: false,
        lint_issues,
        error: e instanceof SqlValidationError ? e.message : "read-only violation",
      });
      continue;
    }
    try {
      const cost = await validateQueryCost(r.sql);
      statuses.push({
        widget_index: r.widgetIndex,
        label: r.label,
        kind: r.kind,
        ok: lint_issues.length === 0,
        lint_issues,
        cost,
      });
    } catch (e) {
      if (e instanceof QueryTooExpensiveError) {
        statuses.push({
          widget_index: r.widgetIndex,
          label: r.label,
          kind: r.kind,
          ok: false,
          lint_issues,
          cost: e.cost,
          error: "cost limit exceeded",
        });
      } else {
        statuses.push({
          widget_index: r.widgetIndex,
          label: r.label,
          kind: r.kind,
          ok: lint_issues.length === 0,
          lint_issues,
        });
      }
    }
  }

  return toolOk({ dashboard_id: args.dashboard_id, widgets: statuses });
}
