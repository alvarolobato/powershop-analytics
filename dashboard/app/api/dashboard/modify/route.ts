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
import {
  modifyDashboard,
  BudgetExceededError,
  CircuitBreakerOpenError,
  AgenticRunnerError,
} from "@/lib/llm";
import { validateSpec, DashboardSpecSchema, type DashboardSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import {
  createInteraction,
  finishInteraction,
} from "@/lib/db-write";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";

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

  // --- Persist interaction start --------------------------------------------
  const cfg = loadDashboardLlmConfig();
  const llmProvider = cfg.provider;
  const llmDriver = cfg.provider === "cli" ? cfg.cliDriver : null;

  let interactionId: string | null = null;
  try {
    interactionId = await createInteraction({
      requestId,
      endpoint: "modify",
      prompt: prompt.trim(),
      llmProvider,
      llmDriver: llmDriver ?? null,
    });
  } catch (e) {
    console.error(`[${requestId}] createInteraction(modify) failed:`, e);
  }

  // --- Call LLM to modify the dashboard -------------------------------------
  let rawResponse: string;
  try {
    rawResponse = await modifyDashboard(
      JSON.stringify(specParse.data),
      prompt.trim(),
      { requestId, endpoint: "modifyDashboard" },
    );
  } catch (err: unknown) {
    if (interactionId) {
      const errText = err instanceof Error ? err.message : "Error al modificar";
      await finishInteraction(interactionId, "error", errText).catch((e) =>
        console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
      );
    }
    if (err instanceof AgenticRunnerError) {
      return NextResponse.json(
        formatApiError(
          "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Reformula el cambio o inténtalo de nuevo.",
          "AGENTIC_RUNNER",
          `${err.code}: ${err.message}`,
          err.requestId,
        ),
        { status: 500 },
      );
    }
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId),
        { status: 429 },
      );
    }
    if (err instanceof CircuitBreakerOpenError) {
      return NextResponse.json(
        formatApiError(err.message, "LLM_CIRCUIT_OPEN", undefined, requestId),
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    const normalizedMessage = message.toLowerCase();
    console.error(`[${requestId}] Error al modificar dashboard con LLM:`, err);

    const isRateLimit =
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("ratelimit") ||
      normalizedMessage.includes("429");

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
      `[${requestId}] El LLM devolvió JSON inválido al modificar (${jsonStr.length} chars)`,
    );
    if (interactionId) {
      await finishInteraction(interactionId, "error", "JSON inválido en respuesta del modelo").catch(
        (e) => console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
      );
    }
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

  let updatedSpec: DashboardSpec;
  try {
    updatedSpec = validateSpec(parsed);
  } catch {
    console.error(`[${requestId}] El LLM devolvió un spec inválido al modificar.`);
    if (interactionId) {
      await finishInteraction(interactionId, "error", "Spec inválido").catch((e) =>
        console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
      );
    }
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

  const sqlLint = lintDashboardSpec(updatedSpec);
  if (sqlLint.length > 0) {
    console.error(
      `[${requestId}] SQL heurístico rechazó el spec modificado por el LLM:`,
      sqlLint.join(" | "),
    );
    if (interactionId) {
      await finishInteraction(interactionId, "error", `SQL lint: ${sqlLint.join(" | ")}`).catch(
        (e) => console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
      );
    }
    return NextResponse.json(
      {
        ...formatApiError(
          "El modelo devolvió SQL con patrones inválidos para PostgreSQL. Reformula el cambio o inténtalo de nuevo.",
          "SQL_LINT",
          sqlLint.join(" | "),
          requestId,
        ),
      },
      { status: 400 },
    );
  }

  if (interactionId) {
    void finishInteraction(interactionId, "completed", JSON.stringify(updatedSpec)).catch((e) =>
      console.error(`[${requestId}] finishInteraction(modify,completed) failed:`, e),
    );
  }

  return NextResponse.json(updatedSpec);
}
