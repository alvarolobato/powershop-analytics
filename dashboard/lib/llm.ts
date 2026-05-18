/**
 * Dashboard LLM entry points: thin wrappers around llm-client.ts.
 *
 * Single-shot paths delegate to `llmComplete` (which owns provider selection,
 * telemetry, and circuit-breaker). Agentic paths call `runAgenticChat` directly,
 * wrapped in `callWithCircuitBreaker`, and write telemetry here.
 * This file owns prompt construction and public API contracts only.
 */

import {
  buildGeneratePrompt,
  buildModifyPrompt,
  buildAgenticToolPreamble,
  buildGeneratePromptSplit,
  buildModifyPromptSplit,
} from "./prompts";
import { buildSuggestPrompt, buildGapAnalysisPrompt } from "./creation-prompts";
import { buildAnalyzePrompt, buildSuggestionPrompt } from "./analyze-prompts";
import { ReviewLlmOutputSchema, type ReviewLlmOutput } from "./review-schema";
import { logUsage, checkDailyBudget } from "./llm-usage";
import {
  loadDashboardLlmConfig,
  getEffectiveDashboardModel,
  getEffectiveOpenRouterProvider,
} from "./llm-provider/config";
import type { DashboardLlmConfig, DashboardLlmFlow } from "./llm-provider/types";
import { isAgenticToolsEnabled, getAgenticConfig } from "./llm-tools/config";
import { runAgenticChat, AgenticRunnerError } from "./llm-tools/runner";
import { callWithCircuitBreaker } from "./llm-circuit-breaker";
import type { LlmAgenticContext, AgenticProgressEvent } from "./llm-tools/types";
import {
  llmComplete,
  createDashboardAgenticAdapter,
  resetClient,
  buildCachedSystemMessage,
} from "./llm-client";
import type { ChatTurn } from "./llm-client";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export { BudgetExceededError } from "./llm-usage";
export { CircuitBreakerOpenError } from "./llm-circuit-breaker";
export { AgenticRunnerError };
export type { LlmAgenticContext, AgenticProgressEvent } from "./llm-tools/types";
export { resetClient };

// ── Internal helpers ──────────────────────────────────────────────────────────

function usageMetaFromCfg(cfg: DashboardLlmConfig) {
  return {
    provider: cfg.provider,
    driver: cfg.provider === "cli" ? cfg.cliDriver : null,
  };
}

function attachTelemetry(ctx: LlmAgenticContext, cfg: DashboardLlmConfig): LlmAgenticContext {
  // MUST mutate ctx in place, not return a clone. The agentic tool handlers
  // write the staged result back to ctx (ctx.analyzeResult, ctx.modifyResult,
  // ctx.reviewResult — see lib/llm-tools/handlers/dashboards.ts), and the
  // route reads those fields AFTER the call completes. If we returned a
  // shallow-clone here, the handlers would write into the clone and the
  // route would read null from the original — which is exactly the bug that
  // surfaced as "El modelo no publicó el análisis" even when the log shows
  // submit_dashboard_analysis was called.
  ctx.llmProvider = cfg.provider;
  ctx.llmDriver = cfg.provider === "cli" ? cfg.cliDriver : null;
  return ctx;
}

type ChatLikeMessage = { role: string; content?: unknown };

function extractSystem(messages: ReadonlyArray<ChatLikeMessage>): string {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string"
    ? sys.content
    : sys.content == null
      ? ""
      : JSON.stringify(sys.content);
}

function extractUserMsgs(messages: ReadonlyArray<ChatLikeMessage>): ChatTurn[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : m.content == null
            ? ""
            : JSON.stringify(m.content),
    }));
}

/**
 * Single-shot text completion delegating to llmComplete.
 * Internal — used by the non-agentic paths in the public functions below.
 */
async function chatText(
  messages: ReadonlyArray<ChatLikeMessage>,
  temperature: number,
  maxTokens: number,
  endpoint: string,
  requestId?: string | null,
  flow?: DashboardLlmFlow,
): Promise<string> {
  const resp = await llmComplete({
    flow: flow ?? endpoint,
    systemPrompt: { stable: extractSystem(messages) },
    messages: extractUserMsgs(messages),
    temperature,
    maxOutputTokens: maxTokens,
    requestId: requestId ?? null,
    endpoint,
  });
  return resp.text;
}

/**
 * Single-shot text completion with streaming progress events via ctx.
 * Emits `model_step_start` before the call and `model_text_delta` per chunk.
 */
