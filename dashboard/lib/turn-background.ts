/**
 * Server-side turn executor — runs the LLM call for a conversation turn.
 *
 * Called fire-and-forget from POST /api/conversations/:id/turns.
 * Writes turn_events rows as progress is made; transitions conversation_turns.status.
 * Never throws — errors are caught and stored in the turn row.
 */

import {
  updateTurnStatus,
  insertTurnEvent,
  type TurnRow,
} from "@/lib/turn-events";
import {
  appendMessage,
  loadMessages,
  maybeGenerateTitle,
  touchConversation,
  type ConversationRow,
} from "@/lib/conversations";
import { generateRequestId } from "@/lib/errors";

// Re-export for use in tests without importing from route
export type { ConversationRow };

// ── Sequential event counter per turn ─────────────────────────────────────────

function makeSeq(): () => number {
  let n = 0;
  return () => n++;
}

// ── Dispatcher ─────────────────────────────────────────────────────────────────

export async function runTurnBackground(
  turnId: string,
  conversation: ConversationRow,
  userMessage: string,
): Promise<void> {
  const requestId = generateRequestId();
  const seq = makeSeq();
  const conversationId = conversation.id;

  try {
    await updateTurnStatus(turnId, "streaming");

    // Emit context snapshot event (which model/provider/tools are being used).
    const contextPayload = buildContextPayload(conversation, requestId);
    await insertTurnEvent(turnId, seq(), "context", contextPayload);

    // Build prior message history for multi-turn context.
    const prior = await loadMessages(conversationId);
    const priorMessages = prior
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const c = m.content;
        const text =
          typeof c === "string"
            ? c
            : c !== null &&
                typeof c === "object" &&
                !Array.isArray(c) &&
                typeof (c as Record<string, unknown>).text === "string"
              ? ((c as Record<string, unknown>).text as string)
              : JSON.stringify(c);
        return { role: m.role as "user" | "assistant", content: text };
      });

    // Dispatch to the appropriate LLM path based on conversation mode.
    let assistantText: string;
    const mode = conversation.mode;
    const isFreeChatConv = conversation.context_kind === "global" || mode === "chat";

    await insertTurnEvent(turnId, seq(), "log", {
      kind: "meta",
      text: "Procesando…",
      ts: new Date().toISOString(),
    });

    if (isFreeChatConv) {
      assistantText = await runFreeChatTurn(
        userMessage,
        priorMessages,
        requestId,
        conversationId,
        turnId,
        seq,
      );
    } else if (mode === "analyze" || mode === "modify") {
      assistantText = await runDashboardTurn(
        mode,
        conversation,
        userMessage,
        priorMessages,
        requestId,
      );
    } else {
      // Fallback: generic single-shot chat completion.
      assistantText = await runGenericTurn(
        conversation,
        userMessage,
        priorMessages,
        requestId,
      );
    }

    // Persist final assistant message to conversation_messages.
    const assistantMsg = await appendMessage(conversationId, "assistant", {
      text: assistantText,
    });
    await touchConversation(conversationId, "ok");

    // Emit the complete event with the assistant message for SSE clients.
    await insertTurnEvent(turnId, seq(), "complete", { messageId: assistantMsg.id });

    await updateTurnStatus(turnId, "complete");

    // Best-effort title generation — failure must not affect turn status.
    void maybeGenerateTitle(conversationId, [
      ...priorMessages,
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: assistantText },
    ]).catch(() => {});
  } catch (err) {
    const errText = err instanceof Error ? err.message : String(err);
    console.error(`[${requestId}] runTurnBackground error for turn ${turnId}:`, err);
    await insertTurnEvent(turnId, seq(), "error", {
      message: errText,
      ts: new Date().toISOString(),
    }).catch(() => {});
    await updateTurnStatus(turnId, "error", errText).catch(() => {});
    await touchConversation(conversationId, "error").catch(() => {});
  }
}

