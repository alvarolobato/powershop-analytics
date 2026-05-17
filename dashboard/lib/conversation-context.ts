/**
 * Multi-turn conversation context for modify, analyze, and free-chat flows.
 *
 * Loads prior chat turns from the DB and, when the stored history exceeds the
 * turn cap, lazily summarises older turns into a single synthetic assistant
 * message so the LLM receives a bounded context window.
 *
 * Also builds the system prompt and tool catalog for free-chat conversations
 * (`context_kind='global'`) via `buildFreeChatContext()`.
 */

import { sql } from "@/lib/db-write";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { FREE_CHAT_TOOLS } from "@/lib/llm-tools/catalog";
import { getAgenticConfig } from "@/lib/llm-tools/config";
import { buildStableKnowledgePart } from "@/lib/prompts";
import { loadDashboardLlmConfig, getEffectiveDashboardModel, getEffectiveOpenRouterProvider } from "@/lib/llm-provider/config";
import { getOpenRouterClient, openRouterChatCompletion } from "@/lib/llm-provider/openrouter";
import { claudeCliSingleShot } from "@/lib/llm-provider/cli/claude-code";
import { callWithCircuitBreaker } from "@/lib/llm-circuit-breaker";
import { logUsage } from "@/lib/llm-usage";
import type { InitialContext } from "@/lib/conversation-types";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface FreeChatContext {
  systemPrompt: { stable: string };
  tools: ChatCompletionTool[];
}

const FREE_CHAT_PREAMBLE =
  "Eres un asistente analítico de PowerShop Analytics. " +
  "Tienes acceso a herramientas para inspeccionar el modelo de datos, ejecutar consultas de solo lectura y explorar dashboards guardados. " +
  "Cuando el usuario pida crear un dashboard, usa la herramienta `start_dashboard_generation`. " +
  "En tu primera respuesta de cada conversación nueva, llama a la herramienta `set_title` con un título conciso de 5-7 palabras en español que resuma el tema.\n\n";

/**
 * Build the system prompt and tool catalog for a free-chat conversation
 * (context_kind='global'). Returns the stable knowledge bundle prefixed with
 * a Spanish preamble plus the FREE_CHAT_TOOLS catalog.
 */
export function buildFreeChatContext(): FreeChatContext {
  return {
    systemPrompt: { stable: FREE_CHAT_PREAMBLE + buildStableKnowledgePart() },
    tools: FREE_CHAT_TOOLS,
  };
}

/**
 * Build the InitialContext snapshot for a free-chat conversation. Called at
 * creation time (POST /api/conversations) and as a fallback on the first user
 * message (POST /api/conversations/:id/messages) so both paths stay in sync.
 */
export function buildFreeChatInitialContextSnapshot(): InitialContext {
  const freeChatCtx = buildFreeChatContext();
  const cfg = loadDashboardLlmConfig();
  const agenticCfg = getAgenticConfig();
  return {
    model: getEffectiveDashboardModel(cfg),
    provider: cfg.provider,
    driver: cfg.provider === "cli" ? cfg.cliDriver : null,
    system_prompt_stable: freeChatCtx.systemPrompt.stable,
    tools: freeChatCtx.tools
      .filter((t): t is Extract<ChatCompletionTool, { type: "function" }> => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        schema: t.function as unknown as Record<string, unknown>,
      })),
    config: {
      flow: "chat",
      tool_rounds_max: agenticCfg.maxToolRounds,
      tool_calls_max: agenticCfg.maxToolCalls,
      tool_timeout_ms: agenticCfg.toolTimeoutMs,
    },
  };
}

const DEFAULT_MAX_TURNS = 10;

/**
 * Load prior conversation turns for a dashboard from the DB.
 * Returns at most `maxTurns` turns. When more than `maxTurns` turns are stored
 * the older ones are summarised into a single synthetic assistant message (lazy,
 * only invoked when the cap is exceeded). Returns [] when the dashboard has no
 * saved messages.
 */
