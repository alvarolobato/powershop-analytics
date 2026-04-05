/**
 * POST /api/dashboard/modify
 *
 * Accepts a current DashboardSpec and a user prompt, calls the LLM to produce
 * an updated spec, validates it, and returns the result.
 *
 * Request body: { spec: DashboardSpec, prompt: string }
 * Response: 200 with updated DashboardSpec, or 400/429/500 on error.
 */
import { NextResponse } from "next/server";
import { modifyDashboard } from "@/lib/llm";
import { validateSpec, DashboardSpecSchema, type DashboardSpec } from "@/lib/schema";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

/**
 * Extract JSON from a string that may be wrapped in markdown code blocks.
 * LLMs sometimes return ```json ... ``` around their JSON output.
 */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  return raw.trim();
}

export async function POST(request: Request) {
  const requestId = generateRequestId();

  // --- Parse request body ---------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("Cuerpo JSON no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError(
        "El cuerpo JSON debe ser un objeto.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const { spec, prompt } = body as Record<string, unknown>;

  // --- Validate required fields ---------------------------------------------
  if (spec === undefined) {
    return NextResponse.json(
      formatApiError(
        "Falta el campo 'spec'.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json(
      formatApiError(
        "Falta el campo 'prompt' o está vacío.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // --- Validate incoming spec with Zod --------------------------------------
  const specParse = DashboardSpecSchema.safeParse(spec);
  if (!specParse.success) {
    return NextResponse.json(
      formatApiError(
        "La especificación del dashboard no es válida.",
        "VALIDATION",
        specParse.error.issues.map((i) => i.message).join("; "),
        requestId,
      ),
      { status: 400 },
    );
  }

  // --- Call LLM to modify the dashboard -------------------------------------
  let rawResponse: string;
  try {
    rawResponse = await modifyDashboard(
      JSON.stringify(specParse.data),
      prompt.trim(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${requestId}] Error al modificar dashboard con LLM:`, err);

    // Detect rate limit
    const isRateLimit =
      message.includes("rate limit") || message.includes("429");

    return NextResponse.json(
      formatApiError(
        isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "No se pudo modificar el dashboard. Inténtalo de nuevo.",
        isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: isRateLimit ? 429 : 500 },
    );
  }

  // --- Parse and validate LLM response --------------------------------------
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(
      `[${requestId}] El LLM devolvió JSON inválido al modificar:`,
      jsonStr.slice(0, 200),
    );
    return NextResponse.json(
      formatApiError(
        "El modelo de IA devolvió una respuesta con formato incorrecto.",
        "LLM_INVALID_RESPONSE",
        `JSON inválido: ${jsonStr.slice(0, 300)}`,
        requestId,
      ),
      { status: 400 },
    );
  }

  let updatedSpec: DashboardSpec;
  try {
    updatedSpec = validateSpec(parsed);
  } catch {
    console.error(`[${requestId}] El LLM devolvió un spec inválido al modificar.`);
    return NextResponse.json(
      formatApiError(
        "El modelo de IA generó un dashboard con estructura incorrecta.",
        "LLM_INVALID_RESPONSE",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  return NextResponse.json(updatedSpec);
}
