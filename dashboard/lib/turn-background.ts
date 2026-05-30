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
import { flattenStoredMessage } from "@/lib/llm-context/history";
import type { AgenticToolCallRecord } from "@/lib/llm-tools/types";
import type { AssistantMessageContent, ToolCallRecord } from "@/lib/conversation-types";

// Re-export for use in tests without importing from route
export type { ConversationRow };

// ── Tool-call persistence ──────────────────────────────────────────────────────

/** Best-effort parse of a raw JSON arguments string into an object for storage. */
function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}

/** Map runner-captured tool calls to the persisted conversation_messages shape. */
function toDbToolCalls(calls: AgenticToolCallRecord[] | undefined): ToolCallRecord[] {
  return (calls ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    arguments: parseToolArgs(c.arguments),
    result: c.result,
    success: c.ok,
    duration_ms: c.ms,
  }));
}

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

// ── System-prompt capture handler ──────────────────────────────────────────────

/**
 * Creates an `onSystemPromptReady` callback that emits a "context" turn event
 * carrying the EXACT system prompt + tools sent to the LLM. assembleRequest()
 * invokes this once it has assembled the request (before the first LLM call),
 * so the conversation UI can show "Contexto original" live AND on resume (the
 * event is persisted in turn_events and replayed by the stream route).
 *
 * Wired for every conversation mode (free-chat, analyze/modify, generic) so the
 * full context is captured uniformly — see D-036.
 */
function makeSystemPromptReadyHandler(
  conversation: ConversationRow,
  mode: string,
  userMessage: string,
  priorMessages: Array<{ role: string; content: string }>,
  requestId: string,
  conversationId: string,
  turnId: string,
  seq: () => number,
): (
  systemPrompt: string,
  tools?: Array<{ name: string; schema: Record<string, unknown> }>,
) => void {
  return (systemPrompt, tools) => {
    const priorPreview = buildPriorPreview(priorMessages);
    void emitTurnEvent(conversationId, turnId, seq(), "context", {
      context: {
        model: resolveModelName(),
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
    // Flatten to history lines — assistant turns carry their tool calls folded in
    // as a compact block so tool results stay in context across turns.
    const priorMessages = prior
      .map((m) => flattenStoredMessage(m))
      .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null);

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
    // Tool calls the model made this turn — persisted on the assistant message so
    // later turns retain the tool context (which query ran, with what result).
    let assistantToolCalls: AgenticToolCallRecord[] = [];
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
      const res = await runFreeChatTurn(
        conversation,
        userMessage,
        priorMessages,
        requestId,
        conversationId,
        turnId,
        seq,
      );
      assistantText = res.text;
      assistantToolCalls = res.toolCalls;
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
      assistantToolCalls = dashResult.toolCalls;
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
      const res = await runGenericTurn(
        conversation,
        userMessage,
        priorMessages,
        requestId,
        conversationId,
        turnId,
        seq,
      );
      assistantText = res.text;
      assistantToolCalls = res.toolCalls;
    }

    // Persist final assistant message to conversation_messages — including the
    // tool calls made this turn so later turns retain the tool context.
    const assistantContent: AssistantMessageContent = { text: assistantText };
    const dbToolCalls = toDbToolCalls(assistantToolCalls);
    if (dbToolCalls.length > 0) assistantContent.tool_calls = dbToolCalls;
    const assistantMsg = await appendMessage(
      conversationId,
      "assistant",
      assistantContent,
    );
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

/** Text reply plus any tool calls the model made, for persistence. */
interface TurnReply {
  text: string;
  toolCalls: AgenticToolCallRecord[];
}

async function runFreeChatTurn(
  conversation: ConversationRow,
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
  conversationId: string,
  turnId: string,
  seq: () => number,
): Promise<TurnReply> {
  const { assembleRequest } = await import("@/lib/llm-context");
  const { AgenticRunnerError } = await import("@/lib/llm-tools/runner");

  const agenticCtx: import("@/lib/llm-tools/types").LlmAgenticContext = {
    requestId,
    endpoint: "freeChat" as const,
    conversationId,
    onAgenticProgress: makeProgressHandler(conversationId, turnId, seq),
    // Emit the exact prompt + tools sent to the LLM as a "context" turn event.
    onSystemPromptReady: makeSystemPromptReadyHandler(
      conversation,
      "chat",
      userMessage,
      priorMessages,
      requestId,
      conversationId,
      turnId,
      seq,
    ),
  };

  try {
    const result = await assembleRequest(
      "chat",
      {},
      null,
      userMessage,
      {
        ctx: agenticCtx,
        priorMessages,
        requestId,
        endpoint: "freeChat",
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    );
    return { text: result.text, toolCalls: agenticCtx.toolCalls ?? [] };
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
  /** Tool calls the model made this turn (execute_query, describe_table, …). */
  toolCalls: AgenticToolCallRecord[];
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
    // Emit the exact prompt + tools sent to the LLM as a "context" turn event so
    // the UI can show the full context live and on resume.
    onSystemPromptReady: makeSystemPromptReadyHandler(
      conversation,
      mode,
      userMessage,
      priorMessages,
      requestId,
      conversation.id,
      turnId,
      seq,
    ),
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
    return { text, toolCalls: agenticCtx.toolCalls ?? [] };
  } else {
    const { modifyDashboard } = await import("@/lib/llm");
    const text = await modifyDashboard(currentSpec, userMessage, agenticCtx, priorMessages);
    const toolCalls = agenticCtx.toolCalls ?? [];

    // If the agentic runner called apply_dashboard_modification, persist the new spec.
    if (agenticCtx.modifyResult && dashId !== undefined && Number.isFinite(dashId)) {
      const { spec, summary } = agenticCtx.modifyResult;
      try {
        await sql(`UPDATE dashboards SET spec = $1 WHERE id = $2`, [
          JSON.stringify(spec),
          dashId,
        ]);
        return { text, toolCalls, spec, summary };
      } catch (err) {
        console.error(`[turn-background] spec persist failed for dashboard ${dashId}:`, err);
      }
    }

    return { text, toolCalls };
  }
}

async function runGenericTurn(
  conversation: ConversationRow,
  userMessage: string,
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>,
  requestId: string,
  conversationId: string,
  turnId: string,
  seq: () => number,
): Promise<TurnReply> {
  const { assembleRequest } = await import("@/lib/llm-context");
  const flowRaw = conversation.mode ?? "chat";
  // agenticCtx is captured so we can read back any tool calls after the run.
  const agenticCtx: import("@/lib/llm-tools/types").LlmAgenticContext = {
    requestId,
    endpoint: flowRaw,
    conversationId,
    // Capture the exact prompt sent to the LLM as a "context" turn event.
    onSystemPromptReady: makeSystemPromptReadyHandler(
      conversation,
      flowRaw,
      userMessage,
      priorMessages,
      requestId,
      conversationId,
      turnId,
      seq,
    ),
  };
  const result = await assembleRequest(
    flowRaw,
    {},
    null,
    userMessage,
    {
      priorMessages,
      requestId,
      endpoint: flowRaw,
      ctx: agenticCtx,
    },
  );
  return { text: result.text, toolCalls: agenticCtx.toolCalls ?? [] };
}

// ── Context snapshot builder ───────────────────────────────────────────────────

function buildPriorPreview(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> | undefined {
  if (messages.length === 0) return undefined;
  return messages.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 200) }));
}

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
  const preview = priorMessagesArray ? buildPriorPreview(priorMessagesArray) : undefined;
  const previewMeta = preview ? { prior_messages_preview: preview } : undefined;

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