async function chatTextWithProgress(
  messages: ReadonlyArray<ChatLikeMessage>,
  temperature: number,
  maxTokens: number,
  endpoint: string,
  ctx: LlmAgenticContext,
  flow?: DashboardLlmFlow,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();

  if (ctx.onAgenticProgress) {
    try {
      ctx.onAgenticProgress({
        type: "model_step_start",
        round: 1,
        provider: ctx.llmProvider ?? cfg.provider,
        driver: ctx.llmDriver ?? (cfg.provider === "cli" ? cfg.cliDriver : null),
      });
    } catch {
      /* ignore */
    }
  }

  const resp = await llmComplete({
    flow: flow ?? endpoint,
    systemPrompt: { stable: extractSystem(messages) },
    messages: extractUserMsgs(messages),
    temperature,
    maxOutputTokens: maxTokens,
    requestId: ctx.requestId ?? null,
    endpoint,
    onTextDelta: (chars, totalChars) => {
      if (ctx.onAgenticProgress) {
        try {
          ctx.onAgenticProgress({
            type: "model_text_delta",
            round: 1,
            chars,
            totalChars,
          });
        } catch {
          /* ignore */
        }
      }
    },
  });

  return resp.text;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a new dashboard from a user prompt (in Spanish).
 *
 * Returns the raw LLM response text, which should be a JSON dashboard spec.
 */
export async function generateDashboard(
  userPrompt: string,
  ctx?: LlmAgenticContext,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    ctx ?? { requestId: "req_local", endpoint: "generateDashboard" },
    cfg,
  );

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg, "generate");
    const openRouterProvider = getEffectiveOpenRouterProvider(cfg, "generate");
    const agenticPreamble = buildAgenticToolPreamble();
    const promptSplit = buildGeneratePromptSplit();
    const stableWithPreamble = `${promptSplit.stable}\n\n${agenticPreamble}`;
    const cachedMsg =
      cfg.provider === "openrouter"
        ? buildCachedSystemMessage(stableWithPreamble, promptSplit.volatile)
        : undefined;
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        openRouterProvider,
        systemPrompt: stableWithPreamble,
        cachedSystemMessage: cachedMsg,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.2,
        maxTokens: 8192,
      }),
    );
    void logUsage("generateDashboard", model, usage, usageMetaFromCfg(cfg), {
      requestId: requestCtx.requestId,
    });
    return content;
  }

  if (cfg.provider === "openrouter") {
    // Use the stable/volatile split so llm-client.ts can apply
    // cache_control to the stable prefix via buildCachedSystemMessage.
    const promptSplit = buildGeneratePromptSplit();
    const resp = await llmComplete({
      flow: "generate",
      systemPrompt: { stable: promptSplit.stable, volatile: promptSplit.volatile },
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
      maxOutputTokens: 8192,
      requestId: requestCtx.requestId,
      endpoint: "generateDashboard",
    });
    return resp.text;
  }

  const systemPrompt = buildGeneratePrompt();
  return chatText(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    0.2,
    8192,
    "generateDashboard",
    requestCtx.requestId,
    "generate",
  );
}

/**
 * Modify an existing dashboard based on a user prompt (in Spanish).
 *
 * Returns the raw LLM response text, which should be the full updated JSON spec.
 */
export async function modifyDashboard(
  currentSpec: string,
  userPrompt: string,
  ctx?: LlmAgenticContext,
  priorTurns?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    ctx ?? { requestId: "req_local", endpoint: "modifyDashboard" },
    cfg,
  );

  await checkDailyBudget();

  const priorMessages: ChatCompletionMessageParam[] = (priorTurns ?? []).map(
    (t) => ({ role: t.role, content: t.content }),
  );

  if (isAgenticToolsEnabled()) {
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg, "modify");
    const openRouterProvider = getEffectiveOpenRouterProvider(cfg, "modify");
    const agenticPreamble = buildAgenticToolPreamble();
    const promptSplit = buildModifyPromptSplit(currentSpec, true);
    const stableWithPreamble = `${promptSplit.stable}\n\n${agenticPreamble}`;
    ctx?.onSystemPromptReady?.(`${stableWithPreamble}\n\n${promptSplit.volatile}`);
    const cachedMsg =
      cfg.provider === "openrouter"
        ? buildCachedSystemMessage(stableWithPreamble, promptSplit.volatile)
        : undefined;
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        openRouterProvider,
        systemPrompt: `${promptSplit.stable}\n\n${agenticPreamble}\n\n${promptSplit.volatile}`,
        cachedSystemMessage: cachedMsg,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.2,
        maxTokens: 8192,
        priorMessages,
      }),
    );
    void logUsage("modifyDashboard", model, usage, usageMetaFromCfg(cfg), {
      requestId: requestCtx.requestId,
    });
    return content;
  }

  // Non-agentic path: use legacy prompt (no publish-tool instructions).
  if (cfg.provider === "openrouter") {
    // Use the stable/volatile split so llm-client.ts can apply
    // cache_control to the stable prefix via buildCachedSystemMessage.
    const promptSplit = buildModifyPromptSplit(currentSpec, false);
    const resp = await llmComplete({
      flow: "modify",
      systemPrompt: { stable: promptSplit.stable, volatile: promptSplit.volatile },
      messages: [
        ...(priorTurns ?? []).map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      maxOutputTokens: 8192,
      requestId: requestCtx.requestId,
      endpoint: "modifyDashboard",
    });
    return resp.text;
  }

  const systemPrompt = buildModifyPrompt(currentSpec, false);
  return chatText(
    [
      { role: "system", content: systemPrompt },
      ...priorMessages,
      { role: "user", content: userPrompt },
    ],
    0.2,
    8192,
    "modifyDashboard",
    requestCtx.requestId,
    "modify",
  );
}

