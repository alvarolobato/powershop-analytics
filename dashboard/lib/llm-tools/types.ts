/**
 * Shared types for the agentic LLM tool layer.
 */

import type { DashboardCliDriverId, DashboardLlmProviderId } from "@/lib/llm-provider/types";
import type { DashboardSpec } from "@/lib/schema";
import type { ReviewLlmOutput } from "@/lib/review-schema";

/** High-level events from the tool loop (UI streaming + server logs). */
export type AgenticProgressEvent =
  | { type: "round"; round: number; maxRounds: number }
  | { type: "model_step_start"; round: number; provider: DashboardLlmProviderId; driver: DashboardCliDriverId | null }
  | { type: "model_text_delta"; round: number; chars: number; totalChars: number }
  | { type: "assistant_tools"; round: number; tools: string[] }
  | { type: "tool_start"; round: number; name: string; toolCallId: string; argsPreview?: string }
  | {
      type: "tool_done";
      round: number;
      name: string;
      toolCallId: string;
      ok: boolean;
      ms: number;
      errorCode?: string | null;
      argsPreview?: string;
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
  /** Telemetry: active LLM transport (OpenRouter HTTP vs local CLI). */
  llmProvider?: DashboardLlmProviderId;
  /** When `llmProvider` is `cli`, which driver binary/protocol is used. */
  llmDriver?: DashboardCliDriverId | null;

  // ── Publish-tool side-channel slots ────────────────────────────────────────
  // These slots are populated by the publish-tool handlers and read by the
  // route AFTER the agentic loop returns. Handlers MUST only stage results
  // here — they MUST NOT persist directly to the database (dashboards /
  // weekly_reviews). The route is the single point of persistence.

  /**
   * Staged result for the `apply_dashboard_modification` tool.
   * Set by `handleApplyDashboardModification`; read by the modify route.
   * The LAST call wins — the route always uses the final value after the loop.
   */
  modifyResult?: { spec: DashboardSpec; summary: string } | null;

  /**
   * Staged result for the `submit_dashboard_analysis` tool.
   * Set by `handleSubmitDashboardAnalysis`; read by the analyze route.
   */
  analyzeResult?: { markdown: string; summary: string } | null;

  /**
   * Staged result for the `submit_weekly_review` tool.
   * Set by `handleSubmitWeeklyReview`; read by the review/generate route.
   */
  reviewResult?: { content: ReviewLlmOutput; summary: string } | null;
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
