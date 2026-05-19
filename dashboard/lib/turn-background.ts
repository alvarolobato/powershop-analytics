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
import { loadDashboardLlmConfig, getEffectiveDashboardModel } from "@/lib/llm-provider/config";

// Re-export for use in tests without importing from route
export type { ConversationRow };

// ── Tool arg formatting ────────────────────────────────────────────────────────

function formatToolArgs(toolName: string, argsPreview?: string): string {
  if (!argsPreview) return "";
  // argsPreview may be TRUNCATED JSON (the runner limits preview length),
  // so JSON.parse often throws. Use regex extraction as the primary approach.

  // Helper: extract a named string field from potentially truncated JSON
  function extractField(json: string, key: string): string | null {
    // Matches "key":"value" — value can contain escaped chars
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
    const m = json.match(re);
    if (!m) return null;
    // Unescape JSON string escapes in the extracted value
    return m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\");
  }

  if (toolName === "execute_query" || toolName === "execute_write_query") {
    const sql = extractField(argsPreview, "sql");
    if (sql) return sql.replace(/\s+/g, " ").slice(0, 160);
  }
  if (toolName === "describe_table") {
    const name = extractField(argsPreview, "table_name") ?? extractField(argsPreview, "name");
    if (name) return name;
  }
  // Generic: try first string field
  const firstStr = argsPreview.match(/"[^"]+"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (firstStr) {
    return firstStr[1].replace(/\\"/g, '"').replace(/\\n/g, " ").slice(0, 160);
  }
  return "";
}

// ── Shared agentic progress handler ───────────────────────────────────────────

/**
 * Creates an onAgenticProgress callback that emits SSE events for streaming
 * tokens, extended thinking, and tool progress. Used by both runFreeChatTurn
 * and runDashboardTurn so behaviour is identical across conversation modes.
 */
