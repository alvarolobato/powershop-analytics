/**
 * Centralized LLM client — the single seam for all single-shot LLM calls.
 *
 * Single-shot flows (suggest, gap, non-agentic generate/modify/analyze) go through
 * `llmComplete`, which owns provider selection, system-prompt assembly, circuit-breaker,
 * and telemetry. Agentic flows call `runAgenticChat` via llm.ts (also wrapped in
 * `callWithCircuitBreaker`). Sanitization lives in `llm-provider/sanitize.ts`.
 * Tasks 4 (prompt caching) and 5 (multi-turn replay) will extend this file.
 */

import {
  getOpenRouterClient,
  resetOpenRouterClient,
  openRouterChatCompletion,
  buildCachedSystemMessage,
  openRouterExtras,
  extractOpenRouterCost,
  readOpenRouterCacheTokens,
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
  getEffectiveOpenRouterProvider,
} from "./llm-provider/config";
import { createDashboardAgenticAdapter } from "./llm-provider/registry";
import { logUsage } from "./llm-usage";
import { callWithCircuitBreaker } from "./llm-circuit-breaker";
import { assertLlmEnabled } from "./llm-enabled";
import type { DashboardLlmFlow, DashboardLlmProviderId } from "./llm-provider/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Re-exports for callers that previously imported directly from provider modules.
export { resetOpenRouterClient as resetClient };
export { CliRunnerError };
export { formatCliRunnerError, isCliRunnerError };
export type { FormattedCliError };
export { createDashboardAgenticAdapter };
export { buildCachedSystemMessage };

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
  provider: Exclude<DashboardLlmProviderId, "e2e-stub">;
  driver?: string | null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const EMPTY_USAGE: NormalizedUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

/**
 * Thrown when `llmComplete()` is reached with `DASHBOARD_LLM_PROVIDER=e2e-stub`.
 *
 * `e2e-stub` exists to short-circuit turn-background.ts's MAIN turn BEFORE any
 * LLM code runs (see its own `DASHBOARD_LLM_PROVIDER === "e2e-stub"` branch) —
 * it never had a real model behind it. `llmComplete`'s provider dispatch used
 * to have no branch for it at all, so any OTHER caller (e.g. title generation
 * — see `maybeGenerateTitle` in conversations.ts) fell through to the
 * OpenRouter branch and failed with an unrelated "no API key" error instead of
 * a clear, typed one (D-045). `LlmResponse.provider` already excludes
 * `"e2e-stub"` from its type — this makes the runtime match that contract.
 */
export class E2eStubProviderError extends Error {
  constructor(endpoint: string) {
    super(
      `llmComplete() was called under DASHBOARD_LLM_PROVIDER=e2e-stub for endpoint "${endpoint}" — ` +
        "there is no real LLM behind this provider. Callers must skip the call entirely " +
        "(see turn-background.ts's own e2e-stub short-circuit) rather than reach llmComplete.",
    );
    this.name = "E2eStubProviderError";
  }
}

function narrowDashboardLlmFlow(flow: string | undefined): DashboardLlmFlow | undefined {
  if (flow === "generate" || flow === "modify" || flow === "analyze" || flow === "weekly") {
    return flow;
  }
  return undefined;
}

function assembleSystemPrompt(req: LlmRequest): string {
  const { stable, volatile } = req.systemPrompt;
  return volatile ? `${stable}\n\n${volatile}` : stable;
}

/**
 * Flows whose `buildSystemPrompt().stable` is proven independent of
 * per-call `vars` — the only flows allowed to put their `stable` content on
 * the CLI's `--system-prompt` / `--append-system-prompt` flag (see
 * `claudeCliSingleShot`'s `systemPrompt` param and its own doc comment).
 * `lib/__tests__/llm-client-cli-system-prompt-safe.test.ts` asserts the
 * invariant for exactly this set — a flow that starts interpolating vars
 * into `stable` fails that test immediately, before it could ever leak
 * per-call data onto the flag.
 *
 * Audited 2026-08-28 while wiring lean CLI mode
 * (`docs/decisions/D-046-cli-lean-mode-and-kill-switch.md`). Every case in
 * `lib/llm-context/system-prompt.ts`'s `buildSystemPrompt` switch:
 *
 * - `generate`  — stable is a fixed role header + static knowledge; `vars`
 *   is unused. SAFE.
 * - `modify`    — stable never touches `vars.currentSpec` (that travels in
 *   `volatile`, correctly). SAFE.
 * - `chat`      — `buildFreeChatContext()` takes no arguments at all. SAFE.
 * - `title`     — a fixed instruction string; no vars. SAFE.
 * - `summary`   — its own explicit case, returning SUMMARY_PREAMBLE +
 *   buildStableKnowledgePart(); neither takes per-call vars. SAFE.
 *   (This said "falls through to `default`" while that was true; the case was
 *   added later, and the audit is about the mechanism, not just the verdict —
 *   someone adding vars to `summary` on the strength of a stale note is
 *   exactly how per-call data ends up on the cache-anchoring flag.)
 * - `analyze`   — embeds `vars.serializedData` (the dashboard's actual data)
 *   and, when set, `vars.dashboardId`, directly into the single string
 *   returned as `stable` — there is no `volatile` split at all for this
 *   flow. NOT SAFE.
 * - `weekly`    — embeds `vars.queryResults`, `vars.reviewedWeekDescription`
 *   and `vars.generationMode` directly into `stable`, same problem. NOT SAFE.
 * - `suggest`   — embeds `vars.role` and `vars.existingDashboards`. NOT SAFE.
 * - `gap`       — embeds `vars.existingDashboards`. NOT SAFE.
 *
 * The four unsafe flows are not fixed here (splitting them into a genuine
 * stable/volatile shape is real surgery on business-critical prompts —
 * weekly review, dashboard analysis — outside the scope of this change) and
 * are simply excluded from `--system-prompt` routing: their full
 * stable+volatile content keeps going through stdin exactly as it did
 * before lean mode existed (see the CLI branch below). They still benefit
 * from `CLI_LEAN_ARGS` stripping the harness, just not from the CLI's
 * prompt-cache anchoring to a stable domain block.
 */
