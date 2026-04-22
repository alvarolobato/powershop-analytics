/**
 * Normalize tool results and errors for the model (size limits, stable shape).
 */

import type { LlmAgenticContext } from "./types";

export interface ToolErrorBody {
  ok: false;
  code: string;
  message: string;
  requestId: string;
}

export interface ToolOkBody<T = unknown> {
  ok: true;
  data: T;
}

export type ToolResponseBody<T = unknown> = ToolOkBody<T> | ToolErrorBody;

export function toolError(
  code: string,
  message: string,
  ctx: LlmAgenticContext,
): ToolErrorBody {
  return { ok: false, code, message, requestId: ctx.requestId };
}

export function toolOk<T>(data: T): ToolOkBody<T> {
  return { ok: true, data };
}

export function stringifyToolPayload(
  body: ToolResponseBody,
  maxChars: number,
): string {
  let s: string;
  try {
    s = JSON.stringify(body);
  } catch {
    s = JSON.stringify(
      toolError("SERIALIZATION_ERROR", "Could not serialize tool result.", {
        requestId: "",
        endpoint: "",
      }),
    );
  }
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 40))}\n...[truncated]`;
}
