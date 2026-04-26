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
 *   • Success (no progress)    → HTTP 200, JSON updated `DashboardSpec`.
 *   • Success (with progress)  → HTTP 200 NDJSON terminating in
 *                                `{type:"result", spec}`.
 *
 * Streaming frames (NDJSON):
 *   { type: "progress", requestId, logLine: LogLine }
 *   { type: "result",   requestId, spec: DashboardSpec }
 *   { type: "error",    requestId, httpStatus, error, code, details?, diagnostic? }
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
  type ApiErrorResponse,
} from "@/lib/errors";
import {
  createInteraction,
  finishInteraction,
} from "@/lib/db-write";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";
import { buildAgenticErrorDiagnostic, persistAgenticError } from "@/lib/llm-tools/diagnostic";
import { agenticEventToLogLine } from "@/lib/format-agentic-progress";
import type { AgenticProgressEvent } from "@/lib/llm-tools/types";
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
        : "No se pudo modificar el dashboard. Inténtalo de nuevo.",
      isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
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

  // --- Run the LLM call, collecting progress events into a buffer ----------
  // See analyze/route.ts for the rationale of the deferred-stream design:
  // race the call's completion against the first progress event so we can
  // (a) keep the legacy JSON contract (with proper HTTP status) for the
  // common case, and (b) only open an NDJSON stream when the agentic runner
  // actually streams progress events.
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
    | { kind: "ok"; rawResponse: string }
    | { kind: "err"; err: unknown };

  const llmPromise: Promise<LlmOutcome> = modifyDashboard(
    JSON.stringify(specParse.data),
    prompt.trim(),
    { requestId, endpoint: "modifyDashboard", onAgenticProgress },
  ).then(
    (rawResponse): LlmOutcome => ({ kind: "ok", rawResponse }),
    (err): LlmOutcome => ({ kind: "err", err }),
  );

  const raceWinner = await Promise.race([
    llmPromise.then(() => "done" as const),
    firstEvent.then(() => "progress" as const),
  ]);

  // -------------------------------------------------------------------------
  // Helper: parse + validate the LLM raw response into a DashboardSpec.
  // Returns a discriminated result so both code paths can react identically.
  // -------------------------------------------------------------------------
  type ValidationOutcome =
    | { ok: true; spec: DashboardSpec }
    | { ok: false; status: number; payload: ApiErrorResponse };

  const validateLlmResponse = (rawResponse: string): ValidationOutcome => {
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

    return { ok: true, spec: updatedSpec };
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

    const updatedSpec = validation.spec;
    if (interactionId) {
      await finishInteraction(interactionId, "completed", JSON.stringify(updatedSpec)).catch((e) =>
        console.error(`[${requestId}] finishInteraction(modify,completed) failed:`, e),
      );
    }
    return NextResponse.json(updatedSpec);
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

      const outcome = await llmPromise;
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
        send({ type: "error", requestId, httpStatus: status, ...payload });
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
          type: "error",
          requestId,
          httpStatus: validation.status,
          ...validation.payload,
        });
        controller.close();
        return;
      }

      const updatedSpec = validation.spec;
      if (interactionId) {
        await finishInteraction(interactionId, "completed", JSON.stringify(updatedSpec)).catch((e) =>
          console.error(`[${requestId}] finishInteraction(modify,completed) failed:`, e),
        );
      }
      send({ type: "result", requestId, spec: updatedSpec });
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
