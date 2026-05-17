/**
 * Shared hook for creating and persisting conversations that originate from
 * the ChatSidebar "Analizar" or "Modificar" tabs.
 *
 * Previously these tabs stored messages only in the dashboard's
 * `chat_messages_analyze`/`chat_messages_modify` columns.  If the browser
 * was closed mid-session the chat history was lost and no record appeared in
 * the /conversations list.
 *
 * This hook:
 *   1. On the first message send, creates a conversation record via
 *      POST /api/conversations (mode + context_kind=dashboard + context_ref).
 *   2. After creation it saves the user message immediately (so the record
 *      has content even if the LLM times out).
 *   3. After the LLM responds it saves the assistant message.
 *   4. Subsequent messages in the same session reuse the same conversationId.
 *
 * The existing chat_messages_* dashboard cache remains intact for backwards
 * compatibility (legacy consumers still read from there).
 */

import { useRef, useCallback } from "react";

interface SaveMessageOptions {
  role: "user" | "assistant";
  content: string;
}

interface UseDashboardConversationResult {
  /** Ensures a conversation row exists; returns the conversation ID. */
  ensureConversation: (mode: "modify" | "analyze") => Promise<string | null>;
  /** Saves a single message to the conversation (no LLM). */
  saveMessage: (convId: string, opts: SaveMessageOptions) => Promise<void>;
  /** The current conversation ID (null if no conversation created yet). */
  conversationIdRef: React.MutableRefObject<string | null>;
}

export function useDashboardConversation(
  dashboardId: number | undefined,
): UseDashboardConversationResult {
  const conversationIdRef = useRef<string | null>(null);

  const ensureConversation = useCallback(
    async (mode: "modify" | "analyze"): Promise<string | null> => {
      if (!dashboardId) return null;
      if (conversationIdRef.current) return conversationIdRef.current;

      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            context_kind: "dashboard",
            context_ref: String(dashboardId),
            context_url: `/paneles/${dashboardId}`,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id: string };
        conversationIdRef.current = data.id;
        return data.id;
      } catch {
        return null;
      }
    },
    [dashboardId],
  );

  const saveMessage = useCallback(
    async (convId: string, { role, content }: SaveMessageOptions): Promise<void> => {
      try {
        await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content, callLlm: false }),
        });
      } catch {
        // Best-effort — don't block the UI if persistence fails
      }
    },
    [],
  );

  return { ensureConversation, saveMessage, conversationIdRef };
}
