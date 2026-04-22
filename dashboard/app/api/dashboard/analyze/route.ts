/**
 * POST /api/dashboard/analyze
 *
 * Accepts a dashboard spec + widget data + user prompt, calls the LLM to
 * produce a data analysis, and returns the response plus suggestion chips.
 *
 * Request body:
 *   { spec: DashboardSpec, widgetData: Record<string, unknown>, prompt: string, action?: string }
 * Response:
 *   { response: string, suggestions: string[] }
 */
import { NextResponse } from "next/server";
import {
  analyzeDashboard,
  generateSuggestions,
  BudgetExceededError,
  AgenticRunnerError,
} from "@/lib/llm";
import { DashboardSpecSchema } from "@/lib/schema";
import { serializeWidgetData } from "@/lib/data-serializer";
import type { WidgetStateData } from "@/lib/data-serializer";
import { VALID_ANALYZE_ACTIONS } from "@/lib/analyze-prompts";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import type { WidgetData } from "@/components/widgets/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deserialize the client-sent widgetData (plain object keyed by numeric string)
 * into a Map<number, WidgetStateData> suitable for serializeWidgetData().
 */
function deserializeWidgetData(
  raw: Record<string, unknown>
): Map<number, WidgetStateData> {
  const map = new Map<number, WidgetStateData>();
  for (const [key, value] of Object.entries(raw)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;

    /** Validate that a value looks like a WidgetData (columns: string[], rows: unknown[][]). */
    function isWidgetData(v: unknown): v is WidgetData {
      if (typeof v !== "object" || v === null) return false;
      const obj = v as Record<string, unknown>;
      return (
        Array.isArray(obj.columns) &&
        obj.columns.every((c) => typeof c === "string") &&
        Array.isArray(obj.rows) &&
        obj.rows.every((r) => Array.isArray(r))
      );
    }

    // Reconstruct WidgetStateData shape, propagating loading to preserve
    // "[datos no disponibles]" vs "[sin datos]" distinction in serializer
    const rawData = entry.data ?? null;
    let validatedData: WidgetData | null | (WidgetData | null)[];
    if (Array.isArray(rawData)) {
      validatedData = rawData.map((d) => (isWidgetData(d) ? d : null));
    } else {
      validatedData = isWidgetData(rawData) ? rawData : null;
    }

    const rawTrend = entry.trendData;
    const validatedTrend = Array.isArray(rawTrend)
      ? rawTrend.map((d) => (isWidgetData(d) ? d : null))
      : undefined;

    const widgetState: WidgetStateData = {
      data: validatedData,
      trendData: validatedTrend,
      loading: typeof entry.loading === "boolean" ? entry.loading : false,
      error: null,
    };
    map.set(idx, widgetState);
  }
  return map;
}

// ─── Route handler ────────────────────────────────────────────────────────────

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
      formatApiError("El cuerpo JSON debe ser un objeto.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const { spec, widgetData, prompt, action, dashboardId } = body as Record<
    string,
    unknown
  >;

  // --- Validate required fields --------------------------------------------
  if (spec === undefined) {
    return NextResponse.json(
      formatApiError("Falta el campo 'spec'.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json(
      formatApiError("Falta el campo 'prompt' o está vacío.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  // --- Validate action if provided -----------------------------------------
  if (
    action !== undefined &&
    action !== null &&
    (typeof action !== "string" ||
      !VALID_ANALYZE_ACTIONS.includes(action as (typeof VALID_ANALYZE_ACTIONS)[number]))
  ) {
    return NextResponse.json(
      formatApiError(
        `El campo 'action' no es válido. Valores permitidos: ${VALID_ANALYZE_ACTIONS.join(", ")}.`,
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // --- Validate spec with Zod ----------------------------------------------
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

  let dashboardIdNum: number | undefined;
  if (dashboardId !== undefined && dashboardId !== null) {
    if (typeof dashboardId === "number" && Number.isInteger(dashboardId) && dashboardId > 0) {
      dashboardIdNum = dashboardId;
    } else if (typeof dashboardId === "string" && /^\d+$/.test(dashboardId)) {
      const n = parseInt(dashboardId, 10);
      if (n > 0) dashboardIdNum = n;
    }
    if (dashboardIdNum === undefined) {
      return NextResponse.json(
        formatApiError(
          "El campo 'dashboardId' debe ser un entero positivo cuando se envía.",
          "VALIDATION",
          undefined,
          requestId,
        ),
        { status: 400 },
      );
    }
  }

  // --- Deserialize widget data ---------------------------------------------
  const widgetDataMap = deserializeWidgetData(
    typeof widgetData === "object" && widgetData !== null && !Array.isArray(widgetData)
      ? (widgetData as Record<string, unknown>)
      : {}
  );

  // --- Serialize widget data for LLM context --------------------------------
  const serializedData = serializeWidgetData(specParse.data, widgetDataMap);

  // --- Call LLM to analyze dashboard ----------------------------------------
  let analysisResponse: string;
  try {
    analysisResponse = await analyzeDashboard(
      serializedData,
      prompt.trim(),
      typeof action === "string" ? action : undefined,
      {
        requestId,
        endpoint: "analyzeDashboard",
        dashboardId: dashboardIdNum,
      },
    );
  } catch (err) {
    if (err instanceof AgenticRunnerError) {
      return NextResponse.json(
        formatApiError(
          "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Inténtalo de nuevo.",
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
    const message = err instanceof Error ? err.message : String(err);
    const normalizedMessage = message.toLowerCase();
    console.error(`[${requestId}] Error al analizar dashboard con LLM:`, err);

    const isRateLimit =
      normalizedMessage.includes("rate limit") ||
      normalizedMessage.includes("ratelimit") ||
      normalizedMessage.includes("429");

    return NextResponse.json(
      formatApiError(
        isRateLimit
          ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
          : "No se pudo analizar el dashboard. Inténtalo de nuevo.",
        isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: isRateLimit ? 429 : 500 },
    );
  }

  // --- Generate suggestions before returning the response ------------------
  const lastExchange = `Usuario: ${prompt.trim()}\n\nAsistente: ${analysisResponse}`;
  const suggestions = await generateSuggestions(serializedData, lastExchange);

  return NextResponse.json({ response: analysisResponse, suggestions });
}