/**
 * Suggest dashboards for a given role, avoiding overlap with existing ones.
 *
 * Returns raw JSON string: array of {name, description, prompt}.
 */
export async function suggestDashboards(
  role: string,
  existingDashboards: { title: string; description: string }[],
  opts?: { requestId?: string },
): Promise<string> {
  const systemPrompt = buildSuggestPrompt(role, existingDashboards);

  await checkDailyBudget();

  const content = await chatText(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Sugiere 3-4 dashboards útiles para el rol: ${role}`,
      },
    ],
    0.2,
    8192,
    "suggestDashboards",
    opts?.requestId ?? null,
  );

  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
}

/**
 * Analyze coverage gaps in the existing set of dashboards.
 *
 * Returns raw JSON string: array of {area, description, suggestedPrompt}.
 */
export async function analyzeGaps(
  existingDashboards: {
    title: string;
    description: string;
    widgetTitles: string[];
  }[],
  opts?: { requestId?: string },
): Promise<string> {
  const systemPrompt = buildGapAnalysisPrompt(existingDashboards);

  await checkDailyBudget();

  const content = await chatText(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Analiza los dashboards existentes e identifica las áreas de negocio importantes que no están cubiertas.",
      },
    ],
    0.2,
    8192,
    "analyzeGaps",
    opts?.requestId ?? null,
  );

  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
}

/**
 * Analyze dashboard data in response to a user question (in Spanish).
 *
 * Returns the raw LLM response text, which will be markdown-formatted analysis.
 */
export async function analyzeDashboard(
  serializedData: string,
  userPrompt: string,
  action?: string,
  ctx?: LlmAgenticContext,
  priorTurns?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    ctx ?? { requestId: "req_local", endpoint: "analyzeDashboard" },
    cfg,
  );

  await checkDailyBudget();

  const priorMessages: ChatCompletionMessageParam[] = (priorTurns ?? []).map(
    (t) => ({ role: t.role, content: t.content }),
  );

  if (isAgenticToolsEnabled()) {
    const systemPrompt = `${buildAnalyzePrompt(serializedData, action, {
      dashboardId: requestCtx.dashboardId,
      agenticMode: true,
    })}\n\n${buildAgenticToolPreamble()}`;
    ctx?.onSystemPromptReady?.(systemPrompt);
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg, "analyze");
    const openRouterProvider = getEffectiveOpenRouterProvider(cfg, "analyze");
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        openRouterProvider,
        systemPrompt,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.3,
        maxTokens: 4096,
        priorMessages,
      }),
    );
    void logUsage("analyzeDashboard", model, usage, usageMetaFromCfg(cfg), {
      requestId: requestCtx.requestId,
    });
    return content;
  }

  // Non-agentic path: use legacy prompt (no publish-tool instructions).
  const systemPrompt = buildAnalyzePrompt(serializedData, action, {
    dashboardId: requestCtx.dashboardId,
    agenticMode: false,
  });

  return chatText(
    [
      { role: "system", content: systemPrompt },
      ...priorMessages,
      { role: "user", content: userPrompt },
    ],
    0.3,
    4096,
    "analyzeDashboard",
    requestCtx.requestId,
    "analyze",
  );
}

/**
 * Generate a weekly business review using the agentic runner so that the
 * `submit_weekly_review` tool is reachable.
 */
export async function generateReviewAgentic(
  systemPrompt: string,
  opts?: { requestId?: string; onAgenticProgress?: (ev: AgenticProgressEvent) => void },
): Promise<{ content: ReviewLlmOutput; message: string }> {
  const requestId = opts?.requestId ?? "req_local";

  await checkDailyBudget();

  const cfg = loadDashboardLlmConfig();
  const ctx: LlmAgenticContext = attachTelemetry(
    {
      requestId,
      endpoint: "generateReview",
      onAgenticProgress: opts?.onAgenticProgress,
      reviewResult: null,
    },
    cfg,
  );

  const adapter = createDashboardAgenticAdapter();
  const model = getEffectiveDashboardModel(cfg, "weekly");
  const openRouterProvider = getEffectiveOpenRouterProvider(cfg, "weekly");

  const { content: finalMessage, usage } = await callWithCircuitBreaker(() =>
    runAgenticChat({
      adapter,
      model,
      openRouterProvider,
      systemPrompt,
      userContent: "Genera la revisión semanal ahora.",
      ctx,
      temperature: 0.2,
      maxTokens: 4096,
    }),
  );

  void logUsage("generateReview", model, usage, usageMetaFromCfg(cfg), { requestId });

  if (!ctx.reviewResult) {
    const agenticCfg = getAgenticConfig();
    throw new AgenticRunnerError(
      "AGENTIC_RUNNER",
      "El modelo no llamó a `submit_weekly_review`. El JSON de la revisión debe enviarse a través de la herramienta.",
      requestId,
      {
        phase: "final",
        toolRoundsUsed: 0,
        toolCallsUsed: 0,
        durationMs: 0,
        limitsAtFailure: {
          maxRounds: agenticCfg.maxToolRounds,
          maxToolCalls: agenticCfg.maxToolCalls,
          toolTimeoutMs: agenticCfg.toolTimeoutMs,
          executeRowLimit: agenticCfg.maxRows,
          payloadCharLimit: agenticCfg.maxResultChars,
        },
      },
    );
  }

  return { content: ctx.reviewResult.content, message: finalMessage };
}

/**
 * Generate a weekly business review with optional agentic progress callbacks.
 */
export async function generateReviewWithProgress(
  systemPrompt: string,
  opts?: { requestId?: string; onAgenticProgress?: (ev: AgenticProgressEvent) => void },
): Promise<{ content: ReviewLlmOutput; message: string }> {
  const requestId = opts?.requestId ?? "req_local";

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    return generateReviewAgentic(systemPrompt, opts);
  }

  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    {
      requestId,
      endpoint: "generateReview",
      onAgenticProgress: opts?.onAgenticProgress,
    },
    cfg,
  );

  const rawContent = await chatTextWithProgress(
    [{ role: "system", content: systemPrompt }],
    0.2,
    4096,
    "generateReview",
    requestCtx,
    "weekly",
  );

  const fenced = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : rawContent.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for review. Raw response: ${rawContent.slice(0, 500)}`,
    );
  }

  const z = ReviewLlmOutputSchema.safeParse(parsed);
  if (!z.success) {
    throw new Error(
      `LLM returned JSON that does not match ReviewLlmOutputSchema: ${z.error.message}`,
    );
  }
  return { content: z.data, message: "" };
}