export async function loadPriorTurns(
  dashboardId: number,
  channel: "modify" | "analyze",
  maxTurns = DEFAULT_MAX_TURNS,
): Promise<ChatTurn[]> {
  // Reads from conversation_messages — the single source of truth.
  // Previously read from dashboard.chat_messages_{modify,analyze} columns
  // which have been removed.
  // Two-step query: (1) find the single most-recent non-archived conversation
  // for this dashboard+mode so we don't mix turns from multiple conversations;
  // (2) fetch the LAST N messages of that conversation ordered newest-first,
  // then reverse so the LLM receives them chronologically.
  // Copilot review: the previous single JOIN with ORDER BY c.last_interaction_at DESC
  // could pull messages from multiple conversations and returned the OLDEST turns
  // (ASC + LIMIT) instead of the most-recent ones.
  let rows: { role: string; content: unknown }[];
  try {
    rows = await sql<{ role: string; content: unknown }>(
      `WITH latest_conv AS (
         SELECT id
           FROM conversations
          WHERE context_kind = 'dashboard'
            AND context_ref  = $1
            AND mode         = $2
            AND archived_at IS NULL
          ORDER BY last_interaction_at DESC
          LIMIT 1
       ),
       recent_msgs AS (
         SELECT cm.role, cm.content, cm.created_at
           FROM conversation_messages cm
           JOIN latest_conv lc ON cm.conversation_id = lc.id
          ORDER BY cm.created_at DESC
          LIMIT $3
       )
       SELECT role, content FROM recent_msgs ORDER BY created_at ASC`,
      [String(dashboardId), channel, maxTurns * 2 + 10],
    );
  } catch (e) {
    console.error(
      "[conversation-context] loadPriorTurns DB error (id=%s, channel=%s):",
      dashboardId,
      channel,
      e,
    );
    return [];
  }

  const turns: ChatTurn[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const c = row.content;
    let text: string;
    if (typeof c === "string") {
      text = c;
    } else if (c !== null && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
      text = (c as Record<string, unknown>).text as string;
    } else {
      text = JSON.stringify(c);
    }
    turns.push({ role: row.role as "user" | "assistant", content: text });
  }

  if (turns.length <= maxTurns) return turns;

  return summariseOldTurns(turns, maxTurns, channel);
}

/**
 * When turns > maxTurns, summarise older turns into one synthetic assistant
 * message via a small LLM call and return an array of length <= maxTurns.
 * The summary is prepended as an assistant message followed by the (maxTurns-1)
 * most recent turns.
 */
export async function summariseOldTurns(
  turns: ChatTurn[],
  maxTurns: number,
  channel: "modify" | "analyze" = "modify",
): Promise<ChatTurn[]> {
  if (turns.length <= maxTurns) return turns;
  if (maxTurns < 2) return maxTurns <= 0 ? [] : turns.slice(-1);

  const recentCount = maxTurns - 1;
  const oldTurns = turns.slice(0, turns.length - recentCount);
  const recentTurns = turns.slice(turns.length - recentCount);

  const summary = await buildSummary(oldTurns, channel);
  return [
    {
      role: "assistant",
      content: `Earlier in this conversation the user requested: ${summary}`,
    },
    ...recentTurns,
  ];
}

async function buildSummary(
  turns: ChatTurn[],
  channel: "modify" | "analyze",
): Promise<string> {
  const userPrompts = turns
    .filter((t) => t.role === "user")
    .map((t) => `- ${t.content.slice(0, 200)}`)
    .join("\n");

  const prompt = `Summarise the following prior user requests in a short bulleted list (one line each, max 300 chars total). Respond with only the bullet list, no preamble.\n\n${userPrompts}`;

  const cfg = loadDashboardLlmConfig();
  const model = getEffectiveDashboardModel(cfg, channel);
  const provider = getEffectiveOpenRouterProvider(cfg, channel);

  if (cfg.provider === "cli") {
    try {
      return await callWithCircuitBreaker(() =>
        claudeCliSingleShot({ cfg, prompt }),
      );
    } catch {
      return userPrompts;
    }
  }

  try {
    const client = getOpenRouterClient();
    const { content, usage } = await callWithCircuitBreaker(() =>
      openRouterChatCompletion({
        client,
        model,
        messages: [{ role: "user" as const, content: prompt }],
        temperature: 0.1,
        maxTokens: 200,
        provider,
      }),
    );
    if (usage) {
      logUsage(`dashboard/${channel}/summarise`, model, {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      });
    }
    return content || userPrompts;
  } catch {
    return userPrompts;
  }
}
