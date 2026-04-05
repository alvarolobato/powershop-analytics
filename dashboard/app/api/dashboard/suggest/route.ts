/**
 * POST /api/dashboard/suggest
 *
 * Returns LLM-generated dashboard suggestions tailored to a user role.
 *
 * Request body:
 *   {
 *     role: string,
 *     existingDashboards: { title: string, description: string }[]
 *   }
 *
 * Success response (200):
 *   { suggestions: { name: string, description: string, prompt: string }[] }
 *
 * Error responses: 400 (validation), 429 (rate limit), 500 (LLM error)
 */

import { NextResponse } from "next/server";
import { suggestDashboards } from "@/lib/llm";
import { extractJson } from "@/lib/llm-json";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

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

  if (typeof b.role !== "string" || b.role.trim().length === 0) {
    return NextResponse.json(
      formatApiError(
        "El campo 'role' es obligatorio y debe ser una cadena de texto no vacía.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const role = b.role.trim();

  if (!Array.isArray(b.existingDashboards)) {
    return NextResponse.json(
      formatApiError(
        "El campo 'existingDashboards' es obligatorio y debe ser un array.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const existingDashboards = (b.existingDashboards as unknown[]).map((d) => {
    if (typeof d !== "object" || d === null) return { title: "", description: "" };
    const item = d as Record<string, unknown>;
    return {
      title: typeof item.title === "string" ? item.title : "",
      description: typeof item.description === "string" ? item.description : "",
    };
  });

  // --- Call LLM ---
  let rawResponse: string;
  try {
    rawResponse = await suggestDashboards(role, existingDashboards);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const normalizedMessage = message.toLowerCase();
    console.error(`[${requestId}] Error al obtener sugerencias del LLM:`, err);

    const isRateLimit =
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("ratelimit") ||
      normalizedMessage.includes("429");

    return NextResponse.json(
      formatApiError(
        isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "Error al obtener sugerencias. Inténtalo de nuevo.",
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
      `[${requestId}] El LLM devolvió JSON inválido en suggest (${jsonStr.length} chars)`,
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

  // --- Validate and normalise suggestions array ---
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

  const suggestions = parsed
    .map((item: unknown) => {
      const s = (typeof item === "object" && item !== null
        ? item
        : {}) as Record<string, unknown>;
      return {
        name: typeof s.name === "string" ? s.name : "",
        description: typeof s.description === "string" ? s.description : "",
        prompt: typeof s.prompt === "string" ? s.prompt : "",
      };
    })
    // Filter out invalid entries that would render empty cards, missing descriptions, or trigger no-op generation
    .filter(
      (s) =>
        s.name.trim().length > 0 &&
        s.description.trim().length > 0 &&
        s.prompt.trim().length > 0,
    );

  return NextResponse.json({ suggestions }, { status: 200 });
}
