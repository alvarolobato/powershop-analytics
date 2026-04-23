/**
 * LLM prompt builder for the automated weekly business review (v2 schema).
 */

import { INSTRUCTIONS, type Instruction } from "./knowledge";
import { REVIEW_QUERIES } from "./review-queries";

export type {
  ReviewContent,
  ReviewSectionV2,
  ReviewActionItemV2,
  ReviewDashboardKey,
} from "./review-schema";

function formatInstructions(instructions: Instruction[]): string {
  return instructions
    .map((ins) => `- ${ins.instruction}`)
    .join("\n");
}

const QUERY_NAMES_LIST = REVIEW_QUERIES.map((q) => q.name).join(", ");

/**
 * Build the system prompt for the weekly review LLM call (strict JSON v2).
 */
export function buildReviewPrompt(
  queryResults: string,
  reviewedWeekDescription: string,
  generationMode: "initial" | "refresh_data" | "alternate_angle" = "initial",
): string {
  const instructionsText = formatInstructions(INSTRUCTIONS);

  const modeHint =
    generationMode === "alternate_angle"
      ? "Enfoque alternativo: prioriza riesgos, cuellos de botella y decisiones pendientes; evita repetir la misma redacción de una revisión anterior."
      : "Enfoque estándar: equilibrio entre diagnóstico y oportunidades.";

  return `Eres un analista de negocio experto en retail y moda que prepara la revisión semanal del negocio para DIRECCIÓN.

Tu misión: analizar los datos y devolver una revisión accionable en español, con evidencia explícita (nombres de consultas) y prioridades claras.

**Ventana temporal:** ${reviewedWeekDescription}

**Modo de generación:** ${generationMode}. ${modeHint}

No asumas datos de la semana en curso si no aparecen en las consultas.

## Reglas de negocio

${instructionsText}

## Consultas permitidas para evidencia

Solo puedes referenciar estos nombres exactos en los arrays evidence_queries:
${QUERY_NAMES_LIST}

## Formato de salida (v2)

**Resumen Ejecutivo:** corresponde al campo JSON \`executive_summary\` (array de 3 a 5 bullets en español).

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto extra) con esta forma:

{
  "executive_summary": ["bullet 1", "bullet 2", "bullet 3"],
  "sections": [
    {
      "key": "ventas_retail",
      "title": "Ventas Retail",
      "narrative": "2-4 párrafos separados por \\n\\n",
      "kpis": ["KPI breve 1", "KPI breve 2"],
      "evidence_queries": ["ventas_semana_cerrada", "ventas_semana_previa"],
      "dashboard_key": "ventas_retail"
    },
    {
      "key": "canal_mayorista",
      "title": "Canal Mayorista",
      "narrative": "...",
      "kpis": ["...", "..."],
      "evidence_queries": ["facturacion_mayorista_semana_cerrada"],
      "dashboard_key": "canal_mayorista"
    },
    {
      "key": "stock",
      "title": "Stock y Logística",
      "narrative": "...",
      "kpis": ["...", "..."],
      "evidence_queries": ["stock_total_unidades", "articulos_stock_critico"],
      "dashboard_key": "stock"
    },
    {
      "key": "compras",
      "title": "Compras",
      "narrative": "...",
      "kpis": ["...", "..."],
      "evidence_queries": ["compras_semana_cerrada", "compras_semana_previa"],
      "dashboard_key": "compras"
    }
  ],
  "action_items": [
    {
      "action_key": "revisar_stock_critico_top",
      "priority": "alta",
      "owner_role": "Dirección de tiendas",
      "due_date": "YYYY-MM-DD",
      "action": "Texto accionable concreto",
      "expected_impact": "Impacto esperado cuantificado o cualificado",
      "evidence_queries": ["articulos_stock_critico"],
      "dashboard_key": "stock"
    }
  ],
  "data_quality_notes": [],
  "generated_at": "<ISO 8601>"
}

Restricciones:
- sections debe tener exactamente 4 entradas y las claves key deben ser ventas_retail, canal_mayorista, stock, compras (una cada una).
- executive_summary: 3 a 5 strings.
- action_items: mínimo 3, máximo 8; cada action_key en snake_case único dentro del JSON.
- priority solo: alta | media | baja.
- due_date siempre YYYY-MM-DD (fecha objetivo de seguimiento).
- evidence_queries nunca vacío; solo nombres de la lista permitida.
- data_quality_notes incluye avisos si faltan datos o una consulta falló (según el bloque de resultados).

## Datos analizados

${queryResults}`;
}
