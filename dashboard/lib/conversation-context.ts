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
    tools: freeChatCtx.tools.map((t) => ({
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
  const COLUMN_MAP = {
    modify: "chat_messages_modify",
    analyze: "chat_messages_analyze",
  } as const;
  const column = COLUMN_MAP[channel];

  let rows: { messages: unknown }[];
  try {
    rows = await sql<{ messages: unknown }>(
      `SELECT ${column} AS messages FROM dashboards WHERE id = $1`,
      [dashboardId],
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

  if (!rows.length || !rows[0].messages) return [];
  const raw = rows[0].messages;
  if (!Array.isArray(raw)) return [];

  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.role !== "string" || typeof m.content !== "string") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    turns.push({ role: m.role as "user" | "assistant", content: m.content as string });
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
