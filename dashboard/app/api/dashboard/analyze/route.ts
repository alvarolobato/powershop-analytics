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
 *   • Success (no progress)    → HTTP 200, JSON `{response, message?, summary?, suggestions}`.
 *   • Success (with progress)  → HTTP 200 NDJSON; final frame is
 *                                `{type:"result", response, message, summary, suggestions}`.
 *
 * Streaming frames (NDJSON):
 *   { type: "progress", requestId, logLine: LogLine }   per agentic step
 *   { type: "result",   requestId, response, message, summary, suggestions }
 *   { type: "error",    requestId, httpStatus, error, code, details?, diagnostic? }
 *
 * Backward compat: the `response` field (analysis markdown) is preserved.
 * `message` and `summary` are additive new fields.
 */
import { NextResponse } from "next/server";
import {
  analyzeDashboard,
  generateSuggestions,
  AgenticRunnerError,
} from "@/lib/llm";
import { buildLlmErrorPayload } from "@/lib/llm-error-payload";
import { loadPriorTurns } from "@/lib/llm-context";
import { DashboardSpecSchema } from "@/lib/schema";
import { serializeWidgetData } from "@/lib/data-serializer";
import type { WidgetStateData } from "@/lib/data-serializer";
import { VALID_ANALYZE_ACTIONS } from "@/lib/analyze-prompts";
import {
  formatApiError,
  generateRequestId,
  type ApiErrorResponse,
} from "@/lib/errors";
import type { WidgetData } from "@/components/widgets/types";
import {
  createInteraction,
  finishInteraction,
} from "@/lib/db-write";
import { appendMessage, touchConversation } from "@/lib/conversations";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";
import { isAgenticToolsEnabled, getAgenticConfig } from "@/lib/llm-tools/config";
import { buildAgenticErrorDiagnostic, persistAgenticError } from "@/lib/llm-tools/diagnostic";
import { agenticEventToLogLine, pushAgenticLogLine } from "@/lib/format-agentic-progress";
import type { AgenticProgressEvent, LlmAgenticContext } from "@/lib/llm-tools/types";
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

  const { spec, widgetData, prompt, action, dashboardId, conversationId } = body as Record<
    string,
    unknown
  >;
  const convId = typeof conversationId === "string" && conversationId.trim() ? conversationId.trim() : null;

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

  // --- Save user message server-side immediately ----------------------------
  // This ensures the message is persisted even if the browser disconnects
  // before the response arrives and the client-side save never runs.
  if (convId) {
    try {
      await appendMessage(convId, { role: "user", content: { text: prompt.trim() } });
    } catch (e) {
      console.warn(`[${requestId}] Failed to save user message for conv ${convId}:`, e);
    }
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

  // --- Load prior conversation turns (if this is a saved dashboard) --------
  const priorTurns =
    dashboardIdNum !== undefined
      ? await loadPriorTurns(dashboardIdNum, "analyze")
      : [];

  // --- Run the LLM call, with live event pump once streaming opens ---------
  // See modify/route.ts for design notes — same pattern: events buffer until
  // the streaming controller installs `liveSend`, then bypass the buffer so
  // the client sees Claude thinking + writing in real time.
  const t0 = Date.now();
  const buffer: { type: "progress"; logLine: LogLine }[] = [];
  let liveSend: ((entry: { type: "progress"; logLine: LogLine }) => void) | null = null;
  let firstEventResolve: (() => void) | null = null;
  const firstEvent = new Promise<void>((resolve) => {
    firstEventResolve = resolve;
  });

  const onAgenticProgress = (ev: AgenticProgressEvent) => {
    const logLine = agenticEventToLogLine(ev, Date.now() - t0);
    if (!logLine) return;
    const entry = { type: "progress" as const, logLine };
    if (liveSend) {
      liveSend(entry);
    } else {
      pushAgenticLogLine(buffer, entry);
    }
    if (firstEventResolve) {
      firstEventResolve();
      firstEventResolve = null;
    }
  };

  // Build a mutable ctx so the route can read back the side-channel after the loop.
  const analyzeCtx: LlmAgenticContext = {
    requestId,
    endpoint: "analyzeDashboard",
    dashboardId: dashboardIdNum,
    onAgenticProgress,
    analyzeResult: null,
  };

  type LlmOutcome =
    | { kind: "ok"; response: string }
    | { kind: "err"; err: unknown };

  const llmPromise: Promise<LlmOutcome> = analyzeDashboard(
    serializedData,
    prompt.trim(),
    typeof action === "string" ? action : undefined,
    analyzeCtx,
    priorTurns,
  ).then(
    (response): LlmOutcome => ({ kind: "ok", response }),
    (err): LlmOutcome => ({ kind: "err", err }),
  );

  // Race: first progress event vs. call completion.
  const raceWinner = await Promise.race([
    llmPromise.then(() => "done" as const),
    firstEvent.then(() => "progress" as const),
  ]);

  // -------------------------------------------------------------------------
  // Helper: extract the analysis response + message + summary from outcome.
  // With the new publish-tool approach (agentic tools enabled):
  //   - response (analysis markdown) comes from ctx.analyzeResult.markdown
  //   - message is the freeform text returned by runAgenticChat (rawResponse)
  //   - summary comes from ctx.analyzeResult.summary
  // Legacy path (agentic tools disabled):
  //   - response IS the freeform raw response (old contract)
  //   - message and summary are empty
  // -------------------------------------------------------------------------
  const resolveAnalysisResult = (rawResponse: string): {
    analysisResponse: string;
    message: string;
    summary: string;
  } | null => {
    if (isAgenticToolsEnabled()) {
      if (!analyzeCtx.analyzeResult) {
        console.error(
          `[${requestId}] El modelo no llamó a submit_dashboard_analysis (agentic tools enabled).`,
        );
        return null;
      }
      return {
        analysisResponse: analyzeCtx.analyzeResult.markdown,
        message: rawResponse,
        summary: analyzeCtx.analyzeResult.summary,
      };
    }
    // Legacy: the raw response IS the analysis.
    return { analysisResponse: rawResponse, message: "", summary: "" };
  };

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
      const { status, payload } = buildLlmErrorPayload(err, requestId, cfg, "analyze");
      console.error(`[${requestId}] Error al analizar dashboard con LLM:`, err);
      return NextResponse.json(payload, { status });
    }

    const resolved = resolveAnalysisResult(outcome.response);
    if (!resolved) {
      if (interactionId) {
        await finishInteraction(interactionId, "error", "El modelo no llamó a submit_dashboard_analysis").catch((e) =>
          console.error(`[${requestId}] finishInteraction(analyze,error) failed:`, e),
        );
      }
      const agenticCfg = getAgenticConfig();
      const contractErr = new AgenticRunnerError(
        "AGENTIC_RUNNER",
        "El modelo no publicó el análisis. Inténtalo de nuevo.",
        requestId,
        {
          phase: "final",
          toolRoundsUsed: 0,
          toolCallsUsed: 0,
          durationMs: 0,
          limitsAtFailure: {
            maxRounds: agenticCfg.maxToolRounds,
            maxToolCalls: agenticCfg.maxToolCalls,
            toolTimeoutMs: agenticCfg.toolTimeoutMs,
            executeRowLimit: agenticCfg.maxRows,
            payloadCharLimit: agenticCfg.maxResultChars,
          },
        },
      );
      const diagnostic = buildAgenticErrorDiagnostic(contractErr, cfg);
      persistAgenticError("analyze", contractErr, diagnostic);
      return NextResponse.json(
        formatApiError(
          contractErr.message,
          "AGENTIC_RUNNER",
          "El modelo no llamó a `submit_dashboard_analysis`.",
          requestId,
          diagnostic,
        ),
        { status: 500 },
      );
    }

    const { analysisResponse, message, summary } = resolved;
    // Use the full analysis body for suggestion context so suggestions reflect
    // the complete analysis, not just the short freeform chat reply.
    const lastExchange = `Usuario: ${prompt.trim()}\n\nAsistente: ${analysisResponse}`;
    const suggestions = await generateSuggestions(serializedData, lastExchange, { requestId });
    if (interactionId) {
      await finishInteraction(interactionId, "completed", analysisResponse).catch((e) =>
        console.error(`[${requestId}] finishInteraction(analyze,completed) failed:`, e),
      );
    }
    const msgToSave = message || analysisResponse;
    if (convId && msgToSave) {
      try {
        await appendMessage(convId, { role: "assistant", content: { text: msgToSave } });
        await touchConversation(convId, "ok").catch(() => {});
      } catch (e) {
        console.warn(`[${requestId}] Failed to save assistant message for conv ${convId}:`, e);
      }
    }
    return NextResponse.json({ response: analysisResponse, message, summary, suggestions });
  }

  // Streaming path: at least one progress event was emitted.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      const drainBuffer = () => {
        while (buffer.length) {
          const ev = buffer.shift()!;
          send({ ...ev, requestId });
        }
      };
      drainBuffer();

      // Switch onAgenticProgress to live-pump mode (same as modify route).
      liveSend = (entry) => send({ ...entry, requestId });

      const outcome = await llmPromise;
      liveSend = null;
      drainBuffer();

      if (outcome.kind === "err") {
        const { err } = outcome;
        if (interactionId) {
          const errText = err instanceof Error ? err.message : "Error al analizar";
          await finishInteraction(interactionId, "error", errText).catch((e) =>
            console.error(`[${requestId}] finishInteraction(analyze,error) failed:`, e),
          );
        }
        const { status, payload } = buildLlmErrorPayload(err, requestId, cfg, "analyze");
        console.error(`[${requestId}] Error al analizar dashboard con LLM (mid-stream):`, err);
        send({ ...payload, type: "error", httpStatus: status });
        controller.close();
        return;
      }

      const resolved = resolveAnalysisResult(outcome.response);
      if (!resolved) {
        if (interactionId) {
          await finishInteraction(interactionId, "error", "El modelo no llamó a submit_dashboard_analysis").catch((e) =>
            console.error(`[${requestId}] finishInteraction(analyze,error) failed:`, e),
          );
        }
        const agenticCfg = getAgenticConfig();
        const contractErr = new AgenticRunnerError(
          "AGENTIC_RUNNER",
          "El modelo no publicó el análisis. Inténtalo de nuevo.",
          requestId,
          {
            phase: "final",
            toolRoundsUsed: 0,
            toolCallsUsed: 0,
            durationMs: 0,
            limitsAtFailure: {
              maxRounds: agenticCfg.maxToolRounds,
              maxToolCalls: agenticCfg.maxToolCalls,
              toolTimeoutMs: agenticCfg.toolTimeoutMs,
              executeRowLimit: agenticCfg.maxRows,
              payloadCharLimit: agenticCfg.maxResultChars,
            },
          },
        );
        const diagnostic = buildAgenticErrorDiagnostic(contractErr, cfg);
        persistAgenticError("analyze", contractErr, diagnostic);
        send({
          ...formatApiError(
            contractErr.message,
            "AGENTIC_RUNNER",
            "El modelo no llamó a `submit_dashboard_analysis`.",
            requestId,
            diagnostic,
          ),
          type: "error",
          httpStatus: 500,
        });
        controller.close();
        return;
      }

      const { analysisResponse, message, summary } = resolved;
      // Use the full analysis body for suggestion context (not the short message).
      const lastExchange = `Usuario: ${prompt.trim()}\n\nAsistente: ${analysisResponse}`;
      const suggestions = await generateSuggestions(serializedData, lastExchange, { requestId });
      if (interactionId) {
        await finishInteraction(interactionId, "completed", analysisResponse).catch((e) =>
          console.error(`[${requestId}] finishInteraction(analyze,completed) failed:`, e),
        );
      }
      const msgToSave = message || analysisResponse;
      if (convId && msgToSave) {
        try {
          await appendMessage(convId, { role: "assistant", content: { text: msgToSave } });
          await touchConversation(convId, "ok").catch(() => {});
        } catch (e) {
          console.warn(`[${requestId}] Failed to save assistant message for conv ${convId}:`, e);
        }
      }
      send({ type: "result", requestId, response: analysisResponse, message, summary, suggestions });
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
