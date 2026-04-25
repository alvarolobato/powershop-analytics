/**
 * POST /api/dashboard/modify
 *
 * Accepts a current DashboardSpec and a user prompt, calls the LLM to produce
 * an updated spec, validates it, and streams progress events in real-time.
 *
 * Request body: { spec: DashboardSpec, prompt: string }
 * Response: application/x-ndjson stream
 *   { type: "progress", requestId, logLine: LogLine }  — per agentic step
 *   { type: "result",   requestId, spec: DashboardSpec }
 *   { type: "error",    requestId, error: string, code: string, details?: string }
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
import { agenticEventToLogLine } from "@/lib/format-agentic-progress";
import type { AgenticProgressEvent } from "@/lib/llm-tools/types";

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

  // --- Open streaming response ----------------------------------------------
  const cfg = loadDashboardLlmConfig();
  const llmProvider = cfg.provider;
  const llmDriver = cfg.provider === "cli" ? cfg.cliDriver : null;

  const encoder = new TextEncoder();
  const t0 = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      // --- Persist interaction start (fire-and-forget alongside stream) -----
      let interactionId: string | null = null;
      const interactionIdPromise = createInteraction({
        requestId,
        endpoint: "modify",
        dashboardId: dashboardIdNum,
        prompt: prompt.trim(),
        llmProvider,
        llmDriver: llmDriver ?? null,
      }).then((id) => {
        interactionId = id;
      }).catch((e) => {
        console.error(`[${requestId}] createInteraction(modify) failed:`, e);
      });

      const onAgenticProgress = (ev: AgenticProgressEvent) => {
        const logLine = agenticEventToLogLine(ev, Date.now() - t0);
        if (logLine) {
          send({ type: "progress", requestId, logLine });
        }
      };

      // --- Call LLM to modify the dashboard ---------------------------------
      let rawResponse: string;
      try {
        rawResponse = await modifyDashboard(
          JSON.stringify(specParse.data),
          prompt.trim(),
          { requestId, endpoint: "modifyDashboard", onAgenticProgress },
        );
      } catch (err: unknown) {
        await interactionIdPromise;
        if (interactionId) {
          const errText = err instanceof Error ? err.message : "Error al modificar";
          await finishInteraction(interactionId, "error", errText).catch((e) =>
            console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }

        let errorPayload: Record<string, unknown>;
        if (err instanceof AgenticRunnerError) {
          errorPayload = formatApiError(
            "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Reformula el cambio o inténtalo de nuevo.",
            "AGENTIC_RUNNER",
            `${err.code}: ${err.message}`,
            err.requestId,
          ) as unknown as Record<string, unknown>;
        } else if (err instanceof BudgetExceededError) {
          errorPayload = formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId) as unknown as Record<string, unknown>;
        } else if (err instanceof CircuitBreakerOpenError) {
          errorPayload = formatApiError(err.message, "LLM_CIRCUIT_OPEN", undefined, requestId) as unknown as Record<string, unknown>;
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const normalizedMessage = message.toLowerCase();
          console.error(`[${requestId}] Error al modificar dashboard con LLM:`, err);
          const isRateLimit =
            normalizedMessage.includes("rate limit") ||
            normalizedMessage.includes("ratelimit") ||
            normalizedMessage.includes("429");
          errorPayload = formatApiError(
            isRateLimit
              ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
              : "No se pudo modificar el dashboard. Inténtalo de nuevo.",
            isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
            sanitizeErrorMessage(err),
            requestId,
          ) as unknown as Record<string, unknown>;
        }

        send({ type: "error", requestId, ...errorPayload });
        controller.close();
        return;
      }

      // --- Parse and validate LLM response ----------------------------------
      const jsonStr = extractJson(rawResponse);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        console.error(
          `[${requestId}] El LLM devolvió JSON inválido al modificar (${jsonStr.length} chars)`,
        );
        await interactionIdPromise;
        if (interactionId) {
          await finishInteraction(interactionId, "error", "JSON inválido en respuesta del modelo").catch(
            (e) => console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }
        send({
          type: "error",
          requestId,
          ...formatApiError(
            "El modelo de IA devolvió una respuesta con formato incorrecto.",
            "LLM_INVALID_RESPONSE",
            undefined,
            requestId,
          ) as unknown as Record<string, unknown>,
        });
        controller.close();
        return;
      }

      let updatedSpec: DashboardSpec;
      try {
        updatedSpec = validateSpec(parsed);
      } catch {
        console.error(`[${requestId}] El LLM devolvió un spec inválido al modificar.`);
        await interactionIdPromise;
        if (interactionId) {
          await finishInteraction(interactionId, "error", "Spec inválido").catch((e) =>
            console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }
        send({
          type: "error",
          requestId,
          ...formatApiError(
            "El modelo de IA generó un dashboard con estructura incorrecta.",
            "LLM_INVALID_RESPONSE",
            undefined,
            requestId,
          ) as unknown as Record<string, unknown>,
        });
        controller.close();
        return;
      }

      const sqlLint = lintDashboardSpec(updatedSpec);
      if (sqlLint.length > 0) {
        console.error(
          `[${requestId}] SQL heurístico rechazó el spec modificado por el LLM:`,
          sqlLint.join(" | "),
        );
        await interactionIdPromise;
        if (interactionId) {
          await finishInteraction(interactionId, "error", `SQL lint: ${sqlLint.join(" | ")}`).catch(
            (e) => console.error(`[${requestId}] finishInteraction(modify,error) failed:`, e),
          );
        }
        send({
          type: "error",
          requestId,
          ...formatApiError(
            "El modelo devolvió SQL con patrones inválidos para PostgreSQL. Reformula el cambio o inténtalo de nuevo.",
            "SQL_LINT",
            sqlLint.join(" | "),
            requestId,
          ) as unknown as Record<string, unknown>,
        });
        controller.close();
        return;
      }

      // --- Persist completion -----------------------------------------------
      await interactionIdPromise;
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
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
