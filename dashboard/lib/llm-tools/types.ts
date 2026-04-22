/**
 * Shared types for the agentic LLM tool layer.
 */

export interface LlmAgenticContext {
  /** API correlation id (also sent to the model in tool error payloads). */
  requestId: string;
  /** `logUsage` / telemetry endpoint key, e.g. generateDashboard. */
  endpoint: string;
  /** Optional saved dashboard id (analyze flow) for dashboard-scoped tools. */
  dashboardId?: number;
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