function makeProgressHandler(
  conversationId: string,
  turnId: string,
  seq: () => number,
  /** When true, token streaming is suppressed (analyze/modify use tool calls for output). */
  suppressTokens = false,
): (event: import("@/lib/llm-tools/types").AgenticProgressEvent) => void {
  let inToolRound = false;

  return (event: import("@/lib/llm-tools/types").AgenticProgressEvent) => {
    if (event.type === "round") {
      inToolRound = false;
    } else if (event.type === "assistant_tools") {
      inToolRound = true;
      // Clear streaming tokens that appeared before we knew this was a tool round.
      // Thinking text is preserved — it remains visible while tools execute.
      if (!suppressTokens) {
        void emitTurnEvent(conversationId, turnId, seq(), "token", { text: "" }).catch(() => {});
      }
      return;
    } else if (event.type === "model_thinking_delta" && event.text) {
      if (!inToolRound) {
        void emitTurnEvent(conversationId, turnId, seq(), "thinking", {
          text: event.text,
        }).catch(() => {});
      }
      return;
    } else if (event.type === "model_text_delta" && event.text) {
      // model_text_delta.text is CUMULATIVE — replace, never append.
      // For dashboard modes (analyze/modify), ALL text deltas are tool-call JSON —
      // suppress them so users don't see raw JSON streaming.
      if (!inToolRound && !suppressTokens) {
        void emitTurnEvent(conversationId, turnId, seq(), "token", {
          text: event.text,
        }).catch(() => {});
      }
      return;
    }

    // Tool progress log lines.
    let logText: string | null = null;
    if (event.type === "tool_start") {
      const args = formatToolArgs(event.name, event.argsPreview);
      logText = `▶ ${event.name}${args ? `: ${args}` : ""}`;
    } else if (event.type === "tool_done") {
      logText = `${event.ok ? "✓" : "✗"} ${event.name} (${event.ms}ms)`;
    }
    if (logText) {
      void emitTurnEvent(conversationId, turnId, seq(), "log", {
        kind: "tool",
        text: logText,
        ts: new Date().toISOString(),
      }).catch(() => {});
    }
  };
}

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

    // Load prior messages first so the context snapshot includes the message count.
    // Must be loaded before appending the current user message.
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

    // Emit context snapshot now that we know how many prior messages exist.
    const contextPayload = buildContextPayload(
      conversation,
      requestId,
      userMessage,
      priorMessages.length,
      priorMessages,
    );
    await emitTurnEvent(conversationId, turnId, seq(), "context", contextPayload);

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
        conversationId,
        turnId,
        seq,
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
    onAgenticProgress: makeProgressHandler(conversationId, turnId, seq),
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
  conversationId: string,
  turnId: string,
  seq: () => number,
): Promise<DashboardTurnResult> {
  const { sql } = await import("@/lib/db-write");
  // agenticCtx is mutated in-place by tool handlers (modifyResult, analyzeResult).
  const agenticCtx: import("@/lib/llm-tools/types").LlmAgenticContext = {
    requestId,
    endpoint: (mode === "analyze" ? "analyzeDashboard" : "modifyDashboard") as
      | "analyzeDashboard"
      | "modifyDashboard",
    conversationId: conversation.id,
    // Wire agentic progress events to SSE. Suppress token streaming for dashboard
    // modes — analyze/modify always end with a tool call (submit_dashboard_analysis
    // or apply_dashboard_modification), never prose, so model_text_delta is JSON.
    onAgenticProgress: makeProgressHandler(conversationId, turnId, seq, true),
    // Callback from analyzeDashboard/modifyDashboard once the system prompt is built.
    // Emits an updated context event so the UI can show the full prompt sent to the LLM.
    onSystemPromptReady: (systemPrompt: string, tools?: Array<{ name: string; schema: Record<string, unknown> }>) => {
      const resolvedModel = resolveModelName();
      const priorPreview = priorMessages.length > 0
        ? priorMessages.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 200) }))
        : undefined;
      void emitTurnEvent(conversationId, turnId, seq(), "context", {
        context: {
          model: resolvedModel,
          provider: conversation.llm_provider ?? "unknown",
          driver: conversation.llm_driver ?? null,
          flow: mode,
          seed_prompt: userMessage,
          prior_messages: priorMessages.length,
          ...(priorPreview && { prior_messages_preview: priorPreview }),
          system_prompt_stable: systemPrompt,
          ...(tools && tools.length > 0 && { tools }),
        },
        requestId,
      }).catch(() => {});
    },
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

function resolveModelName(): string {
  try {
    const cfg = loadDashboardLlmConfig();
    return getEffectiveDashboardModel(cfg);
  } catch {
    return "unknown";
  }
}

function buildContextPayload(
  conversation: ConversationRow,
  requestId: string,
  userMessage?: string,
  priorMessageCount?: number,
  priorMessagesArray?: Array<{ role: string; content: string }>,
): Record<string, unknown> {
  const seed_prompt = userMessage?.trim() || undefined;
  const priorMsgMeta = priorMessageCount !== undefined
    ? { prior_messages: priorMessageCount }
    : undefined;
  const previewMeta = priorMessagesArray && priorMessagesArray.length > 0
    ? {
        prior_messages_preview: priorMessagesArray.slice(-10).map((m) => ({
          role: m.role,
          content: m.content.slice(0, 200),
        })),
      }
    : undefined;

  if (conversation.initial_context) {
    return {
      context: { ...conversation.initial_context, seed_prompt, ...priorMsgMeta, ...previewMeta },
      requestId,
    };
  }
  const resolvedModel = resolveModelName();
  return {
    context: {
      model: resolvedModel,
      provider: conversation.llm_provider ?? "unknown",
      driver: conversation.llm_driver ?? null,
      flow: conversation.mode ?? "chat",
      seed_prompt,
      ...priorMsgMeta,
      ...previewMeta,
    },
    requestId,
  };
}
