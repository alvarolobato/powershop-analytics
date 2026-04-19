/**
 * POST /api/dashboard/generate
 *
 * Accepts a user prompt (Spanish) and returns an AI-generated dashboard spec.
 *
 * Request body: { prompt: string }
 * Success response (200): DashboardSpec JSON
 * Error responses: 400 (invalid input / invalid spec), 429 (rate limit), 500 (LLM error)
 */

import { NextResponse } from "next/server";
import { generateDashboard, BudgetExceededError } from "@/lib/llm";
import { validateSpec } from "@/lib/schema";
import { ZodError } from "zod";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

/**
 * Extract JSON from an LLM response that may be wrapped in markdown code blocks.
 *
 * LLMs sometimes return:
 *   ```json
 *   { ... }
 *   ```
 * This strips the fences and returns the inner content.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Match ```json ... ``` or ``` ... ```
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

  // --- Validate prompt ---
  if (
    typeof body !== "object" ||
    body === null ||
    !("prompt" in body) ||
    typeof (body as Record<string, unknown>).prompt !== "string"
  ) {
    return NextResponse.json(
      formatApiError(
        "El cuerpo debe incluir un campo 'prompt' de tipo texto.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const prompt = ((body as Record<string, unknown>).prompt as string).trim();
  if (prompt.length === 0) {
    return NextResponse.json(
      formatApiError(
        "El prompt no puede estar vacío.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // --- Call LLM ---
  let rawResponse: string;
  try {
    rawResponse = await generateDashboard(prompt);
  } catch (err: unknown) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId),
        { status: 429 },
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    const normalizedMessage = message.toLowerCase();
    console.error(`[${requestId}] Error al generar dashboard con LLM:`, err);

    // Surface rate-limit errors with a specific message (case-insensitive)
    const isRateLimit =
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("ratelimit") ||
      normalizedMessage.includes("429");

    return NextResponse.json(
      formatApiError(
        isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "Error al generar el dashboard. Inténtalo de nuevo.",
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
      `[${requestId}] El LLM devolvió JSON inválido (${jsonStr.length} chars)`,
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

  // --- Validate against DashboardSpec schema ---
  try {
    const spec = validateSpec(parsed);
    return NextResponse.json(spec, { status: 200 });
  } catch (err: unknown) {
    const details =
      err instanceof ZodError
        ? err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : "Error de validación desconocido";

    console.error(`[${requestId}] El LLM devolvió un spec inválido:`, details);
    return NextResponse.json(
      formatApiError(
        "El modelo de IA generó un dashboard con estructura incorrecta.",
        "LLM_INVALID_RESPONSE",
        details,
        requestId,
      ),
      { status: 400 },
    );
  }
}
