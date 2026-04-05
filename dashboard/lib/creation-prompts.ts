/**
 * Prompt builders for smart dashboard creation features:
 *   - buildSuggestPrompt()   — role-based dashboard suggestions
 *   - buildGapAnalysisPrompt() — coverage gap analysis
 *
 * Both functions embed schema, business rules, and example SQL patterns from
 * knowledge.ts so the LLM has full context for generating useful suggestions.
 */

import { INSTRUCTIONS, SCHEMA, RELATIONSHIPS } from "./knowledge";
import type { TableSchema, Relationship, Instruction } from "./knowledge";

// ─── Helpers (re-exported for testing) ──────────────────────────────────────

export function formatSchemaForSuggest(schema: TableSchema[]): string {
  const lines = schema.map(
    (t) =>
      `- **${t.table}** (${t.alias}): ${t.description}\n  Columns: ${t.keyColumns.join(", ")}`
  );
  return `## PostgreSQL Schema (ps_* tables)\n\n${lines.join("\n\n")}`;
}

export function formatRelationshipsForSuggest(rels: Relationship[]): string {
  const lines = rels.map(
    (r) => `- ${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn} (${r.type})`
  );
  return `## Table Relationships\n\n${lines.join("\n")}`;
}

export function formatInstructionsForSuggest(instructions: Instruction[]): string {
  const lines = instructions.map((inst, i) => `${i + 1}. ${inst.instruction}`);
  return `## Business Rules\n\n${lines.join("\n")}`;
}

// ─── Suggest prompt ──────────────────────────────────────────────────────────

/**
 * Build the system prompt for LLM-based role dashboard suggestions.
 *
 * @param role - The user's role (e.g. "Director de ventas")
 * @param existingDashboards - Dashboards already created (to avoid overlap)
 */
export function buildSuggestPrompt(
  role: string,
  existingDashboards: { title: string; description: string }[]
): string {
  const existingSection =
    existingDashboards.length > 0
      ? [
          "## Dashboards Already Created",
          "",
          "Do NOT suggest dashboards that overlap significantly with these:",
          ...existingDashboards.map(
            (d, i) =>
              `${i + 1}. "${d.title}"${d.description ? ` — ${d.description}` : ""}`
          ),
          "",
        ].join("\n")
      : "## Dashboards Already Created\n\nNone yet.\n";

  return [
    "# Role",
    "",
    "You are an expert analytics advisor for a Spanish retail and wholesale fashion business (PowerShop).",
    `You are helping a user with the role: **${role}**.`,
    "Suggest 3-4 dashboard ideas that are most useful for this role.",
    "",
    "# Output Format",
    "",
    "You MUST respond with a single JSON array and nothing else — no markdown fences, no explanation.",
    "",
    "Each element must have exactly these fields:",
    '- "name": string — dashboard name in Spanish (concise, 3-6 words)',
    '- "description": string — one-line description in Spanish (what problem it solves for this role)',
    '- "prompt": string — a ready-to-use generation prompt in Spanish (detailed, references correct table names, uses total_si, filters entrada=true, tienda<>\'99\' etc.)',
    "",
    "Example format:",
    '[{"name": "...", "description": "...", "prompt": "..."}, ...]',
    "",
    "# Guidelines",
    "",
    "- Suggestions must be decision-support dashboards, not generic overviews",
    "- Each prompt must be actionable and specific to the role's daily decisions",
    "- Include widget guidance in the prompt (e.g. 'Incluye KPIs, gráfico de tendencia y tabla de detalle')",
    "- Reference correct table names: ps_ventas, ps_lineas_ventas, ps_articulos, ps_stock_tienda, ps_gc_albaranes, ps_gc_facturas, etc.",
    "- Always mention: filtra entrada=true, tienda<>'99', usa total_si para importes",
    "- Avoid overlap with existing dashboards listed below",
    "",
    existingSection,
    formatSchemaForSuggest(SCHEMA),
    "",
    formatRelationshipsForSuggest(RELATIONSHIPS),
    "",
    formatInstructionsForSuggest(INSTRUCTIONS),
  ].join("\n");
}

// ─── Gap analysis prompt ─────────────────────────────────────────────────────

/**
 * Build the system prompt for LLM-based coverage gap analysis.
 *
 * @param existingDashboards - All existing dashboards with their widget titles
 */
export function buildGapAnalysisPrompt(
  existingDashboards: {
    title: string;
    description: string;
    widgetTitles: string[];
  }[]
): string {
  const coverageSection =
    existingDashboards.length > 0
      ? [
          "## Existing Dashboard Coverage",
          "",
          "These dashboards already exist. Analyze what business areas they cover:",
          ...existingDashboards.map((d, i) => {
            const widgets =
              d.widgetTitles.length > 0
                ? `\n   Widgets: ${d.widgetTitles.join(", ")}`
                : "";
            return `${i + 1}. "${d.title}"${d.description ? ` — ${d.description}` : ""}${widgets}`;
          }),
          "",
        ].join("\n")
      : "## Existing Dashboard Coverage\n\nNo dashboards have been created yet. All areas are uncovered.\n";

  return [
    "# Role",
    "",
    "You are an expert analytics advisor for a Spanish retail and wholesale fashion business (PowerShop).",
    "Analyze the existing dashboards and identify important business areas that are NOT yet covered.",
    "",
    "# Output Format",
    "",
    "You MUST respond with a single JSON array and nothing else — no markdown fences, no explanation.",
    "",
    "Each element must have exactly these fields:",
    '- "area": string — the business area name in Spanish (e.g. "Análisis de márgenes", "Seguimiento de compras")',
    '- "description": string — one or two sentences in Spanish explaining why this area is important and what decisions it would support',
    '- "suggestedPrompt": string — a ready-to-use dashboard generation prompt in Spanish (detailed, references correct table names)',
    "",
    "Return 3-5 gaps maximum. Prioritize the most impactful gaps first.",
    "",
    "Example format:",
    '[{"area": "...", "description": "...", "suggestedPrompt": "..."}, ...]',
    "",
    "# Guidelines",
    "",
    "- Only identify areas that are genuinely not covered by existing dashboards",
    "- Focus on high-value decision areas: stock health, margin analysis, purchasing, customer insights, HR productivity, returns management",
    "- Each suggestedPrompt must be actionable, reference correct table names, and follow business rules",
    "- Always include in prompts: filtra entrada=true, tienda<>'99', usa total_si para importes",
    "- If all major areas are already covered, return 1-2 gaps for deeper analysis or cross-domain insights",
    "",
    coverageSection,
    formatSchemaForSuggest(SCHEMA),
    "",
    formatRelationshipsForSuggest(RELATIONSHIPS),
    "",
    formatInstructionsForSuggest(INSTRUCTIONS),
  ].join("\n");
}
