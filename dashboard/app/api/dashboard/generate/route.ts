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

    const allowedFields =
      err instanceof ZodError
        ? resolveWidgetAllowedFields(err, parsed)
        : undefined;

    return NextResponse.json(
      {
        ...formatApiError(
          "El modelo de IA generó un dashboard con estructura incorrecta.",
          "LLM_INVALID_RESPONSE",
          details,
          requestId,
        ),
        ...(allowedFields !== undefined ? { allowedFields } : {}),
      },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers for allowedFields enrichment
// ---------------------------------------------------------------------------

const WIDGET_ALLOWED_FIELDS: Record<string, string[]> = {
  kpi_row: ["id", "type", "items"],
  bar_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  line_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  area_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  donut_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  table: ["id", "type", "title", "sql"],
  number: ["id", "type", "title", "sql", "format", "prefix"],
};

/**
 * When a ZodError path targets a widget (widgets.N, path length 2) or one of
 * its direct fields (widgets.N.<key>, path length 3), extract the widget type
 * from the parsed object and return the known allowed fields for that type.
 * Deeply nested errors (e.g. widgets.N.items.0.label, path length > 3) are
 * excluded — those belong to a sub-schema and the top-level allowed-fields
 * list would be misleading.
 */
function resolveWidgetAllowedFields(
  zodError: ZodError,
  parsed: unknown,
): string[] | undefined {
  for (const issue of zodError.issues) {
    const [seg0, seg1] = issue.path;
    if (
      seg0 !== "widgets" ||
      typeof seg1 !== "number" ||
      issue.path.length > 3
    )
      continue;

    const widgetIndex = seg1;
    const parsedObj = parsed as Record<string, unknown> | null | undefined;
    const widgets = parsedObj?.widgets;
    if (!Array.isArray(widgets)) continue;

    const widget = widgets[widgetIndex] as Record<string, unknown> | undefined;
    const widgetType = typeof widget?.type === "string" ? widget.type : undefined;
    if (!widgetType) continue;

    if (!Object.prototype.hasOwnProperty.call(WIDGET_ALLOWED_FIELDS, widgetType)) {
      continue;
    }
    const fields = WIDGET_ALLOWED_FIELDS[widgetType];
    if (Array.isArray(fields)) return fields;
  }
  return undefined;
}
