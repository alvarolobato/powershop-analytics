/**
 * Prompt builders for the AI data analyst chat (Analizar tab).
 *
 * Builds system prompts for:
 *   - Analyzing dashboard data (with optional action presets)
 *   - Generating follow-up question suggestions
 */

import { INSTRUCTIONS } from "./knowledge";

// ─── Action types ─────────────────────────────────────────────────────────────

export type AnalyzeAction =
  | "explicar"
  | "plan_accion"
  | "anomalias"
  | "comparar"
  | "resumen_ejecutivo"
  | "buenas_practicas";

export const VALID_ANALYZE_ACTIONS: AnalyzeAction[] = [
  "explicar",
  "plan_accion",
  "anomalias",
  "comparar",
  "resumen_ejecutivo",
  "buenas_practicas",
];

// ─── Action-specific instructions ─────────────────────────────────────────────

const ACTION_INSTRUCTIONS: Record<AnalyzeAction, string> = {
  explicar:
    "Genera un resumen narrativo completo del dashboard. Describe cada widget, los valores clave, y las tendencias observadas.",
  plan_accion:
    "Basándote en los datos, propón 5-7 acciones concretas de negocio con prioridad (alta/media/baja) y el impacto esperado.",
  anomalias:
    "Analiza todos los valores del dashboard buscando anomalías: valores inusualmente altos/bajos, cambios bruscos, datos faltantes, o patrones inesperados.",
  comparar:
    "Compara los datos actuales con el período anterior (si hay datos de tendencia). Destaca los cambios más significativos con porcentajes.",
  resumen_ejecutivo:
    "Genera un resumen ejecutivo conciso (máximo 200 palabras) para presentar a dirección. Incluye: situación actual, logros, riesgos, y siguiente paso recomendado.",
  buenas_practicas:
    "Basándote en los números reales del dashboard, sugiere buenas prácticas específicas de retail/mayorista de moda que apliquen a esta situación.",
};

// ─── Business knowledge summary ───────────────────────────────────────────────

function formatBusinessRules(): string {
  const lines = INSTRUCTIONS.slice(0, 15).map(
    (inst, i) => `${i + 1}. ${inst.instruction}`
  );
  return `## Reglas de negocio clave\n\n${lines.join("\n")}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the system prompt for analyzing dashboard data.
 *
 * @param serializedData  — Formatted widget data string from serializeWidgetData()
 * @param action          — Optional preset action that drives specific instructions
 */
export function buildAnalyzePrompt(
  serializedData: string,
  action?: string
): string {
  const sections: string[] = [
    "# Rol",
    "",
    "Eres un analista de datos experto para un negocio de moda retail y mayorista (PowerShop).",
    "Tu tarea es analizar los datos del dashboard y responder en español con análisis precisos y útiles.",
    "",
    "# Reglas de respuesta",
    "",
    "- Responde siempre en español",
    "- Usa formato markdown para estructurar la respuesta",
    "- Sé específico con los números reales que aparecen en los datos",
    "- Cita el nombre del widget cuando hagas referencia a datos concretos",
    "- No inventes datos que no estén en el contexto",
    "- Cuando los datos no estén disponibles, indícalo claramente",
    "",
  ];

  // Inject action-specific instructions when provided
  const normalizedAction = action as AnalyzeAction | undefined;
  if (normalizedAction && ACTION_INSTRUCTIONS[normalizedAction]) {
    sections.push("# Tarea específica");
    sections.push("");
    sections.push(ACTION_INSTRUCTIONS[normalizedAction]);
    sections.push("");
  }

  sections.push("# Datos del dashboard");
  sections.push("");
  sections.push(serializedData);
  sections.push("");
  sections.push(formatBusinessRules());

  return sections.join("\n");
}

/**
 * Build a short prompt asking the LLM to suggest follow-up questions.
 *
 * @param serializedData  — Formatted widget data string
 * @param lastExchange    — The last user question + assistant response
 */
export function buildSuggestionPrompt(
  serializedData: string,
  lastExchange: string
): string {
  return [
    "Basándote en los datos del dashboard y el intercambio anterior, genera entre 3 y 5 preguntas de seguimiento en español que el usuario podría querer hacer.",
    "",
    "Devuelve SOLO un array JSON de strings, sin texto adicional, sin markdown, sin explicaciones.",
    "Ejemplo: [\"¿Cuál es la tienda con más ventas?\", \"¿Qué productos tienen mayor margen?\"]",
    "",
    "## Contexto del dashboard (resumen)",
    "",
    // Only include first 500 chars of data to keep suggestion prompt short
    serializedData.slice(0, 500),
    "",
    "## Intercambio anterior",
    "",
    lastExchange.slice(0, 1000),
  ].join("\n");
}
