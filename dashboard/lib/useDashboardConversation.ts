/**
 * Shared hook for creating and persisting conversations that originate from
 * the ChatSidebar "Analizar" or "Modificar" tabs.
 *
 * Previously these tabs stored messages only in the (now-removed)
 * `chat_messages_analyze`/`chat_messages_modify` columns on the dashboards
 * table.  If the browser was closed mid-session the chat history was lost
 * and no record appeared in the /conversations list.
 *
 * This hook:
 *   1. On the first message send, creates a conversation record via
 *      POST /api/conversations (mode + context_kind=dashboard + context_ref).
 *   2. After creation it saves the user message immediately (so the record
 *      has content even if the LLM times out).
 *   3. After the LLM responds it saves the assistant message.
 *   4. Subsequent messages in the same session reuse the same conversationId.
 */

import { useRef, useCallback } from "react";

type DashboardMode = "modify" | "analyze";

interface SaveMessageOptions {
  role: "user" | "assistant";
  content: string;
}

interface UseDashboardConversationResult {
  ensureConversation: (mode: DashboardMode) => Promise<string | null>;
  saveMessage: (convId: string, opts: SaveMessageOptions) => Promise<void>;
  conversationIdRef: React.MutableRefObject<string | null>;
}

export function useDashboardConversation(
  dashboardId: number | undefined,
): UseDashboardConversationResult {
  const conversationIdRef = useRef<string | null>(null);
  const modeRef = useRef<DashboardMode | null>(null);

  const ensureConversation = useCallback(
    async (mode: DashboardMode): Promise<string | null> => {
      if (!dashboardId) return null;
      if (conversationIdRef.current) return conversationIdRef.current;
      modeRef.current = mode;
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            flow: mode,          // passed through to initial_context snapshot
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
        const flow = modeRef.current ?? "chat";
        await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content, callLlm: false, flow }),
        });
        // After the assistant message lands, trigger title generation.
        if (role === "assistant") {
          void fetch(`/api/conversations/${convId}/generate-title`, {
            method: "POST",
          }).catch(() => {});
        }
      } catch {
        // Best-effort — don't block the UI if persistence fails
      }
    },
    [],
  );

  return { ensureConversation, saveMessage, conversationIdRef };
}
