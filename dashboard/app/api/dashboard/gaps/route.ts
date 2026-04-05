/**
 * POST /api/dashboard/gaps
 *
 * Returns LLM-generated coverage gap analysis for the existing set of dashboards.
 *
 * Request body:
 *   {
 *     existingDashboards: {
 *       title: string,
 *       description: string,
 *       widgetTitles: string[]
 *     }[]
 *   }
 *
 * Success response (200):
 *   { gaps: { area: string, description: string, suggestedPrompt: string }[] }
 *
 * Error responses: 400 (validation), 429 (rate limit), 500 (LLM error)
 */

import { NextResponse } from "next/server";
import { analyzeGaps } from "@/lib/llm";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

/**
 * Extract JSON from an LLM response that may be wrapped in markdown code blocks.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = generateRequestId();

  // --- Parse request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("Cuerpo JSON no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  // --- Validate input ---
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      formatApiError(
        "El cuerpo de la petición debe ser un objeto JSON.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.existingDashboards)) {
    return NextResponse.json(
      formatApiError(
        "El campo 'existingDashboards' es obligatorio y debe ser un array (puede estar vacío).",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const existingDashboards = (b.existingDashboards as unknown[]).map((d) => {
    if (typeof d !== "object" || d === null) {
      return { title: "", description: "", widgetTitles: [] as string[] };
    }
    const item = d as Record<string, unknown>;
    return {
      title: typeof item.title === "string" ? item.title : "",
      description: typeof item.description === "string" ? item.description : "",
      widgetTitles: Array.isArray(item.widgetTitles)
        ? (item.widgetTitles as unknown[])
            .filter((w) => typeof w === "string")
            .map((w) => w as string)
        : [],
    };
  });

  // --- Call LLM ---
  let rawResponse: string;
  try {
    rawResponse = await analyzeGaps(existingDashboards);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const normalizedMessage = message.toLowerCase();
    console.error(`[${requestId}] Error al analizar gaps con el LLM:`, err);

    const isRateLimit =
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("ratelimit") ||
      normalizedMessage.includes("429");

    return NextResponse.json(
      formatApiError(
        isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "Error al analizar la cobertura. Inténtalo de nuevo.",
        isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: isRateLimit ? 429 : 500 },
    );
  }

  // --- Parse JSON from LLM output ---
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(
      `[${requestId}] El LLM devolvió JSON inválido en gaps (${jsonStr.length} chars)`,
    );
    return NextResponse.json(
      formatApiError(
        "El modelo de IA devolvió una respuesta con formato incorrecto.",
        "LLM_INVALID_RESPONSE",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // --- Validate and normalise gaps array ---
  if (!Array.isArray(parsed)) {
    return NextResponse.json(
      formatApiError(
        "El modelo de IA devolvió una respuesta inesperada (se esperaba un array).",
        "LLM_INVALID_RESPONSE",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const gaps = parsed.map((item: unknown) => {
    const g = (typeof item === "object" && item !== null
      ? item
      : {}) as Record<string, unknown>;
    return {
      area: typeof g.area === "string" ? g.area : "",
      description: typeof g.description === "string" ? g.description : "",
      suggestedPrompt:
        typeof g.suggestedPrompt === "string" ? g.suggestedPrompt : "",
    };
  });

  return NextResponse.json({ gaps }, { status: 200 });
}
