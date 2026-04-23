/**
 * Shared types for the agentic LLM tool layer.
 */

/** High-level events from the tool loop (UI streaming + server logs). */
export type AgenticProgressEvent =
  | { type: "round"; round: number; maxRounds: number }
  | { type: "assistant_tools"; round: number; tools: string[] }
  | { type: "tool_start"; round: number; name: string; toolCallId: string }
  | {
      type: "tool_done";
      round: number;
      name: string;
      toolCallId: string;
      ok: boolean;
      ms: number;
      errorCode?: string | null;
    }
  | { type: "finalizing"; messageChars: number };

export interface LlmAgenticContext {
  /** API correlation id (also sent to the model in tool error payloads). */
  requestId: string;
  /** `logUsage` / telemetry endpoint key, e.g. generateDashboard. */
  endpoint: string;
  /** Optional saved dashboard id (analyze flow) for dashboard-scoped tools. */
  dashboardId?: number;
  /** Optional hook for NDJSON streaming UI and diagnostics. */
  onAgenticProgress?: (event: AgenticProgressEvent) => void;
}

export interface AgenticUsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function emptyUsage(): AgenticUsageTotals {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

export function addUsage(
  acc: AgenticUsageTotals,
  u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): void {
  if (!u) return;
  acc.prompt_tokens += u.prompt_tokens ?? 0;
  acc.completion_tokens += u.completion_tokens ?? 0;
  acc.total_tokens += u.total_tokens ?? 0;
}
