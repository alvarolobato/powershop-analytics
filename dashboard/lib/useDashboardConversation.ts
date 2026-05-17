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

import { useRef, useCallback, useMemo } from "react";
import type { InitialContext } from "@/lib/conversation-types";
import { useConfiguredModel } from "@/lib/useConfiguredModel";

type DashboardMode = "modify" | "analyze";

interface SaveMessageOptions {
  role: "user" | "assistant";
  content: string;
  logs?: unknown[] | null;
}

export interface EnsureConversationResult {
  id: string;
  /** initial_context returned synchronously from ensureConversation so callers
   *  don't need a second fetch to show the "Contexto original" panel. */
  initialContext: InitialContext | null;
}

interface UseDashboardConversationResult {
  /** Returns both the conversation ID and its initial_context so the caller can
   *  update the UI without a second round-trip. */
  ensureConversation: (mode: DashboardMode, firstPrompt?: string) => Promise<EnsureConversationResult | null>;
  saveMessage: (convId: string, opts: { role: "user" | "assistant"; content: string; logs?: unknown[] | null }) => Promise<void>;
  /** Archive the current conversation and reset so the next send creates a fresh one. */
  startNewConversation: () => Promise<void>;
  conversationIdRef: React.MutableRefObject<string | null>;
}

export function useDashboardConversation(
  dashboardId: number | undefined,
): UseDashboardConversationResult {
  const conversationIdRef = useRef<string | null>(null);
  const modeRef = useRef<DashboardMode | null>(null);

  // Build initial_context client-side so it's available immediately without
  // waiting for any network response. model/provider come from the same config
  // the dashboard uses for all LLM calls.
  // useConfiguredModel fetches the model name client-side (GET /api/config/model).
  // We use it to build initial_context without any server-side config imports.
  const configuredModel = useConfiguredModel();
  const builtInitialContext = useMemo<InitialContext>(() => ({
    model: configuredModel ?? "claude-sonnet-4-6",
    provider: "cli",
    driver: "claude_code",
    system_prompt_stable: "",
    tools: [],
    config: { flow: modeRef.current ?? "analyze" },
  } as InitialContext), [configuredModel]);

  const ensureConversation = useCallback(
    async (mode: DashboardMode, firstPrompt?: string): Promise<EnsureConversationResult | null> => {
      if (!dashboardId) return null;
      modeRef.current = mode;

      // Build initial_context client-side — never null, never depends on a network
      // response. The "Contexto original" panel must show immediately on first send.
      const initialContext: InitialContext = {
        ...(builtInitialContext ?? {
          model: "unknown",
          provider: "cli",
          driver: null,
          system_prompt_stable: "",
          tools: [],
        }),
        config: { flow: mode },
      } as InitialContext;

      // If we already have a conversation for this session, return it immediately.
      if (conversationIdRef.current) {
        return { id: conversationIdRef.current, initialContext };
      }

      // Reuse the most-recent non-archived conversation for this dashboard+mode.
      try {
        const checkRes = await fetch(
          `/api/conversations?context_kind=dashboard&context_ref=${dashboardId}&mode=${mode}&limit=1`,
        );
        if (checkRes.ok) {
          const data = (await checkRes.json()) as
            | { id: string; archived_at: string | null }[]
            | { conversations: { id: string; archived_at: string | null }[] };
          const list = Array.isArray(data) ? data : data.conversations;
          if (list?.length && !list[0].archived_at) {
            conversationIdRef.current = list[0].id;
            return { id: list[0].id, initialContext };
          }
        }
      } catch { /* fall through to creation */ }

      // Create a new conversation.
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            flow: mode,
            context_kind: "dashboard",
            context_ref: String(dashboardId),
            context_url: `/paneles/${dashboardId}`,
            ...(firstPrompt ? { first_user_prompt: firstPrompt } : {}),
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id: string };
        conversationIdRef.current = data.id;
        return { id: data.id, initialContext };
      } catch {
        return null;
      }
    },
    [dashboardId, builtInitialContext],
  );

  const saveMessage = useCallback(
    async (convId: string, { role, content, logs }: SaveMessageOptions): Promise<void> => {
      try {
        const flow = modeRef.current ?? "chat";
        await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content, callLlm: false, flow, ...(logs != null ? { logs } : {}) }),
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

  // Archive the current conversation and reset so the next send creates a
  // fresh one.  Called by "Nueva conversación" in ChatSidebar.
  const startNewConversation = useCallback(async () => {
    const id = conversationIdRef.current;
    conversationIdRef.current = null;
    if (!id) return;
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
    } catch { /* best-effort */ }
  }, []);

  return { ensureConversation, saveMessage, startNewConversation, conversationIdRef };
}
