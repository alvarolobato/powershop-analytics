import type { DashboardSpec } from "@/lib/schema";
import type { AgenticProgressEvent } from "@/lib/llm-tools/types";
import { formatAgenticProgressLineEs } from "@/lib/format-agentic-progress";
import {
  isApiErrorResponse,
  type ApiErrorResponse,
  type ErrorCode,
} from "@/lib/errors";

export interface DashboardGenerateStreamHandlers {
  onMeta?: (requestId: string, lines: string[]) => void;
  onLine?: (line: string) => void;
}

/**
 * Calls POST /api/dashboard/generate with `{ stream: true }` and consumes NDJSON
 * until a `result` line. Falls back to a plain JSON body if the server returns
 * `application/json` (older deployments).
 */
export async function runDashboardGenerateStream(
  prompt: string,
  handlers: DashboardGenerateStreamHandlers,
): Promise<DashboardSpec> {
  const res = await fetch("/api/dashboard/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, stream: true }),
  });

  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as unknown;
    if (isApiErrorResponse(data)) {
      throw data;
    }
    throw new Error(
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`,
    );
  }

  if (ct.includes("application/json")) {
    return (await res.json()) as DashboardSpec;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No se pudo leer la respuesta del servidor");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalSpec: DashboardSpec | null = null;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.type === "meta" && typeof msg.requestId === "string") {
      const lines: string[] = [];
      if (typeof msg.message === "string") lines.push(msg.message);
      if (typeof msg.promptPreview === "string") {
        lines.push(`Resumen del prompt: ${msg.promptPreview}`);
      }
      handlers.onMeta?.(msg.requestId, lines);
    }

    if (msg.type === "progress" && msg.event) {
      handlers.onLine?.(formatAgenticProgressLineEs(msg.event as AgenticProgressEvent));
    }

    if (msg.type === "phase" && typeof msg.message === "string") {
      handlers.onLine?.(String(msg.message));
    }

    if (msg.type === "result" && msg.spec) {
      finalSpec = msg.spec as DashboardSpec;
    }

    if (msg.type === "error") {
      const payload: ApiErrorResponse = {
        error: String(msg.error ?? "Error"),
        code:
          typeof msg.code === "string" ? (msg.code as ErrorCode) : ("UNKNOWN" as ErrorCode),
        ...(typeof msg.details === "string" ? { details: msg.details } : {}),
        timestamp: typeof msg.timestamp === "string" ? msg.timestamp : new Date().toISOString(),
        requestId: typeof msg.requestId === "string" ? msg.requestId : "",
      };
      throw payload;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      processLine(line);
    }
  }

  buffer += decoder.decode();
  processLine(buffer);

  if (!finalSpec) {
    throw new Error("La generación terminó sin resultado del panel");
  }
  return finalSpec;
}
