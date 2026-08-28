/**
 * Tool catalog lookup by flow.
 *
 * Phase 1 stub — returns the appropriate tool catalog based on the flow name.
 */

import { DASHBOARD_AGENTIC_TOOLS, FREE_CHAT_TOOLS } from "@/lib/llm-tools/catalog";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// Flows that are always single-shot (JSON-only output, no tool calls needed).
const SINGLE_SHOT_FLOWS = new Set(["suggest", "gap", "title"]);

/**
 * Return the tool catalog for a given LLM flow.
 *
 * - "chat" | "summary"              → FREE_CHAT_TOOLS (data inspection + start_dashboard_generation + set_title).
 *                                      "summary" backs the weekly-summary conversation
 *                                      (see system-prompt.ts's SUMMARY_PREAMBLE) — its seed
 *                                      prompt expects the same read-only inspection tools
 *                                      chat has, nothing more (D-042).
 * - "suggest" | "gap" | "title"     → [] (single-shot, no tools)
 * - all other flows                 → DASHBOARD_AGENTIC_TOOLS (full catalog, includes weekly)
 */
export function toolsForFlow(flow: string): ChatCompletionTool[] {
  if (SINGLE_SHOT_FLOWS.has(flow)) return [];
  if (flow === "chat" || flow === "summary") return FREE_CHAT_TOOLS;
  return DASHBOARD_AGENTIC_TOOLS;
}
