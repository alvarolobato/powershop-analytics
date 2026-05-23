/**
 * History assembly for LLM requests.
 *
 * Phase 1: thin wrappers that delegate to existing infrastructure.
 * Phase 2: will add proper tool-call/tool-result round-trip preservation.
 */

import { loadMessages } from "@/lib/conversations";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * Build conversation history for an LLM request.
 *
 * Priority:
 * 1. If `opts.priorMessages` is provided, return them unchanged (caller pre-loaded).
 * 2. If `conversationId` is provided, load from DB and flatten to HistoryMessage[].
 * 3. Otherwise return [].
 *
 * Flattening: extracts `.text` from JSONB content objects, falls back to JSON.stringify.
 * Tool-call/tool-result entries are skipped (Phase 2 will preserve them).
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
    if (row.role !== "user" && row.role !== "assistant") continue;
    const c = row.content;
    let text: string;
    if (typeof c === "string") {
      text = c;
    } else if (
      c !== null &&
      typeof c === "object" &&
      !Array.isArray(c) &&
      typeof (c as Record<string, unknown>).text === "string"
    ) {
      text = (c as Record<string, unknown>).text as string;
    } else {
      text = JSON.stringify(c);
    }
    messages.push({ role: row.role as "user" | "assistant", content: text });
  }

  return messages;
}

// Re-export legacy functions from conversation-context so callers can
// import from @/lib/llm-context instead. Deprecated — will be the canonical
// location once task 7 removes them from conversation-context.ts.
export { loadPriorTurns, summariseOldTurns } from "@/lib/conversation-context";