export const CLI_SYSTEM_PROMPT_SAFE_FLOWS = new Set([
  "generate",
  "modify",
  "chat",
  "title",
  "summary",
]);

/**
 * Build messages for OpenRouter, applying `cache_control: ephemeral` to the
 * stable portion of the system prompt when non-empty. The volatile portion is
 * appended as a separate uncached text block so it does not bust the cache.
 */
function buildMessagesOpenRouter(req: LlmRequest): ChatCompletionMessageParam[] {
  const { stable, volatile } = req.systemPrompt;
  const userMessages = req.messages.map(
    (m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam,
  );
  if (!stable && !volatile) return userMessages;
  if (!stable) {
    return [{ role: "system", content: volatile ?? "" }, ...userMessages];
  }
  const cachedSystemMessage = buildCachedSystemMessage(stable, volatile);
  return [cachedSystemMessage, ...userMessages];
}

/**
 * Build messages for the CLI provider, where caching markers are not supported.
 * The stable + volatile portions are concatenated into a single system prompt.
 */
function buildMessagesPlain(req: LlmRequest): ChatCompletionMessageParam[] {
  const systemContent = assembleSystemPrompt(req);
  const userMessages = req.messages.map(
    (m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam,
  );
  return systemContent
    ? [{ role: "system", content: systemContent }, ...userMessages]
    : userMessages;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Single entry point for all LLM calls in the dashboard.
 *
 * Owns: provider selection, system-prompt assembly, telemetry write,
 * circuit-breaker, and error propagation.
 */
export async function llmComplete(req: LlmRequest): Promise<LlmResponse> {
  // Master kill switch — first thing, before any provider work. See
  // `lib/llm-enabled.ts` and D-046. The agentic path is a separate seam
  // (`assembleRequest`'s agentic branch, which never calls this function).
  assertLlmEnabled();

  const cfg = loadDashboardLlmConfig();
  const dFlow = narrowDashboardLlmFlow(req.flow);
  const model = getEffectiveDashboardModel(cfg, dFlow);
  const openRouterProvider = getEffectiveOpenRouterProvider(cfg, dFlow);
  const meta = {
    provider: cfg.provider,
    driver: cfg.provider === "cli" ? cfg.cliDriver : null,
  } as const;
  const requestId = req.requestId ?? null;
  const endpoint = req.endpoint ?? req.flow;
  const temperature = req.temperature ?? 0.2;
  const maxOutputTokens = req.maxOutputTokens ?? 8192;

  // ── CLI provider ────────────────────────────────────────────────────────────
  if (cfg.provider === "cli") {
    // Safe flows: the stable domain block goes on --system-prompt (see
    // CLI_SYSTEM_PROMPT_SAFE_FLOWS), so it must NOT also appear in stdin —
    // that would double-bill it as tokens for no benefit. stdin then carries
    // only the volatile part (if any) plus the conversation turns.
    // Unsafe flows: unchanged from before lean mode existed — stable +
    // volatile combined into stdin's system section, nothing on the flag.
    const cliSystemPromptSafe = CLI_SYSTEM_PROMPT_SAFE_FLOWS.has(req.flow);
    const cliSystemPrompt = cliSystemPromptSafe ? req.systemPrompt.stable : "";
    const stdinReq: LlmRequest = cliSystemPromptSafe
      ? { ...req, systemPrompt: { stable: "", volatile: req.systemPrompt.volatile } }
      : req;
    const messages = buildMessagesPlain(stdinReq);
    const combined = messages
      .map((m) => {
        const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `## ${m.role}\n${body}`;
      })
      .join("\n\n");

    const { text, usage: cliUsage } = await callWithCircuitBreaker(() =>
      claudeCliSingleShot({ cfg, prompt: combined, systemPrompt: cliSystemPrompt }),
    );

    // Real token counts + the CLI's own `total_cost_usd`, instead of the
    // hard-coded EMPTY_USAGE this used to log for every single CLI call —
    // see `llm-provider/cli/usage.ts` for why the binary is trusted here.
    const usage: NormalizedUsage = cliUsage
      ? {
          prompt_tokens: cliUsage.prompt_tokens,
          completion_tokens: cliUsage.completion_tokens,
          total_tokens: cliUsage.total_tokens,
          cache_creation_input_tokens: cliUsage.cache_creation_input_tokens,
          cache_read_input_tokens: cliUsage.cache_read_input_tokens,
        }
      : { ...EMPTY_USAGE };

    logUsage(endpoint, model, usage, meta, {
      requestId,
      reportedCostUsd: cliUsage?.cost_usd ?? null,
    });

    if (req.onTextDelta && text) {
      try {
        req.onTextDelta(text.length, text.length);
      } catch {
        /* ignore callback errors */
      }
    }

    return {
      text,
      usage,
      provider: "cli",
      driver: cfg.cliDriver,
    };
  }

  // ── e2e-stub provider — no real LLM behind it, see E2eStubProviderError ────
  if (cfg.provider === "e2e-stub") {
    throw new E2eStubProviderError(endpoint);
  }

  // ── Mock provider (e2e LLM-integration tests) ───────────────────────────────
  if (cfg.provider === "mock") {
    const { mockSingleShotText } = await import("./llm-provider/mock/script");
    const text = mockSingleShotText(buildMessagesOpenRouter(req));
    logUsage(endpoint, model, EMPTY_USAGE, meta, { requestId });
    if (req.onTextDelta && text) {
      try {
        req.onTextDelta(text.length, text.length);
      } catch {
        /* ignore callback errors */
      }
    }
    return { text, usage: { ...EMPTY_USAGE }, provider: "mock", driver: null };
  }

  // ── OpenRouter provider ─────────────────────────────────────────────────────
  const client = getOpenRouterClient();
  const messages = buildMessagesOpenRouter(req);

  if (req.onTextDelta) {
    // Streaming path — used by chatTextWithProgress for live progress events.
    // Cast explicitly to Stream<ChatCompletionChunk> so TypeScript knows the
    // for-await loop is valid (the openai overload is lost after wrapping in
    // callWithCircuitBreaker<T> which returns Promise<T> not the overloaded type).
    const stream = await callWithCircuitBreaker(() =>
      client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        stream: true as const,
        ...openRouterExtras(openRouterProvider),
      }),
    ) as import("openai/streaming").Stream<import("openai/resources/chat/completions").ChatCompletionChunk>;

    let textContent = "";
    let totalCharsEmitted = 0;
    let rawUsage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    } | null = null;
    let reportedCostUsd: number | null = null;

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
        // Cast to extended type so Anthropic cache-token fields forwarded by
        // OpenRouter are captured for telemetry and cost estimation.
        const u = chunk.usage as typeof chunk.usage & {
          cache_creation_input_tokens?: number | null;
          cache_read_input_tokens?: number | null;
        };
        rawUsage = {
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens,
          total_tokens: u.total_tokens,
          // OpenRouter reports cache usage under `prompt_tokens_details`, not
          // as the Anthropic-shaped keys — reading only the latter left these
          // null on this path, so a cache hit was estimated as all-fresh
          // (~10x over) whenever the reported cost was unavailable.
          ...readOpenRouterCacheTokens(chunk.usage),
        };
        // OpenRouter's own figure for this call (requested via
        // `usage: { include: true }` in openRouterExtras). Authoritative and
        // model-independent — see extractOpenRouterCost.
        reportedCostUsd = extractOpenRouterCost(chunk.usage);
      }
    }

    const u = rawUsage ?? {};
    const usage: NormalizedUsage = {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: u.cache_read_input_tokens ?? null,
    };

    logUsage(endpoint, model, usage, meta, { requestId, reportedCostUsd });
    return { text: textContent, usage, provider: "openrouter" };
  }

  // Non-streaming path (default).
  const { content, usage: rawUsage, reportedCostUsd: nonStreamCost } = await callWithCircuitBreaker(() =>
    openRouterChatCompletion({
      client,
      model,
      messages,
      temperature,
      maxTokens: maxOutputTokens,
      provider: openRouterProvider,
    }),
  );

  const u = rawUsage ?? {};
  const usage: NormalizedUsage = {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: u.cache_read_input_tokens ?? null,
  };

  logUsage(endpoint, model, usage, meta, { requestId, reportedCostUsd: nonStreamCost });
  return { text: content, usage, provider: "openrouter" };
}
