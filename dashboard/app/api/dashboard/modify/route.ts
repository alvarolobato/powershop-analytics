/**
 * POST /api/dashboard/modify
 *
 * Accepts a current DashboardSpec and a user prompt, calls the LLM to produce
 * an updated spec, validates it, and either:
 *
 *  a) returns the updated spec as a single JSON document (legacy contract,
 *     also used for ALL error responses — HTTP status reflects 4xx/5xx), or
 *  b) streams progress events as NDJSON when the agentic runner emits at
 *     least one progress event before completing.
 *
 * Status / contract:
 *   • Validation errors        → HTTP 4xx, JSON `ApiErrorResponse`.
 *   • LLM/parse/lint errors    → HTTP 4xx/5xx, JSON `ApiErrorResponse` when
 *                                no progress was emitted yet; otherwise
 *                                HTTP 200 NDJSON terminating in
 *                                `{type:"error", httpStatus, ...}`.
 *   • Success (no progress)    → HTTP 200, JSON object where the DashboardSpec
 *                                fields (title, description, widgets, filters, …)
 *                                appear at the top level together with additive
 *                                `message` and `summary` strings (i.e. the spec
 *                                is spread, NOT wrapped under a `spec` key).
 *                                Existing clients consuming `spec.title` /
 *                                `spec.widgets` continue to work unchanged —
 *                                `message` / `summary` are new top-level fields.
 *   • Success (with progress)  → HTTP 200 NDJSON terminating in
 *                                `{type:"result", spec: DashboardSpec, message, summary}`.
 *
 * Response shape (non-streaming):  `{ ...DashboardSpec, message?, summary? }`
 * Response shape (streaming result frame):
 *   { type: "result", requestId, spec: DashboardSpec, message: string, summary: string }
 *
 * Streaming frames (NDJSON):
 *   { type: "progress", requestId, logLine: LogLine }
 *   { type: "result",   requestId, spec: DashboardSpec, message: string, summary: string }
 *   { type: "error",    requestId, httpStatus, error, code, details?, diagnostic? }
 *
 * Backward compat: the non-streaming success response spreads spec fields at the
 * top level for wire-compatibility with existing clients. `message` and
 * `summary` are additive and will not collide with DashboardSpec field names.
 */
