/**
 * POST /api/dashboard/analyze
 *
 * Accepts a dashboard spec + widget data + user prompt, calls the LLM to
 * produce a data analysis, and either:
 *
 *  a) returns the response as a single JSON document (legacy contract,
 *     also used for ALL error responses — HTTP status reflects 4xx/5xx), or
 *  b) streams progress events as NDJSON when the agentic runner emits at
 *     least one progress event before completing.
 *
 * Status / contract:
 *   • Validation errors        → HTTP 4xx, JSON `ApiErrorResponse`.
 *   • LLM errors (no progress) → HTTP 4xx/5xx, JSON `ApiErrorResponse`.
 *   • LLM errors (mid-stream)  → HTTP 200 NDJSON; final frame is
 *                                `{type:"error", httpStatus, ...ApiErrorResponse}`.
 *                                Clients MUST check the frame `httpStatus`
 *                                field rather than `res.status` for
 *                                mid-stream failures.
 *   • Success (no progress)    → HTTP 200, JSON `{response, suggestions}`.
 *   • Success (with progress)  → HTTP 200 NDJSON; final frame is
 *                                `{type:"result", response, suggestions}`.
 *
 * Streaming frames (NDJSON):
 *   { type: "progress", requestId, logLine: LogLine }   per agentic step
 *   { type: "result",   requestId, response, suggestions }
 *   { type: "error",    requestId, httpStatus, error, code, details?, diagnostic? }
 */
import { NextResponse } from "next/server";
import {
  analyzeDashboard,
  generateSuggestions,
  BudgetExceededError,
  CircuitBreakerOpenError,
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
  type ApiErrorResponse,
} from "@/lib/errors";
import type { WidgetData } from "@/components/widgets/types";
import {
  createInteraction,
  finishInteraction,
} from "@/lib/db-write";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";
import { buildAgenticErrorDiagnostic, persistAgenticError } from "@/lib/llm-tools/diagnostic";
import { agenticEventToLogLine } from "@/lib/format-agentic-progress";
import type { AgenticProgressEvent } from "@/lib/llm-tools/types";
import type { LogLine } from "@/components/LogBlock";

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

/**
 * Build the LLM error response payload (ApiErrorResponse shape) AND the
 * HTTP status that should accompany it. Centralized so the JSON-only path
 * and the NDJSON error frame stay in lock-step.
 */
