/**
 * Centralized LLM client — the single seam for all LLM calls in the dashboard.
 *
 * Every flow (generate, modify, analyze, suggest, gap, review, etc.) goes through
 * `llmComplete`. Provider selection, telemetry, and sanitization are owned here.
 * Tasks 4 (prompt caching) and 5 (multi-turn replay) will extend this file.
 */

import {
  getOpenRouterClient,
  resetOpenRouterClient,
  openRouterChatCompletion,
} from "./llm-provider/openrouter";
import { claudeCliSingleShot } from "./llm-provider/cli/claude-code";
import { CliRunnerError } from "./llm-provider/cli/errors";
import {
  formatCliRunnerError,
  isCliRunnerError,
  type FormattedCliError,
} from "./llm-provider/cli/format-error";
import {
  loadDashboardLlmConfig,
  getEffectiveDashboardModel,
} from "./llm-provider/config";
import { createDashboardAgenticAdapter } from "./llm-provider/registry";
import { logUsage } from "./llm-usage";
import { callWithCircuitBreaker } from "./llm-circuit-breaker";
import type { DashboardLlmFlow } from "./llm-provider/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Re-exports for callers that previously imported directly from provider modules.
export { resetOpenRouterClient as resetClient };
export { CliRunnerError };
export { formatCliRunnerError, isCliRunnerError };
export type { FormattedCliError };
export { createDashboardAgenticAdapter };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Normalized token usage returned by every `llmComplete` call.
 * Cache fields are reserved for Task 4 (prompt caching); they are always
 * `undefined` in Task 3.
 */
export interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Populated by Task 4 when OpenRouter/Anthropic reports cache write tokens. */
  cache_creation_input_tokens?: number | null;
  /** Populated by Task 4 when OpenRouter/Anthropic reports cache read tokens. */
  cache_read_input_tokens?: number | null;
}

export interface LlmRequest {
  /**
   * Logical flow name — used for telemetry, per-flow model selection, and as
   * the default `endpoint` when none is provided.
   */
  flow: "generate" | "modify" | "analyze" | "suggest" | "gap" | "summary" | "weekly" | string;
  /**
   * System prompt split into stable (cache-friendly) and optional volatile
   * (dynamic context). Task 4 will inject `cache_control` on the stable part.
   * For Task 3 they are concatenated with a blank line separator.
   */
  systemPrompt: { stable: string; volatile?: string };
  /** User/assistant conversation history (system message excluded). */
  messages: ChatTurn[];
  /** Tool definitions — reserved for Task 4; unused in `llmComplete` for now. */
  tools?: unknown[];
  /** Max completion tokens (default: 8192). */
  maxOutputTokens?: number;
  /** Sampling temperature (default: 0.2). */
  temperature?: number;
  /** Request correlation id written to `llm_usage`. */
  requestId?: string | null;
  /**
   * Telemetry endpoint label (defaults to `flow` when omitted).
   * Allows the caller to distinguish sub-flows that share the same `flow` key.
   */
  endpoint?: string;
  /**
   * Optional streaming callback. When provided, `llmComplete` streams the
   * OpenRouter response and invokes this callback for each text delta.
   * For the CLI provider a single delta is emitted after completion.
   * `chars` is the incremental delta; `totalChars` is the running total.
   */
  onTextDelta?: (chars: number, totalChars: number) => void;
}

export interface LlmResponse {
  text: string;
  usage: NormalizedUsage;
  provider: "openrouter" | "cli";
  driver?: string | null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const EMPTY_USAGE: NormalizedUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

function assembleSystemPrompt(req: LlmRequest): string {
  const { stable, volatile } = req.systemPrompt;
  return volatile ? `${stable}\n\n${volatile}` : stable;
}

function buildMessages(req: LlmRequest): ChatCompletionMessageParam[] {
  const systemContent = assembleSystemPrompt(req);
  return [
    { role: "system", content: systemContent },
    ...req.messages.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
  ];
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Single entry point for all LLM calls in the dashboard.
 *
 * Owns: provider selection, system-prompt assembly, telemetry write,
 * circuit-breaker, and error propagation.
 */
export async function llmComplete(req: LlmRequest): Promise<LlmResponse> {
  const cfg = loadDashboardLlmConfig();
  const flow = req.flow as DashboardLlmFlow | undefined;
  const model = getEffectiveDashboardModel(cfg, flow);
  const meta = {
    provider: cfg.provider,
    driver: cfg.provider === "cli" ? cfg.cliDriver : null,
  } as const;
  const requestId = req.requestId ?? null;
  const endpoint = req.endpoint ?? req.flow;
  const temperature = req.temperature ?? 0.2;
  const maxOutputTokens = req.maxOutputTokens ?? 8192;

  const messages = buildMessages(req);

  // ── CLI provider ────────────────────────────────────────────────────────────
  if (cfg.provider === "cli") {
    const combined = messages
      .map((m) => {
        const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `## ${m.role}\n${body}`;
      })
      .join("\n\n");

    const text = await callWithCircuitBreaker(() =>
      claudeCliSingleShot({ cfg, prompt: combined }),
    );

    logUsage(endpoint, model, EMPTY_USAGE, meta, { requestId });

    if (req.onTextDelta && text) {
      try {
        req.onTextDelta(text.length, text.length);
      } catch {
        /* ignore callback errors */
      }
    }

    return {
      text,
      usage: { ...EMPTY_USAGE },
      provider: "cli",
      driver: cfg.cliDriver,
    };
  }

  // ── OpenRouter provider ─────────────────────────────────────────────────────
  const client = getOpenRouterClient();

  if (req.onTextDelta) {
    // Streaming path — used by chatTextWithProgress for live progress events.
    const stream = await callWithCircuitBreaker(() =>
      client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        stream: true,
      }),
    );

    let textContent = "";
    let totalCharsEmitted = 0;
    let rawUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        textContent += delta;
        const deltaChars = delta.length;
        totalCharsEmitted += deltaChars;
        try {
          req.onTextDelta(deltaChars, totalCharsEmitted);
        } catch {
          /* ignore callback errors */
        }
      }
      if (chunk.usage) {
        rawUsage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }
    }

    const u = rawUsage ?? {};
    const usage: NormalizedUsage = {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    };

    logUsage(endpoint, model, usage, meta, { requestId });
    return { text: textContent, usage, provider: "openrouter" };
  }

  // Non-streaming path (default).
  const { content, usage: rawUsage } = await callWithCircuitBreaker(() =>
    openRouterChatCompletion({
      client,
      model,
      messages,
      temperature,
      maxTokens: maxOutputTokens,
    }),
  );

  const u = rawUsage ?? {};
  const usage: NormalizedUsage = {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
  };

  logUsage(endpoint, model, usage, meta, { requestId });
  return { text: content, usage, provider: "openrouter" };
}