import { NextResponse } from "next/server";
import {
  modifyDashboard,
  AgenticRunnerError,
} from "@/lib/llm";
import { classifyLlmError } from "@/lib/llm-error-payload";
import { loadPriorTurns } from "@/lib/conversation-context";
import { validateSpec, DashboardSpecSchema, type DashboardSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
  type ApiErrorResponse,
} from "@/lib/errors";
import {
  createInteraction,
  finishInteraction,
} from "@/lib/db-write";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";
import { isAgenticToolsEnabled, getAgenticConfig } from "@/lib/llm-tools/config";
import { buildAgenticErrorDiagnostic, persistAgenticError } from "@/lib/llm-tools/diagnostic";
import { agenticEventToLogLine, pushAgenticLogLine } from "@/lib/format-agentic-progress";
import type { AgenticProgressEvent, LlmAgenticContext } from "@/lib/llm-tools/types";
import type { LogLine } from "@/components/LogBlock";

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
    persistAgenticError("modify", err, diagnostic);
    return {
      status: 500,
      payload: formatApiError(
        "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Reformula el cambio o inténtalo de nuevo.",
        "AGENTIC_RUNNER",
        diagnostic.subError,
        err.requestId,
        diagnostic,
      ),
    };
  }
  const { status, code, userMessage } = classifyLlmError(err, requestId);
  return {
    status,
    payload: formatApiError(
      userMessage,
      code as Parameters<typeof formatApiError>[1],
      sanitizeErrorMessage(err),
      requestId,
    ),
  };
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

  const { spec, prompt, dashboardId } = body as Record<string, unknown>;

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

  // --- Resolve optional dashboardId -----------------------------------------
  let dashboardIdNum: number | null = null;
  if (dashboardId !== undefined && dashboardId !== null) {
    if (typeof dashboardId === "number" && Number.isInteger(dashboardId) && dashboardId > 0) {
      dashboardIdNum = dashboardId;
    } else if (typeof dashboardId === "string" && /^\d+$/.test(dashboardId)) {
      const n = parseInt(dashboardId, 10);
      if (n > 0) dashboardIdNum = n;
    }
    if (dashboardIdNum === null) {
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

  // --- Persist interaction start --------------------------------------------
  const cfg = loadDashboardLlmConfig();
  const llmProvider = cfg.provider;
  const llmDriver = cfg.provider === "cli" ? cfg.cliDriver : null;

  let interactionId: string | null = null;
  try {
    interactionId = await createInteraction({
      requestId,
      endpoint: "modify",
      dashboardId: dashboardIdNum,
      prompt: prompt.trim(),
      llmProvider,
      llmDriver: llmDriver ?? null,
    });
  } catch (e) {
    console.error(`[${requestId}] createInteraction(modify) failed:`, e);
  }

  // --- Load prior conversation turns (if this is a saved dashboard) --------
  const priorTurns =
    dashboardIdNum !== null
      ? await loadPriorTurns(dashboardIdNum, "modify")
      : [];

  // --- Run the LLM call, collecting progress events into a buffer ----------
  // See analyze/route.ts for the rationale of the deferred-stream design:
  // race the call's completion against the first progress event so we can
  // (a) keep the legacy JSON contract (with proper HTTP status) for the
  // common case, and (b) only open an NDJSON stream when the agentic runner
  // actually streams progress events.
  const t0 = Date.now();
  // Buffer accumulates events emitted *before* the streaming controller
  // installs its live pump (`liveSend`). Once streaming is open, events flow
  // through `liveSend` directly so the client sees Claude thinking + writing
  // in real time instead of receiving everything in a single end-of-run dump.
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
  const modifyCtx: LlmAgenticContext = {
    requestId,
    endpoint: "modifyDashboard",
    dashboardId: dashboardIdNum ?? undefined,
    onAgenticProgress,
    modifyResult: null,
  };

  type LlmOutcome =
    | { kind: "ok"; rawResponse: string }
    | { kind: "err"; err: unknown };

  const llmPromise: Promise<LlmOutcome> = modifyDashboard(
    JSON.stringify(specParse.data),
    prompt.trim(),
    modifyCtx,
    priorTurns,
  ).then(
    (rawResponse): LlmOutcome => ({ kind: "ok", rawResponse }),
    (err): LlmOutcome => ({ kind: "err", err }),
  );

  const raceWinner = await Promise.race([
    llmPromise.then(() => "done" as const),
    firstEvent.then(() => "progress" as const),
  ]);

  // -------------------------------------------------------------------------
  // Helper: extract spec + message from the LLM outcome.
  // With the new publish-tool approach (agentic tools enabled):
  //   - spec comes from ctx.modifyResult (staged by the tool handler)
  //   - message is the freeform text returned by runAgenticChat
  // Legacy path (agentic tools disabled):
  //   - rawResponse is the raw JSON spec (old contract)
  //   - message is empty
  // -------------------------------------------------------------------------
  type ValidationOutcome =
    | { ok: true; spec: DashboardSpec; message: string; summary: string }
    | { ok: false; status: number; payload: ApiErrorResponse };

  const validateLlmResponse = (rawResponse: string): ValidationOutcome => {
    // Agentic path: ctx.modifyResult was staged by apply_dashboard_modification.
    if (isAgenticToolsEnabled()) {
      if (!modifyCtx.modifyResult) {
        console.error(
          `[${requestId}] El modelo no llamó a apply_dashboard_modification (agentic tools enabled).`,
        );
        const agenticCfg = getAgenticConfig();
        const contractErr = new AgenticRunnerError(
          "AGENTIC_RUNNER",
          "El modelo no publicó el dashboard modificado. Reformula el cambio o inténtalo de nuevo.",
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
        persistAgenticError("modify", contractErr, diagnostic);
        return {
          ok: false,
          status: 500,
          payload: formatApiError(
            contractErr.message,
            "AGENTIC_RUNNER",
            "El modelo no llamó a `apply_dashboard_modification`.",
            requestId,
            diagnostic,
          ),
        };
      }
      // The spec was already Zod-validated inside the tool handler.
      return {
        ok: true,
        spec: modifyCtx.modifyResult.spec,
        message: rawResponse,
        summary: modifyCtx.modifyResult.summary,
      };
    }

    // Legacy path: parse JSON from the raw response string.
    const jsonStr = extractJson(rawResponse);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error(
        `[${requestId}] El LLM devolvió JSON inválido al modificar (${jsonStr.length} chars)`,
      );
      return {
        ok: false,
        status: 400,
        payload: formatApiError(
          "El modelo de IA devolvió una respuesta con formato incorrecto.",
          "LLM_INVALID_RESPONSE",
          undefined,
          requestId,
        ),
      };
    }

    let updatedSpec: DashboardSpec;
    try {
      updatedSpec = validateSpec(parsed);
    } catch {
      console.error(`[${requestId}] El LLM devolvió un spec inválido al modificar.`);
      return {
        ok: false,
        status: 400,
        payload: formatApiError(
          "El modelo de IA generó un dashboard con estructura incorrecta.",
          "LLM_INVALID_RESPONSE",
          undefined,
          requestId,
        ),
      };
    }

    const sqlLint = lintDashboardSpec(updatedSpec);
    if (sqlLint.length > 0) {
      console.error(
        `[${requestId}] SQL heurístico rechazó el spec modificado por el LLM:`,
        sqlLint.join(" | "),
      );
      return {
        ok: false,
        status: 400,
        payload: formatApiError(
          "El modelo devolvió SQL con patrones inválidos para PostgreSQL. Reformula el cambio o inténtalo de nuevo.",
          "SQL_LINT",
          sqlLint.join(" | "),
          requestId,
        ),
      };
    }

    return { ok: true, spec: updatedSpec, message: "", summary: "" };
  };

  // -------------------------------------------------------------------------
  // Fast path: no progress emitted before completion → legacy JSON contract.
  // -------------------------------------------------------------------------
  if (raceWinner === "done") {
    const outcome = await llmPromise;
    if (outcome.kind === "err") {
      const { err } = outcome;
      if (interactionId) {
        const errText = err instanceof Error ? err.message : "Error al modificar";
        await finishInteraction(interactionId, "error", errText).catch((e) =>
          console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
        );
      }
      const { status, payload } = buildLlmErrorPayload(err, requestId, cfg);
      console.error(`[${requestId}] Error al modificar dashboard con LLM:`, err);
      return NextResponse.json(payload, { status });
    }

    const validation = validateLlmResponse(outcome.rawResponse);
    if (!validation.ok) {
      if (interactionId) {
        const errText =
          validation.payload.code === "SQL_LINT"
            ? `SQL lint: ${validation.payload.details ?? ""}`
            : validation.payload.error;
        await finishInteraction(interactionId, "error", errText).catch((e) =>
          console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
        );
      }
      return NextResponse.json(validation.payload, { status: validation.status });
    }

    const { spec: updatedSpec, message, summary } = validation;
    if (interactionId) {
      await finishInteraction(interactionId, "completed", JSON.stringify(updatedSpec)).catch((e) =>
        console.error(`[${requestId}] finishInteraction(modify,completed) failed:`, e),
      );
    }
    // Return additive fields: spec (existing contract) + message + summary (new).
    return NextResponse.json({ ...updatedSpec, message, summary });
  }

  // -------------------------------------------------------------------------
  // Streaming path: at least one progress event was emitted.
  // -------------------------------------------------------------------------
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

      // Switch onAgenticProgress to live-pump mode. Subsequent events bypass
      // the buffer and reach the client immediately — same UX as the review
      // streaming endpoint.
      liveSend = (entry) => send({ ...entry, requestId });

      const outcome = await llmPromise;
      liveSend = null;
      drainBuffer();

      if (outcome.kind === "err") {
        const { err } = outcome;
        if (interactionId) {
          const errText = err instanceof Error ? err.message : "Error al modificar";
          await finishInteraction(interactionId, "error", errText).catch((e) =>
            console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }
        const { status, payload } = buildLlmErrorPayload(err, requestId, cfg);
        console.error(`[${requestId}] Error al modificar dashboard con LLM (mid-stream):`, err);
        // Spread payload first so its `requestId` is canonical.
        send({ ...payload, type: "error", httpStatus: status });
        controller.close();
        return;
      }

      const validation = validateLlmResponse(outcome.rawResponse);
      if (!validation.ok) {
        if (interactionId) {
          const errText =
            validation.payload.code === "SQL_LINT"
              ? `SQL lint: ${validation.payload.details ?? ""}`
              : validation.payload.error;
          await finishInteraction(interactionId, "error", errText).catch((e) =>
            console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }
        send({
          ...validation.payload,
          type: "error",
          httpStatus: validation.status,
        });
        controller.close();
        return;
      }

      const { spec: updatedSpec, message, summary } = validation;
      if (interactionId) {
        await finishInteraction(interactionId, "completed", JSON.stringify(updatedSpec)).catch((e) =>
          console.error(`[${requestId}] finishInteraction(modify,completed) failed:`, e),
        );
      }
      // Additive NDJSON result frame: spec (existing) + message + summary (new).
      send({ type: "result", requestId, spec: updatedSpec, message, summary });
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
