/**
 * Tool catalog lookup by flow.
 *
 * Phase 1 stub — returns the appropriate tool catalog based on the flow name.
 */

import { DASHBOARD_AGENTIC_TOOLS, FREE_CHAT_TOOLS } from "@/lib/llm-tools/catalog";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * Return the tool catalog for a given LLM flow.
 *
 * - "chat" → FREE_CHAT_TOOLS (data inspection + start_dashboard_generation + set_title)
 * - all other flows → DASHBOARD_AGENTIC_TOOLS (full catalog)
 */
export function toolsForFlow(flow: string): ChatCompletionTool[] {
  if (flow === "chat") return FREE_CHAT_TOOLS;
  return DASHBOARD_AGENTIC_TOOLS;
}
