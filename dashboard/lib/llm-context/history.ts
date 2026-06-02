/**
 * History assembly for LLM requests.
 *
 * Loads prior conversation turns and flattens them to `{ role, content }` lines.
 * Tool calls an assistant turn made are folded into that turn as a compact block
 * (`flattenStoredMessage` / `formatToolCallsForHistory`) so the tool context — the
 * query and its truncated result — is preserved for later turns.
 */

import { loadMessages } from "@/lib/conversations";
import type { ToolCallRecord } from "@/lib/conversation-types";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/** Max chars kept per tool result when folding it into history (the "interesting part"). */
const HISTORY_TOOL_RESULT_MAX = 600;
/** Max chars kept per tool argument string when folding it into history. */
const HISTORY_TOOL_ARGS_MAX = 240;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}

function compactArgs(args: unknown): string {
  let s: string;
  if (typeof args === "string") s = args;
  else {
    try {
      s = JSON.stringify(args);
    } catch {
      s = String(args);
    }
  }
  return truncate(s.replace(/\s+/g, " ").trim(), HISTORY_TOOL_ARGS_MAX);
}

function compactResult(result: unknown): string {
  if (result === undefined || result === null) return "(sin resultado)";
  const s = typeof result === "string" ? result : (() => {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  })();
  return truncate(s.replace(/\s+/g, " ").trim(), HISTORY_TOOL_RESULT_MAX);
}

/**
 * Render the tool calls an assistant turn made into a compact, readable block so
 * later turns retain the "interesting part" — which tool ran, with what args, and
 * the (truncated) result the model saw. Returns "" when there are no tool calls.
 */
export function formatToolCallsForHistory(toolCalls: ToolCallRecord[]): string {
  if (!toolCalls || toolCalls.length === 0) return "";
  const lines = toolCalls.map((tc) => {
    const status = tc.success === false ? " [error]" : "";
    return `- ${tc.name}(${compactArgs(tc.arguments)})${status} → ${compactResult(tc.result)}`;
  });
  return `[Datos consultados con herramientas en esta respuesta]\n${lines.join("\n")}`;
}

/**
 * Flatten a stored conversation_messages row to a single history line for the LLM,
 * or null to skip it. User/assistant text is extracted from the JSONB content;
 * tool calls recorded on an assistant message are folded in as a compact block so
 * the conversational context (including tool results) is preserved across turns.
 * Standalone tool-role rows are skipped — tool context lives on the assistant row.
 */
export function flattenStoredMessage(row: {
  role: string;
  content: unknown;
}): HistoryMessage | null {
  if (row.role !== "user" && row.role !== "assistant") return null;

  const c = row.content;
  let text = "";
  let toolCalls: ToolCallRecord[] | undefined;

  if (typeof c === "string") {
    text = c;
  } else if (c !== null && typeof c === "object" && !Array.isArray(c)) {
    const obj = c as Record<string, unknown>;
    let recognized = false;
    if (typeof obj.text === "string") {
      text = obj.text;
      recognized = true;
    }
    if (Array.isArray(obj.tool_calls)) {
      toolCalls = obj.tool_calls as ToolCallRecord[];
      recognized = true;
    }
    // Only stringify genuinely unknown content shapes — an object with a known
    // (but empty) text field is an empty turn, which we skip below.
    if (!recognized) text = JSON.stringify(c);
  } else {
    text = JSON.stringify(c);
  }

  if (row.role === "assistant" && toolCalls && toolCalls.length > 0) {
    const block = formatToolCallsForHistory(toolCalls);
    text = text ? `${block}\n\n${text}` : block;
  }

  if (!text) return null;
  return { role: row.role as "user" | "assistant", content: text };
}

/**
 * Build conversation history for an LLM request.
 *
 * Priority:
 * 1. If `opts.priorMessages` is provided, return them unchanged (caller pre-loaded).
 * 2. If `conversationId` is provided, load from DB and flatten to HistoryMessage[].
 * 3. Otherwise return [].
 *
 * Flattening: extracts `.text` from JSONB content objects, falls back to JSON.stringify.
 * Tool calls recorded on an assistant message are folded into that turn as a compact
 * block (see `flattenStoredMessage`) so tool results persist as context across turns.
 */
export async function buildHistory(
  conversationId: string | null,
  opts?: { priorMessages?: HistoryMessage[] },
): Promise<HistoryMessage[]> {
  if (opts?.priorMessages) return opts.priorMessages;
  if (!conversationId) return [];

  const rows = await loadMessages(conversationId);
  const messages: HistoryMessage[] = [];

  for (const row of rows) {
    const flat = flattenStoredMessage(row);
    if (flat) messages.push(flat);
  }

  return messages;
}

// Re-export legacy functions from conversation-context so callers can
// import from @/lib/llm-context instead. Deprecated — will be the canonical
// location once task 7 removes them from conversation-context.ts.
export { loadPriorTurns, summariseOldTurns } from "@/lib/conversation-context";
