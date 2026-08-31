/**
 * Tool catalog lookup by flow.
 *
 * Phase 1 stub — returns the appropriate tool catalog based on the flow name.
 */

import { DASHBOARD_AGENTIC_TOOLS, FREE_CHAT_TOOLS } from "@/lib/llm-tools/catalog";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { isLlmFlow } from "./types";

// Flows that are always single-shot (JSON-only output, no tool calls needed).
const SINGLE_SHOT_FLOWS = new Set(["suggest", "gap", "title"]);

/**
 * Return the tool catalog for a given LLM flow.
 *
 * - "chat" | "summary"              → FREE_CHAT_TOOLS (data inspection + start_dashboard_generation + set_title).
 *                                      "summary" backs the weekly-summary conversation
 *                                      (see system-prompt.ts's SUMMARY_PREAMBLE) — its seed
 *                                      prompt expects the same read-only inspection tools
 *                                      chat has, nothing more (D-045).
 * - "suggest" | "gap" | "title"     → [] (single-shot, no tools)
 * - unknown / unregistered flows    → [] (no tools — mirrors buildSystemPrompt's empty-prompt
 *                                      behavior for unrecognised flows; prevents silent
 *                                      capability escalation, D-045)
 * - all other known flows           → DASHBOARD_AGENTIC_TOOLS (full catalog, includes weekly)
 */
export function toolsForFlow(flow: string): ChatCompletionTool[] {
  if (!isLlmFlow(flow)) return [];
  if (SINGLE_SHOT_FLOWS.has(flow)) return [];
  if (flow === "chat" || flow === "summary") return FREE_CHAT_TOOLS;
  // Un flujo de dashboard NUNCA puede lanzar otra generación de dashboard.
  //
  // `DASHBOARD_AGENTIC_TOOLS` incluye `start_dashboard_generation` porque
  // `FREE_CHAT_TOOLS` se deriva de él por filtro, pero dársela a `generate`
  // significa entregarle al generador la herramienta para arrancar otro
  // generador: cada llamada crea un turno de seguimiento que a su vez puede
  // volver a llamarla. El propio handler ya avisa por texto ("NO vuelvas a
  // llamar a start_dashboard_generation en este turno"), y una instrucción no
  // es una garantía. Quitarla del catálogo sí lo es.
  return DASHBOARD_AGENTIC_TOOLS.filter(
    (t) => !(t.type === "function" && t.function.name === "start_dashboard_generation"),
  );
}
