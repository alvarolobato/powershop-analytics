/**
 * POST /api/dashboard/generate
 *
 * Accepts a user prompt (Spanish) and returns an AI-generated dashboard spec.
 *
 * Request body: { prompt: string }
 * Success response (200): DashboardSpec JSON
 * Error responses: 400 (invalid input / invalid spec), 500 (LLM error)
 */

import { NextResponse } from "next/server";
import { generateDashboard } from "@/lib/llm";
import { validateSpec } from "@/lib/schema";
import { ZodError } from "zod";

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
  // --- Parse request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo JSON no válido" },
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
      { error: "El cuerpo debe incluir un campo 'prompt' de tipo texto" },
      { status: 400 },
    );
  }

  const prompt = ((body as Record<string, unknown>).prompt as string).trim();
  if (prompt.length === 0) {
    return NextResponse.json(
      { error: "El prompt no puede estar vacío" },
      { status: 400 },
    );
  }

  // --- Call LLM ---
  let rawResponse: string;
  try {
    rawResponse = await generateDashboard(prompt);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "";
    console.error("LLM generate error:", message);

    // Surface rate-limit errors with a specific message
    const isRateLimit =
      message.includes("rate limit") || message.includes("429");

    return NextResponse.json(
      {
        error: isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "Error al generar el dashboard. Inténtalo de nuevo.",
      },
      { status: isRateLimit ? 429 : 500 },
    );
  }

  // --- Parse JSON from LLM output ---
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return NextResponse.json(
      {
        error: "LLM returned invalid JSON",
        details: jsonStr.slice(0, 500),
      },
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
        ? err.issues.map((e) => `${e.path.join(".")}: ${e.message}`)
        : ["Unknown validation error"];

    return NextResponse.json(
      { error: "LLM returned an invalid dashboard spec", details },
      { status: 400 },
    );
  }
}