/**
 * Generate a weekly business review from query results (in Spanish).
 */
export async function generateReview(
  systemPrompt: string,
  opts?: { requestId?: string },
): Promise<{ content: ReviewLlmOutput; message: string }> {
  const requestId = opts?.requestId ?? "req_local";

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    return generateReviewAgentic(systemPrompt, { requestId });
  }

  const rawContent = await chatText(
    [{ role: "system", content: systemPrompt }],
    0.2,
    4096,
    "generateReview",
    requestId,
  );

  const fenced = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : rawContent.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for review. Raw response: ${rawContent.slice(0, 500)}`,
    );
  }

  const z = ReviewLlmOutputSchema.safeParse(parsed);
  if (!z.success) {
    throw new Error(
      `LLM returned JSON that does not match ReviewLlmOutputSchema: ${z.error.message}`,
    );
  }
  return { content: z.data, message: "" };
}

/**
 * Generate follow-up question suggestions based on the last exchange.
 *
 * Returns an array of suggestion strings, or [] on any failure (never throws).
 */
export async function generateSuggestions(
  serializedData: string,
  lastExchange: string,
  opts?: { requestId?: string },
): Promise<string[]> {
  try {
    await checkDailyBudget();
    const prompt = buildSuggestionPrompt(serializedData, lastExchange);

    const content = await chatText(
      [{ role: "user", content: prompt }],
      0.5,
      512,
      "generateSuggestions",
      opts?.requestId ?? null,
    );

    const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : content.trim();

    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}