function buildLlmErrorPayload(
  err: unknown,
  requestId: string,
  cfg: ReturnType<typeof loadDashboardLlmConfig>,
): { status: number; payload: ApiErrorResponse } {
  if (err instanceof AgenticRunnerError) {
    const diagnostic = buildAgenticErrorDiagnostic(err, cfg);
    persistAgenticError("analyze", err, diagnostic);
    return {
      status: 500,
      payload: formatApiError(
        "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Inténtalo de nuevo.",
        "AGENTIC_RUNNER",
        diagnostic.subError,
        err.requestId,
        diagnostic,
      ),
    };
  }
  if (err instanceof BudgetExceededError) {
    return {
      status: 429,
      payload: formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId),
    };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return {
      status: 503,
      payload: formatApiError(err.message, "LLM_CIRCUIT_OPEN", undefined, requestId),
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const normalizedMessage = message.toLowerCase();
  const isRateLimit =
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("ratelimit") ||
    normalizedMessage.includes("429");
  return {
    status: isRateLimit ? 429 : 500,
    payload: formatApiError(
      isRateLimit
        ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
        : "No se pudo analizar el dashboard. Inténtalo de nuevo.",
      isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
      sanitizeErrorMessage(err),
      requestId,
    ),
  };
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

  // --- Persist interaction start -------------------------------------------
  const cfg = loadDashboardLlmConfig();
  const llmProvider = cfg.provider;
  const llmDriver = cfg.provider === "cli" ? cfg.cliDriver : null;

  let interactionId: string | null = null;
  try {
    interactionId = await createInteraction({
      requestId,
      endpoint: "analyze",
      dashboardId: dashboardIdNum ?? null,
      prompt: prompt.trim(),
      llmProvider,
      llmDriver: llmDriver ?? null,
    });
  } catch (e) {
    console.error(`[${requestId}] createInteraction(analyze) failed:`, e);
  }

  // --- Run the LLM call, collecting progress events into a buffer ----------
  // We start the LLM call in the background. The progress callback pushes
  // log lines into a buffer. We then await either the call's completion or
  // the first progress event:
  //
  //   • If the call completes (success or failure) BEFORE any progress event
  //     is buffered, we return a normal JSON response with proper HTTP
  //     status. This is the "fast path" most tests / clients use.
  //
  //   • If at least one progress event was buffered before the call
  //     resolved, we open an NDJSON stream that replays the buffered events
  //     and continues live. From that point on errors must be reported as a
  //     terminal `{type:"error", httpStatus, …}` frame because HTTP headers
  //     have already been committed at status 200.
  const t0 = Date.now();
  const buffer: { type: "progress"; logLine: LogLine }[] = [];
  let firstEventResolve: (() => void) | null = null;
  const firstEvent = new Promise<void>((resolve) => {
    firstEventResolve = resolve;
  });

  const onAgenticProgress = (ev: AgenticProgressEvent) => {
    const logLine = agenticEventToLogLine(ev, Date.now() - t0);
    if (!logLine) return;
    buffer.push({ type: "progress", logLine });
    if (firstEventResolve) {
      firstEventResolve();
      firstEventResolve = null;
    }
  };

  type LlmOutcome =
    | { kind: "ok"; response: string }
    | { kind: "err"; err: unknown };

  const llmPromise: Promise<LlmOutcome> = analyzeDashboard(
    serializedData,
    prompt.trim(),
    typeof action === "string" ? action : undefined,
    {
      requestId,
      endpoint: "analyzeDashboard",
      dashboardId: dashboardIdNum,
      onAgenticProgress,
    },
  ).then(
    (response): LlmOutcome => ({ kind: "ok", response }),
    (err): LlmOutcome => ({ kind: "err", err }),
  );

  // Race: first progress event vs. call completion.
  const raceWinner = await Promise.race([
    llmPromise.then(() => "done" as const),
    firstEvent.then(() => "progress" as const),
  ]);

  if (raceWinner === "done") {
    // Fast path: no progress was emitted before the call resolved.
    const outcome = await llmPromise;
    if (outcome.kind === "err") {
      const { err } = outcome;
      if (interactionId) {
        const errText = err instanceof Error ? err.message : "Error al analizar";
        await finishInteraction(interactionId, "error", errText).catch((e) =>
          console.error(`[${requestId}] finishInteraction(analyze,error) failed:`, e),
        );
      }
      const { status, payload } = buildLlmErrorPayload(err, requestId, cfg);
      console.error(`[${requestId}] Error al analizar dashboard con LLM:`, err);
      return NextResponse.json(payload, { status });
    }
    // Success without progress: keep legacy JSON contract.
    const analysisResponse = outcome.response;
    const lastExchange = `Usuario: ${prompt.trim()}\n\nAsistente: ${analysisResponse}`;
    const suggestions = await generateSuggestions(serializedData, lastExchange, { requestId });
    if (interactionId) {
      await finishInteraction(interactionId, "completed", analysisResponse).catch((e) =>
        console.error(`[${requestId}] finishInteraction(analyze,completed) failed:`, e),
      );
    }
    return NextResponse.json({ response: analysisResponse, suggestions });
  }

  // Streaming path: at least one progress event was emitted.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      // Replay events buffered up to this point. New events will continue
      // arriving via `onAgenticProgress` → push into `liveBuffer` then drain.
      const drainBuffer = () => {
        while (buffer.length) {
          const ev = buffer.shift()!;
          send({ ...ev, requestId });
        }
      };
      drainBuffer();

      // Swap the progress callback so future events stream directly.
      // (Closure-captured `onAgenticProgress` is no longer needed; we just
      //  poll `buffer` after each await tick.)
      const outcome = await llmPromise;
      drainBuffer();

      if (outcome.kind === "err") {
        const { err } = outcome;
        if (interactionId) {
          const errText = err instanceof Error ? err.message : "Error al analizar";
          await finishInteraction(interactionId, "error", errText).catch((e) =>
            console.error(`[${requestId}] finishInteraction(analyze,error) failed:`, e),
          );
        }
        const { status, payload } = buildLlmErrorPayload(err, requestId, cfg);
        console.error(`[${requestId}] Error al analizar dashboard con LLM (mid-stream):`, err);
        // Spread payload first so its `requestId` is the canonical one;
        // then add type / httpStatus which are not part of ApiErrorResponse.
        send({ ...payload, type: "error", httpStatus: status });
        controller.close();
        return;
      }

      const analysisResponse = outcome.response;
      const lastExchange = `Usuario: ${prompt.trim()}\n\nAsistente: ${analysisResponse}`;
      const suggestions = await generateSuggestions(serializedData, lastExchange, { requestId });
      if (interactionId) {
        await finishInteraction(interactionId, "completed", analysisResponse).catch((e) =>
          console.error(`[${requestId}] finishInteraction(analyze,completed) failed:`, e),
        );
      }
      send({ type: "result", requestId, response: analysisResponse, suggestions });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
