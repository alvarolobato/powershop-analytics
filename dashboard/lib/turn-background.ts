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
import { publish } from "@/lib/sse-pubsub";
import { generateRequestId } from "@/lib/errors";

// Re-export for use in tests without importing from route
export type { ConversationRow };

// ── Sequential event counter per turn ─────────────────────────────────────────

function makeSeq(): () => number {
  let n = 0;
  return () => n++;
}

// ── Insert + publish helper ────────────────────────────────────────────────────

async function emitTurnEvent(
  conversationId: string,
  turnId: string,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const dbEventId = await insertTurnEvent(turnId, seq, eventType, payload);
  publish(conversationId, { dbEventId, turnId, seq, eventType, payload });
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
    await emitTurnEvent(conversationId, turnId, seq(), "context", contextPayload);

    // Build prior message history for multi-turn context.
    // Must be loaded before appending the current user message so the current
    // turn's user content isn't duplicated in priorMessages and userContent.
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

    // Persist user message so future turns can reconstruct full history.
    await appendMessage(conversationId, "user", { text: userMessage });

    // Dispatch to the appropriate LLM path based on conversation mode.
    let assistantText: string;
    const mode = conversation.mode;
    const isFreeChatConv = conversation.context_kind === "global" || mode === "chat";

    await emitTurnEvent(conversationId, turnId, seq(), "log", {
      kind: "meta",
      text: "Procesando…",
      ts: new Date().toISOString(),
    });

    // E2E stub: return a canned response instantly without calling any LLM.
    // Activated by DASHBOARD_LLM_PROVIDER=e2e-stub — used in CI Playwright tests
    // to avoid API costs and external dependencies.
    if (process.env.DASHBOARD_LLM_PROVIDER === "e2e-stub") {
      await emitTurnEvent(conversationId, turnId, seq(), "log", {
        kind: "meta",
        text: "[e2e-stub] respuesta generada sin LLM real",
        ts: new Date().toISOString(),
      });
      assistantText = `[e2e-stub] Respuesta a: "${userMessage.slice(0, 80)}"`;
    } else if (isFreeChatConv) {
      assistantText = await runFreeChatTurn(
        userMessage,
        priorMessages,
        requestId,
        conversationId,
        turnId,
        seq,
      );
    } else if (mode === "analyze" || mode === "modify") {
      const dashResult = await runDashboardTurn(
        mode,
        conversation,
        userMessage,
        priorMessages,
        requestId,
      );
      assistantText = dashResult.text;
      // Notify SSE clients when a modify turn produced a new dashboard spec.
      if (dashResult.spec) {
        await emitTurnEvent(conversationId, turnId, seq(), "spec_update", {
          spec: dashResult.spec,
          summary: dashResult.summary ?? "",
          prompt: userMessage,
        });
      }
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
    await emitTurnEvent(conversationId, turnId, seq(), "complete", {
      messageId: assistantMsg.id,
    });

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
    await emitTurnEvent(conversationId, turnId, seq(), "error", {
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
      await emitTurnEvent(conversationId, turnId, seq(), "log", {
        kind: "error",
        text: err.message,
        ts: new Date().toISOString(),
      }).catch(() => {});
    }
    throw err;
  }
}

interface DashboardTurnResult {
  text: string;
  /** Set when apply_dashboard_modification tool staged a new spec. */
  spec?: import("@/lib/schema").DashboardSpec;
  summary?: string;
}

async function runDashboardTurn(
  mode: string,
  conversation: ConversationRow,
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
): Promise<DashboardTurnResult> {
  const { sql } = await import("@/lib/db-write");
  // agenticCtx is mutated in-place by tool handlers (modifyResult, analyzeResult).
  const agenticCtx: import("@/lib/llm-tools/types").LlmAgenticContext = {
    requestId,
    endpoint: (mode === "analyze" ? "analyzeDashboard" : "modifyDashboard") as
      | "analyzeDashboard"
      | "modifyDashboard",
    conversationId: conversation.id,
  };

  let currentSpec = "";
  let dashId: number | undefined;
  if (conversation.context_ref) {
    dashId = Number(conversation.context_ref);
    if (Number.isFinite(dashId)) {
      const specRows = await sql<{ spec: unknown }>(
        `SELECT spec FROM dashboards WHERE id = $1`,
        [dashId],
      ).catch(() => [] as { spec: unknown }[]);
      currentSpec = specRows[0]?.spec ? JSON.stringify(specRows[0].spec) : "";
    }
  }

  if (mode === "analyze") {
    const { analyzeDashboard } = await import("@/lib/llm");
    const text = await analyzeDashboard(
      currentSpec,
      userMessage,
      undefined,
      agenticCtx,
      priorMessages,
    );
    return { text };
  } else {
    const { modifyDashboard } = await import("@/lib/llm");
    const text = await modifyDashboard(currentSpec, userMessage, agenticCtx, priorMessages);

    // If the agentic runner called apply_dashboard_modification, persist the new spec.
    if (agenticCtx.modifyResult && dashId !== undefined && Number.isFinite(dashId)) {
      const { spec, summary } = agenticCtx.modifyResult;
      try {
        await sql(`UPDATE dashboards SET spec = $1 WHERE id = $2`, [
          JSON.stringify(spec),
          dashId,
        ]);
        return { text, spec, summary };
      } catch (err) {
        console.error(`[turn-background] spec persist failed for dashboard ${dashId}:`, err);
      }
    }

    return { text };
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
