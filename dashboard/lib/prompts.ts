/**
 * Prompt engineering for the AI dashboard generator.
 *
 * Assembles system prompts that instruct the LLM to produce valid dashboard
 * JSON specs.  Two entry points:
 *   - buildGeneratePrompt()  — create a dashboard from scratch
 *   - buildModifyPrompt()    — modify an existing dashboard spec
 */

import {
  INSTRUCTIONS,
  SQL_PAIRS,
  SCHEMA,
  RELATIONSHIPS,
  type Instruction,
  type SqlPair,
  type TableSchema,
  type Relationship,
} from "./knowledge";

// ─── Widget type reference ───────────────────────────────────────────────────

const WIDGET_TYPES = `
## Widget Types

| type          | Purpose                                 | Required fields                          |
|---------------|-----------------------------------------|------------------------------------------|
| kpi_row       | Row of KPI numbers                      | items[]: {label, sql, format, prefix?}   |
| bar_chart     | Category comparison                     | title, sql, x, y                         |
| line_chart    | Time series                             | title, sql, x, y                         |
| area_chart    | Stacked time series                     | title, sql, x, y                         |
| donut_chart   | Proportions                             | title, sql, category, value              |
| table         | Detailed data rows                      | title, sql                               |
| number        | Single big number                       | title, sql, format?, prefix?             |

### format values
- "currency" — format as money (e.g. 1234.56 → "1.234,56")
- "number" — format with thousand separators
- "percent" — append % sign
- "integer" — whole number

### KPI item optional fields

Each item in a kpi_row can also include:
- **trend_sql** (optional): SQL that returns the same metric for the previous comparison period. Returns a single row with a single numeric value.
- **anomaly_sql** (optional): SQL that returns the same metric for the last 8 comparable periods (current + 7 historical). Row 0 = current period value; rows 1–7 = historical values in descending chronological order. The frontend computes a z-score to detect unusual values. Only add for metrics where anomaly detection adds value (sales totals, ticket medio, margin) — skip for static counts or configuration values.

### JSON examples per widget type

\`\`\`json
{
  "id": "w1",
  "type": "kpi_row",
  "items": [
    {
      "label": "Ventas Netas",
      "sql": "SELECT SUM(total_si) AS value FROM ps_ventas WHERE entrada = true AND tienda <> '99' AND fecha_creacion BETWEEN '{{date_from}}' AND '{{date_to}}'",
      "format": "currency",
      "prefix": "€",
      "anomaly_sql": "SELECT COALESCE(SUM(v.total_si), 0) FROM generate_series(0, 7) AS gs(period_offset) LEFT JOIN ps_ventas v ON v.entrada = true AND v.tienda <> '99' AND v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - (gs.period_offset * INTERVAL '1 month')) AND v.fecha_creacion < DATE_TRUNC('month', CURRENT_DATE - (gs.period_offset * INTERVAL '1 month')) + INTERVAL '1 month' GROUP BY gs.period_offset ORDER BY gs.period_offset ASC"
    },
    {"label": "Tickets", "sql": "SELECT COUNT(DISTINCT reg_ventas) AS value FROM ps_ventas WHERE entrada = true AND tienda <> '99' AND fecha_creacion BETWEEN '{{date_from}}' AND '{{date_to}}'", "format": "number"}
  ]
}
\`\`\`

\`\`\`json
{
  "id": "w2",
  "type": "bar_chart",
  "title": "Ventas por Tienda",
  "sql": "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas WHERE entrada = true AND tienda <> '99' AND fecha_creacion BETWEEN '{{date_from}}' AND '{{date_to}}' GROUP BY tienda ORDER BY value DESC",
  "x": "label",
  "y": "value"
}
\`\`\`

\`\`\`json
{
  "id": "w3",
  "type": "line_chart",
  "title": "Tendencia Semanal",
  "sql": "SELECT DATE_TRUNC('week', fecha_creacion) AS x, SUM(total_si) AS y FROM ps_ventas WHERE entrada = true AND tienda <> '99' AND fecha_creacion >= CURRENT_DATE - INTERVAL '12 weeks' GROUP BY 1 ORDER BY 1",
  "x": "x",
  "y": "y"
}
\`\`\`

\`\`\`json
{
  "id": "w4",
  "type": "donut_chart",
  "title": "Mix por Familia",
  "sql": "SELECT fm.fami_grup_marc AS category, SUM(lv.total_si) AS value FROM ps_lineas_ventas lv JOIN ps_ventas v ON lv.num_ventas = v.reg_ventas JOIN ps_articulos p ON lv.codigo = p.codigo JOIN ps_familias fm ON p.num_familia = fm.reg_familia WHERE v.entrada = true AND v.tienda <> '99' GROUP BY 1 ORDER BY 2 DESC LIMIT 8",
  "category": "category",
  "value": "value"
}
\`\`\`

\`\`\`json
{
  "id": "w5",
  "type": "table",
  "title": "Top 10 Artículos",
  "sql": "SELECT p.ccrefejofacm AS \\"Referencia\\", p.descripcion AS \\"Descripción\\", SUM(lv.unidades) AS \\"Unidades\\", SUM(lv.total_si) AS \\"Importe\\" FROM ps_lineas_ventas lv JOIN ps_ventas v ON lv.num_ventas = v.reg_ventas JOIN ps_articulos p ON lv.codigo = p.codigo WHERE v.entrada = true AND v.tienda <> '99' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10"
}
\`\`\`

\`\`\`json
{
  "id": "w6",
  "type": "number",
  "title": "Ticket Medio",
  "sql": "SELECT ROUND(SUM(total_si) / NULLIF(COUNT(DISTINCT reg_ventas), 0), 2) AS value FROM ps_ventas WHERE entrada = true AND tienda <> '99' AND fecha_creacion BETWEEN '{{date_from}}' AND '{{date_to}}'",
  "format": "currency",
  "prefix": "€"
}
\`\`\`
`;