// ── LLM dispatch helpers ───────────────────────────────────────────────────────

async function runFreeChatTurn(
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
  conversationId: string,
  turnId: string,
  seq: () => number,
): Promise<string> {
  const { buildFreeChatContext } = await import("@/lib/conversation-context");
  const {
    runAgenticChat,
    AgenticRunnerError,
  } = await import("@/lib/llm-tools/runner");
  const {
    loadDashboardLlmConfig,
    getEffectiveDashboardModel,
    getEffectiveOpenRouterProvider,
  } = await import("@/lib/llm-provider/config");
  const { createDashboardAgenticAdapter } = await import("@/lib/llm-client");

  const freeChatCtx = buildFreeChatContext();
  const cfg = loadDashboardLlmConfig();
  const model = getEffectiveDashboardModel(cfg);
  const openRouterProvider = getEffectiveOpenRouterProvider(cfg);
  const adapter = createDashboardAgenticAdapter();

  const agenticCtx = {
    requestId,
    endpoint: "freeChat" as const,
    conversationId,
    llmProvider: cfg.provider,
    llmDriver: cfg.provider === "cli" ? cfg.cliDriver : null,
  };

  try {
    const { content } = await runAgenticChat({
      adapter,
      model,
      openRouterProvider,
      systemPrompt: freeChatCtx.systemPrompt.stable,
      userContent: userMessage,
      ctx: agenticCtx,
      temperature: 0.3,
      maxTokens: 4096,
      priorMessages,
      tools: freeChatCtx.tools,
    });
    return content;
  } catch (err) {
    if (err instanceof AgenticRunnerError) {
      await insertTurnEvent(turnId, seq(), "log", {
        kind: "error",
        text: err.message,
        ts: new Date().toISOString(),
      }).catch(() => {});
    }
    throw err;
  }
}

async function runDashboardTurn(
  mode: string,
  conversation: ConversationRow,
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
): Promise<string> {
  const { sql } = await import("@/lib/db-write");
  const agenticCtx = {
    requestId,
    endpoint: (mode === "analyze" ? "analyzeDashboard" : "modifyDashboard") as
      | "analyzeDashboard"
      | "modifyDashboard",
    conversationId: conversation.id,
  };

  let currentSpec = "";
  if (conversation.context_ref) {
    const specRows = await sql<{ spec: unknown }>(
      `SELECT spec FROM dashboards WHERE id = $1`,
      [parseInt(conversation.context_ref, 10)],
    ).catch(() => [] as { spec: unknown }[]);
    currentSpec = specRows[0]?.spec ? JSON.stringify(specRows[0].spec) : "";
  }

  if (mode === "analyze") {
    const { analyzeDashboard } = await import("@/lib/llm");
    return analyzeDashboard(currentSpec, userMessage, undefined, agenticCtx, priorMessages);
  } else {
    const { modifyDashboard } = await import("@/lib/llm");
    return modifyDashboard(currentSpec, userMessage, agenticCtx, priorMessages);
  }
}

async function runGenericTurn(
  conversation: ConversationRow,
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
): Promise<string> {
  const { llmComplete } = await import("@/lib/llm-client");
  const flowRaw = conversation.mode ?? "chat";
  const resp = await llmComplete({
    flow: flowRaw,
    systemPrompt: { stable: "" },
    messages: [
      ...priorMessages,
      { role: "user" as const, content: userMessage },
    ],
    requestId,
  });
  return resp.text;
}

// ── Context snapshot builder ───────────────────────────────────────────────────

function buildContextPayload(
  conversation: ConversationRow,
  requestId: string,
): Record<string, unknown> {
  if (conversation.initial_context) {
    return { context: conversation.initial_context, requestId };
  }
  return {
    context: {
      model: conversation.llm_driver ?? conversation.llm_provider ?? "unknown",
      provider: conversation.llm_provider ?? "unknown",
      flow: conversation.mode ?? "chat",
    },
    requestId,
  };
}
