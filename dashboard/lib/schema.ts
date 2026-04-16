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
  /** Optional SQL for trend/comparison period. Returns a single numeric value.
   *  The trend percentage is computed as (current - comparison) / abs(comparison) * 100. */
  trend_sql: optStr,
  /** Optional SQL for anomaly detection. Returns N rows of historical values for
   *  the same metric. The first row is the current period value; remaining rows
   *  are historical values in descending chronological order.
   *  The frontend computes a z-score client-side to detect unusual values. */
  anomaly_sql: optStr,
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

/**
 * Optional tab section for multi-section dashboards.
 * When `sections` is present, the renderer groups widgets under tabs.
 * Backwards compatible: dashboards without `sections` use the flat layout.
 *
 * **Note**: `widget_ids` must reference `id` values set on individual widgets.
 * Widget `id` is optional in the widget schemas, but when `sections` is used,
 * every widget that should appear in a section must have an `id` set.
 * Widgets without `id`, or with `id` not listed in any section, will not render
 * in the tabbed layout. The LLM should always set `id` on all widgets when
 * generating a spec with sections.
 */
const DashboardSectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Ids of widgets that belong to this section. Must match widget `id` fields. */
  widget_ids: z.array(z.string().min(1)).min(1),
}).strict();

/**
 * A single glossary entry with a term and its plain-Spanish definition.
 * Follows the `.strict()` convention of all other schemas in this file.
 */
export const GlossaryItemSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
}).strict();

export const TimeRangePresetSchema = z.enum([
  "today",
  "last_7_days",
  "last_30_days",
  "current_month",
  "last_month",
  "year_to_date",
]);

export const DefaultTimeRangeSchema = z.object({
  preset: TimeRangePresetSchema,
}).strict();

export const DashboardSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  widgets: z.array(WidgetSchema).min(1),
  /** Optional: group widgets into named tabs. Backwards compatible. */
  sections: z.array(DashboardSectionSchema).min(1).optional(),
  /**
   * Optional glossary of key business terms used in the dashboard.
   * When present, matching terms in widget titles and KPI labels will show
   * contextual tooltips. Backwards compatible: existing dashboards without
   * this field render unchanged.
   */
  glossary: z.array(GlossaryItemSchema).min(1).optional(),
  /**
   * Optional default time range preset applied when the dashboard is first opened.
   * Backwards compatible: existing dashboards without this field fall back to
   * last_30_days in the dashboard view.
   * Nullish (accepts null or undefined): LLMs and JSON APIs commonly emit null
   * for absent optional fields, so we treat null the same as undefined here.
   */
  default_time_range: DefaultTimeRangeSchema.nullish(),
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
export type DashboardSection = z.infer<typeof DashboardSectionSchema>;
export type GlossaryItem = z.infer<typeof GlossaryItemSchema>;
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;
export type TimeRangePreset = z.infer<typeof TimeRangePresetSchema>;
export type DefaultTimeRange = z.infer<typeof DefaultTimeRangeSchema>;

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