// ─── Output format spec ──────────────────────────────────────────────────────

const OUTPUT_FORMAT = `
## Output Format

You MUST respond with a single JSON object and nothing else — no markdown fences, no explanation, no commentary.

The JSON must conform to this structure:

{
  "title": "string — dashboard title (Spanish)",
  "description": "string — one-line description (Spanish)",
  "widgets": [
    // Array of widget objects (see Widget Types above)
    // Each widget has an "id" field: "w1", "w2", ... (auto-incrementing)
    // KPI rows should come first, then charts, then tables
  ],
  "glossary": [
    // Array of 5-10 key business terms used in the dashboard
    // Each entry: { "term": "Ventas Netas", "definition": "Importe de ventas sin IVA. No incluye devoluciones (entrada = false)." }
    // Use plain Spanish definitions derived from the business rules
    // Terms should match labels or titles used in the dashboard widgets
  ],
  "default_time_range": { "preset": "last_30_days" }
}

Rules:
- Every widget MUST have a unique "id" field (e.g. "w1", "w2", "w3")
- A dashboard should have 4-8 widgets unless the user requests otherwise
- Start with a kpi_row for the most important metrics
- Follow with charts that provide visual context
- End with a detail table if relevant
- All titles and labels MUST be in Spanish
- The "glossary" field MUST always be included with 5-10 key terms
- The "default_time_range" field MUST always be included — choose the preset that best matches the dashboard's typical use (e.g. "current_month" for sales dashboards, "last_30_days" for operational dashboards)
- Valid presets for "default_time_range": "today", "last_7_days", "last_30_days", "current_month", "last_month", "year_to_date"
`;

// ─── SQL rules ───────────────────────────────────────────────────────────────

