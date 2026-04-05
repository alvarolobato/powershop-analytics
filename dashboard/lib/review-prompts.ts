/**
 * LLM prompt builder for the automated weekly business review.
 *
 * Generates a system prompt that instructs the LLM to produce a structured
 * Spanish business review in JSON format.
 */

import { INSTRUCTIONS, type Instruction } from "./knowledge";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewContent {
  executive_summary: string;
  sections: ReviewSection[];
  action_items: string[];
  generated_at: string;
}

export interface ReviewSection {
  title: string;
  content: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatInstructions(instructions: Instruction[]): string {
  return instructions
    .map((ins) => `- ${ins.instruction}`)
    .join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the system prompt for the weekly review LLM call.
 *
 * @param queryResults - Text representation of all SQL query results
 * @returns System prompt string
 */
export function buildReviewPrompt(queryResults: string): string {
  const instructionsText = formatInstructions(INSTRUCTIONS);

  return `Eres un analista de negocio experto en retail y moda que prepara la revisión semanal del negocio.

Tu misión: analizar los datos de la semana actual de PowerShop Analytics y redactar una revisión semanal completa, concisa y orientada a la acción, escrita en español.

## Reglas de negocio

Las siguientes instrucciones son críticas para interpretar correctamente los datos:

${instructionsText}

## Formato de salida

Debes devolver ÚNICAMENTE un objeto JSON válido con la siguiente estructura exacta (sin bloques de código markdown, sin texto antes o después).

El JSON tiene los campos: executive_summary (Resumen Ejecutivo de la semana), sections (secciones por dominio), action_items (Acciones Recomendadas) y generated_at (timestamp de generación).

{
  "executive_summary": "<3-4 puntos clave separados por \\n, en formato '• punto clave'",
  "sections": [
    {
      "title": "Ventas Retail",
      "content": "<2-4 párrafos analizando las ventas retail de la semana, comparando con la semana anterior, destacando tiendas destacadas y artículos más vendidos>"
    },
    {
      "title": "Canal Mayorista",
      "content": "<2-4 párrafos sobre facturación mayorista, principales clientes, albaranes pendientes>"
    },
    {
      "title": "Stock y Logística",
      "content": "<2-4 párrafos sobre el estado del stock, artículos en stock crítico, traspasos realizados>"
    },
    {
      "title": "Compras",
      "content": "<2-4 párrafos sobre pedidos de compra de la semana comparados con la semana anterior>"
    }
  ],
  "action_items": [
    "<acción concreta y priorizada, ej: Revisar stock crítico de artículos con menos de 5 unidades>",
    "<2-5 acciones adicionales>"
  ],
  "generated_at": "<ISO 8601 timestamp>"
}

## Datos de la semana

A continuación se presentan los resultados de las consultas ejecutadas contra la base de datos:

${queryResults}

Analiza estos datos con criterio de negocio. Si algún dato falta o tiene errores, indícalo brevemente en la sección correspondiente y continúa con los datos disponibles. Prioriza las acciones más urgentes primero. Recuerda que el resumen ejecutivo debe ser conciso (3-4 bullets) y las secciones deben ser analíticas (no solo descriptivas de los datos en bruto).`;
}
