/**
 * POST /api/dashboard/generate
 *
 * Request body: { prompt: string, stream?: boolean }
 * - stream false (default): success 200 = DashboardSpec JSON
 * - stream true: `application/x-ndjson` — lines: meta, progress (×N), result | error
 */

import { NextResponse } from "next/server";
import {
  generateDashboard,
  BudgetExceededError,
  CircuitBreakerOpenError,
  AgenticRunnerError,
} from "@/lib/llm";
import { validateSpec, type DashboardSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";
import { ZodError } from "zod";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import type { AgenticProgressEvent } from "@/lib/llm-tools/types";

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

type GenerateFinishOk = { ok: true; spec: DashboardSpec };
type GenerateFinishErr = { ok: false; status: number; payload: Record<string, unknown> };

function finishGenerateFromRawLlm(rawResponse: string, requestId: string): GenerateFinishOk | GenerateFinishErr {
  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(`[${requestId}] El LLM devolvió JSON inválido (${jsonStr.length} chars)`);
    return {
      ok: false,
      status: 400,
      payload: formatApiError(
        "El modelo de IA devolvió una respuesta con formato incorrecto.",
        "LLM_INVALID_RESPONSE",
        undefined,
        requestId,
      ) as unknown as Record<string, unknown>,
    };
  }

  try {
    const spec = validateSpec(parsed);
    const sqlLint = lintDashboardSpec(spec);
    if (sqlLint.length > 0) {
      console.error(`[${requestId}] SQL heurístico rechazó el spec del LLM:`, sqlLint.join(" | "));
      return {
        ok: false,
        status: 400,
        payload: {
          ...formatApiError(
            "El modelo generó SQL con patrones inválidos para PostgreSQL (fechas/EXTRACT/COALESCE). Vuelve a generar o reformula el prompt.",
            "SQL_LINT",
            sqlLint.join(" | "),
            requestId,
          ),
        } as Record<string, unknown>,
      };
    }
    return { ok: true, spec };
  } catch (err: unknown) {
    const details =
      err instanceof ZodError
        ? err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : "Error de validación desconocido";

    console.error(`[${requestId}] El LLM devolvió un spec inválido:`, details);

    const allowedFields =
      err instanceof ZodError ? resolveWidgetAllowedFields(err, parsed) : undefined;

    return {
      ok: false,
      status: 400,
      payload: {
        ...formatApiError(
          "El modelo de IA generó un dashboard con estructura incorrecta.",
          "LLM_INVALID_RESPONSE",
          details,
          requestId,
        ),
        ...(allowedFields !== undefined ? { allowedFields } : {}),
      } as Record<string, unknown>,
    };
  }
}

function logAgenticProgress(requestId: string, event: AgenticProgressEvent): void {
  console.info(`[agentic][generateDashboard][${requestId}]`, JSON.stringify(event));
}

function mapGenerateLlmError(err: unknown, requestId: string): GenerateFinishErr {
  if (err instanceof AgenticRunnerError) {
    return {
      ok: false,
      status: 500,
      payload: formatApiError(
        "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Reformula el prompt o inténtalo de nuevo.",
        "AGENTIC_RUNNER",
        `${err.code}: ${err.message}`,
        err.requestId,
      ) as unknown as Record<string, unknown>,
    };
  }
  if (err instanceof BudgetExceededError) {
    return {
      ok: false,
      status: 429,
      payload: formatApiError(err.message, "LLM_BUDGET_EXCEEDED", undefined, requestId) as unknown as Record<
        string,
        unknown
      >,
    };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return {
      ok: false,
      status: 503,
      payload: formatApiError(err.message, "LLM_CIRCUIT_OPEN", undefined, requestId) as unknown as Record<
        string,
        unknown
      >,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const normalizedMessage = message.toLowerCase();
  console.error(`[${requestId}] Error al generar dashboard con LLM:`, err);

  const isRateLimit =
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("ratelimit") ||
    normalizedMessage.includes("429");

  return {
    ok: false,
    status: isRateLimit ? 429 : 500,
    payload: formatApiError(
      isRateLimit
        ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
        : "Error al generar el dashboard. Inténtalo de nuevo.",
      isRateLimit ? "LLM_RATE_LIMIT" : "LLM_ERROR",
      sanitizeErrorMessage(err),
      requestId,
    ) as unknown as Record<string, unknown>,
  };
}

const WIDGET_ALLOWED_FIELDS: Record<string, string[]> = {
  kpi_row: ["id", "type", "items"],
  bar_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  line_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  area_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  donut_chart: ["id", "type", "title", "sql", "x", "y", "comparison_sql"],
  table: ["id", "type", "title", "sql"],
  number: ["id", "type", "title", "sql", "format", "prefix"],
};

function resolveWidgetAllowedFields(zodError: ZodError, parsed: unknown): string[] | undefined {
  for (const issue of zodError.issues) {
    const [seg0, seg1] = issue.path;
    if (seg0 !== "widgets" || typeof seg1 !== "number" || issue.path.length > 3) continue;

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

export async function POST(request: Request): Promise<NextResponse | Response> {
  const requestId = generateRequestId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("Cuerpo JSON no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

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

  const record = body as Record<string, unknown>;
  const prompt = (record.prompt as string).trim();
  if (prompt.length === 0) {
    return NextResponse.json(
      formatApiError("El prompt no puede estar vacío.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  const wantStream = record.stream === true;

  if (wantStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };

        send({
          type: "meta",
          requestId,
          message: "Generación con IA iniciada",
          promptPreview: prompt.slice(0, 200),
        });

        let rawResponse: string;
        try {
          rawResponse = await generateDashboard(prompt, {
            requestId,
            endpoint: "generateDashboard",
            onAgenticProgress: (ev) => {
              logAgenticProgress(requestId, ev);
              send({ type: "progress", requestId, event: ev });
            },
          });
        } catch (err: unknown) {
          const mapped = mapGenerateLlmError(err, requestId);
          send({
            type: "error",
            requestId,
            httpStatus: mapped.status,
            ...mapped.payload,
          });
          controller.close();
          return;
        }

        send({ type: "phase", requestId, message: "Validando JSON del panel…" });
        const finish = finishGenerateFromRawLlm(rawResponse, requestId);
        if (!finish.ok) {
          send({
            type: "error",
            requestId,
            httpStatus: finish.status,
            ...finish.payload,
          });
          controller.close();
          return;
        }

        send({ type: "result", requestId, spec: finish.spec });
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

  let rawResponse: string;
  try {
    rawResponse = await generateDashboard(prompt, {
      requestId,
      endpoint: "generateDashboard",
      onAgenticProgress: (ev) => logAgenticProgress(requestId, ev),
    });
  } catch (err: unknown) {
    const mapped = mapGenerateLlmError(err, requestId);
    return NextResponse.json(mapped.payload, { status: mapped.status });
  }

  const finish = finishGenerateFromRawLlm(rawResponse, requestId);
  if (!finish.ok) {
    return NextResponse.json(finish.payload, { status: finish.status });
  }
  return NextResponse.json(finish.spec, { status: 200 });
}