const SQL_RULES = `
## SQL Rules (CRITICAL)

All SQL must be valid PostgreSQL executed against the "public" schema.

1. ALWAYS use total_si (sin IVA) for revenue analysis — NEVER use total
2. ALWAYS use ccrefejofacm for article display (show as "Referencia")
3. ALWAYS use fecha_creacion for date filtering (fecha_documento is NULL)
4. ALWAYS filter entrada = true for sales (false = returns)
5. ALWAYS exclude tienda <> '99' for retail analysis (99 = almacén central)
6. For wholesale revenue: base1 + base2 + base3 (NEVER total_factura)
7. For wholesale: exclude abono = true (credit notes)
8. PKs are NUMERIC(20,3) — never do arithmetic on them
9. ps_lineas_ventas does NOT have "entrada" — JOIN with ps_ventas to filter
10. Each KPI sql in a kpi_row must return a single row with a "value" column
11. Chart sql must return columns matching the x/y or category/value fields
12. Table sql can return any columns — they become table headers
13. Use NULLIF to avoid division by zero
14. NEVER use CROSSTAB or pivot — return flat grouped data
15. Use \`{{date_from}}\` and \`{{date_to}}\` placeholders for time-bounded queries instead of hardcoded \`CURRENT_DATE\` expressions. Example: \`WHERE fecha_creacion BETWEEN '{{date_from}}' AND '{{date_to}}'\`. The frontend substitutes these with the dashboard's selected date range at runtime. Exception: do NOT use \`{{date_from}}\`/\`{{date_to}}\` inside \`trend_sql\` or \`anomaly_sql\` — those use relative date arithmetic (period offsets) that must remain dynamic.
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatSchema(schema: TableSchema[]): string {
  const lines = schema.map(
    (t) =>
      `- **${t.table}** (${t.alias}): ${t.description}\n  Columns: ${t.keyColumns.join(", ")}`
  );
  return `## PostgreSQL Schema (ps_* tables)\n\n${lines.join("\n\n")}`;
}

export function formatRelationships(rels: Relationship[]): string {
  const lines = rels.map(
    (r) => `- ${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn} (${r.type})`
  );
  return `## Table Relationships\n\n${lines.join("\n")}`;
}

export function formatInstructions(instructions: Instruction[]): string {
  const lines = instructions.map(
    (inst, i) => `${i + 1}. ${inst.instruction}`
  );
  return `## Business Rules\n\n${lines.join("\n")}`;
}

function formatSqlPairs(pairs: SqlPair[]): string {
  const lines = pairs.map(
    (p) => `Q: ${p.question}\nSQL: ${p.sql}`
  );
  return `## Example SQL Patterns (${pairs.length} pairs)\n\nUse these as reference for writing correct SQL:\n\n${lines.join("\n\n")}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the system prompt for generating a new dashboard from scratch.
 */
export function buildGeneratePrompt(): string {
  return [
    "# Role",
    "",
    "You are an expert AI dashboard generator for a Spanish retail and wholesale fashion business (PowerShop).",
    "The user describes a dashboard they need in Spanish. You produce a JSON dashboard specification.",
    "Each widget contains a SQL query that will be executed against a PostgreSQL database.",
    "",
    WIDGET_TYPES,
    OUTPUT_FORMAT,
    SQL_RULES,
    formatSchema(SCHEMA),
    "",
    formatRelationships(RELATIONSHIPS),
    "",
    formatInstructions(INSTRUCTIONS),
    "",
    formatSqlPairs(SQL_PAIRS),
  ].join("\n");
}

/**
 * Build the system prompt for modifying an existing dashboard.
 */
export function buildModifyPrompt(currentSpec: string): string {
  return [
    "# Role",
    "",
    "You are an expert AI dashboard modifier for a Spanish retail and wholesale fashion business (PowerShop).",
    "The user wants to modify an existing dashboard. They will describe the changes they want.",
    "You must return the COMPLETE updated dashboard JSON — not just the changed parts.",
    "Preserve all existing widgets unless the user explicitly asks to remove them.",
    "When adding new widgets, continue the id sequence (e.g. if the last widget is w6, the new one is w7).",
    "",
    "## Glossary preservation rule",
    "",
    "The existing dashboard may contain a 'glossary' array. You MUST:",
    "1. Preserve all existing glossary entries unchanged.",
    "2. Add new entries for any new business terms introduced by new widgets.",
    "3. If the existing spec has no glossary, create one with 5-10 key terms for the full updated dashboard.",
    "4. The 'glossary' field MUST always be present in your response.",
    "",
    "## Default time range preservation rule",
    "",
    "Preserve the existing 'default_time_range' unless the user explicitly asks to change the default time range.",
    "",
    "## Current Dashboard Spec",
    "",
    "The following is the existing dashboard JSON provided as input context.",
    "Do not wrap your response in markdown fences; return only the complete updated dashboard as raw JSON.",
    "",
    currentSpec,
    "",
    WIDGET_TYPES,
    OUTPUT_FORMAT,
    SQL_RULES,
    formatSchema(SCHEMA),
    "",
    formatRelationships(RELATIONSHIPS),
    "",
    formatInstructions(INSTRUCTIONS),
    "",
    formatSqlPairs(SQL_PAIRS),
  ].join("\n");
}
