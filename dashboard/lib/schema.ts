/**
 * Dashboard JSON spec format: TypeScript types + Zod validation.
 *
 * The LLM generates a dashboard spec (JSON) that the frontend renders.
 * This module defines the canonical shape and validates untrusted input.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const KpiFormatSchema = z.enum(["currency", "number", "percent"]);

/** Optional string that must be non-empty when provided. */
const optStr = z.string().min(1).optional();

const KpiItemSchema = z.object({
  label: z.string().min(1),
  sql: z.string().min(1),
  format: KpiFormatSchema,
  prefix: optStr,
}).strict();

const KpiRowWidgetSchema = z.object({
  id: optStr,
  type: z.literal("kpi_row"),
  items: z.array(KpiItemSchema).min(1),
}).strict();

const BarChartWidgetSchema = z.object({
  id: optStr,
  type: z.literal("bar_chart"),
  title: z.string().min(1),
  sql: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
}).strict();

const LineChartWidgetSchema = z.object({
  id: optStr,
  type: z.literal("line_chart"),
  title: z.string().min(1),
  sql: z.string().min(1),
  x: optStr,
  y: optStr,
}).strict();

const AreaChartWidgetSchema = z.object({
  id: optStr,
  type: z.literal("area_chart"),
  title: z.string().min(1),
  sql: z.string().min(1),
  x: optStr,
  y: optStr,
}).strict();

const DonutChartWidgetSchema = z.object({
  id: optStr,
  type: z.literal("donut_chart"),
  title: z.string().min(1),
  sql: z.string().min(1),
  x: optStr,
  y: optStr,
}).strict();

const TableWidgetSchema = z.object({
  id: optStr,
  type: z.literal("table"),
  title: z.string().min(1),
  sql: z.string().min(1),
}).strict();

const NumberWidgetSchema = z.object({
  id: optStr,
  type: z.literal("number"),
  title: z.string().min(1),
  sql: z.string().min(1),
  format: KpiFormatSchema,
  prefix: optStr,
}).strict();

export const WidgetSchema = z.discriminatedUnion("type", [
  KpiRowWidgetSchema,
  BarChartWidgetSchema,
  LineChartWidgetSchema,
  AreaChartWidgetSchema,
  DonutChartWidgetSchema,
  TableWidgetSchema,
  NumberWidgetSchema,
]);

export const DashboardSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  widgets: z.array(WidgetSchema).min(1),
}).strict();

// ---------------------------------------------------------------------------
// TypeScript types (inferred from Zod — single source of truth)
// ---------------------------------------------------------------------------

export type KpiFormat = z.infer<typeof KpiFormatSchema>;
export type KpiItem = z.infer<typeof KpiItemSchema>;
export type KpiRowWidget = z.infer<typeof KpiRowWidgetSchema>;
export type BarChartWidget = z.infer<typeof BarChartWidgetSchema>;
export type LineChartWidget = z.infer<typeof LineChartWidgetSchema>;
export type AreaChartWidget = z.infer<typeof AreaChartWidgetSchema>;
export type DonutChartWidget = z.infer<typeof DonutChartWidgetSchema>;
export type TableWidget = z.infer<typeof TableWidgetSchema>;
export type NumberWidget = z.infer<typeof NumberWidgetSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Validate and parse an unknown JSON value into a DashboardSpec.
 * Throws a ZodError with detailed messages if validation fails.
 */
export function validateSpec(json: unknown): DashboardSpec {
  return DashboardSpecSchema.parse(json);
}
