/**
 * Dashboard LLM entry points: OpenRouter API or CLI drivers (configurable).
 */

import {
  buildGeneratePrompt,
  buildModifyPrompt,
  buildAgenticToolPreamble,
} from "./prompts";
import { buildSuggestPrompt, buildGapAnalysisPrompt } from "./creation-prompts";
import { buildAnalyzePrompt, buildSuggestionPrompt } from "./analyze-prompts";
import { ReviewLlmOutputSchema, type ReviewLlmOutput } from "./review-schema";
import { logUsage, checkDailyBudget } from "./llm-usage";
import { callWithCircuitBreaker } from "./llm-circuit-breaker";
import {
  loadDashboardLlmConfig,
  getEffectiveDashboardModel,
} from "./llm-provider/config";
import type { DashboardLlmConfig, DashboardLlmFlow } from "./llm-provider/types";
import { isAgenticToolsEnabled, getAgenticConfig } from "./llm-tools/config";
import { runAgenticChat, AgenticRunnerError } from "./llm-tools/runner";
import type { LlmAgenticContext, AgenticProgressEvent } from "./llm-tools/types";
import type { LlmUsageProviderMeta } from "./llm-provider/types";
import {
  getOpenRouterClient,
  resetOpenRouterClient,
  openRouterChatCompletion,
} from "./llm-provider/openrouter";
import { createDashboardAgenticAdapter } from "./llm-provider/registry";
import { claudeCliSingleShot } from "./llm-provider/cli/claude-code";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export { BudgetExceededError } from "./llm-usage";
export { CircuitBreakerOpenError } from "./llm-circuit-breaker";
export { AgenticRunnerError };
export type { LlmAgenticContext, AgenticProgressEvent } from "./llm-tools/types";

const EMPTY_USAGE = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

export { resetOpenRouterClient as resetClient };

/** Usage row metadata: always align with the configured backend, not caller-supplied ctx (avoids stale ctx). */
function usageMetaFromCfg(cfg: DashboardLlmConfig): LlmUsageProviderMeta {
  return {
    provider: cfg.provider,
    driver: cfg.provider === "cli" ? cfg.cliDriver : null,
  };
}

function attachTelemetry(ctx: LlmAgenticContext, cfg: DashboardLlmConfig): LlmAgenticContext {
  return {
    ...ctx,
    llmProvider: cfg.provider,
    llmDriver: cfg.provider === "cli" ? cfg.cliDriver : null,
  };
}

/**
 * Single-shot text completion that emits model_step_start / model_text_delta progress
 * events via the ctx.onAgenticProgress hook. Used by review generation and other flows
 * that want live streaming without the full agentic tool loop.
 *
 * Emits `model_step_start` before the call and `model_text_delta` for each chunk
 * (CLI: per streaming line; OpenRouter: per streaming delta).
 */
async function chatTextWithProgress(
  messages: ChatCompletionMessageParam[],
  temperature: number,
  maxTokens: number,
  endpoint: string,
  ctx: LlmAgenticContext,
  flow?: DashboardLlmFlow,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const model = getEffectiveDashboardModel(cfg, flow);
  const meta = usageMetaFromCfg(cfg);
  const requestId = ctx.requestId ?? null;

  // Emit model_step_start before we call the model.
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

  if (cfg.provider === "cli") {
    // For CLI single-shot we don't have per-chunk streaming, so emit a single delta after completion.
    const combined = messages
      .map((m) => {
        const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `## ${m.role}\n${body}`;
      })
      .join("\n\n");
    const text = await callWithCircuitBreaker(() => claudeCliSingleShot({ cfg, prompt: combined }));
    void logUsage(endpoint, model, EMPTY_USAGE, meta, { requestId });
    if (ctx.onAgenticProgress && text) {
      try {
        ctx.onAgenticProgress({
          type: "model_text_delta",
          round: 1,
          chars: text.length,
          totalChars: text.length,
          text,
        });
      } catch {
        /* ignore */
      }
    }
    return text;
  }

  // OpenRouter streaming path — accumulate content and emit delta per chunk.
  const client = getOpenRouterClient();
  const stream = await callWithCircuitBreaker(() =>
    client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  );

  let textContent = "";
  let totalCharsEmitted = 0;
  let usageOut: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      textContent += delta;
      const deltaChars = delta.length;
      totalCharsEmitted += deltaChars;
      if (ctx.onAgenticProgress) {
        try {
          ctx.onAgenticProgress({
            type: "model_text_delta",
            round: 1,
            chars: deltaChars,
            totalChars: totalCharsEmitted,
            text: textContent,
          });
        } catch {
          /* ignore */
        }
      }
    }
    if (chunk.usage) {
      usageOut = {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      };
    }
  }

  const u = usageOut ?? EMPTY_USAGE;
  void logUsage(
    endpoint,
    model,
    {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    },
    meta,
    { requestId },
  );
  return textContent;
}

async function chatText(
  messages: ChatCompletionMessageParam[],
  temperature: number,
  maxTokens: number,
  endpoint: string,
  requestId?: string | null,
  flow?: DashboardLlmFlow,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const model = getEffectiveDashboardModel(cfg, flow);
  const meta = usageMetaFromCfg(cfg);
  const usageOpts = { requestId: requestId ?? null };

  if (cfg.provider === "cli") {
    const combined = messages
      .map((m) => {
        const body =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `## ${m.role}\n${body}`;
      })
      .join("\n\n");
    const text = await callWithCircuitBreaker(() =>
      claudeCliSingleShot({ cfg, prompt: combined }),
    );
    void logUsage(endpoint, model, EMPTY_USAGE, meta, usageOpts);
    return text;
  }

  const client = getOpenRouterClient();
  const { content, usage } = await callWithCircuitBreaker(() =>
    openRouterChatCompletion({
      client,
      model,
      messages,
      temperature,
      maxTokens,
    }),
  );
  const u = usage ?? EMPTY_USAGE;
  void logUsage(
    endpoint,
    model,
    {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    },
    meta,
    usageOpts,
  );
  return content;
}

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
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        systemPrompt: `${buildGeneratePrompt()}\n\n${buildAgenticToolPreamble()}`,
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
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    ctx ?? { requestId: "req_local", endpoint: "modifyDashboard" },
    cfg,
  );

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg, "modify");
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        systemPrompt: `${buildModifyPrompt(currentSpec, true)}\n\n${buildAgenticToolPreamble()}`,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.2,
        maxTokens: 8192,
      }),
    );
    void logUsage("modifyDashboard", model, usage, usageMetaFromCfg(cfg), {
      requestId: requestCtx.requestId,
    });
    return content;
  }

  // Non-agentic path: use legacy prompt (no publish-tool instructions).
  const systemPrompt = buildModifyPrompt(currentSpec, false);
  return chatText(
    [
      { role: "system", content: systemPrompt },
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
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const requestCtx = attachTelemetry(
    ctx ?? { requestId: "req_local", endpoint: "analyzeDashboard" },
    cfg,
  );

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const systemPrompt = `${buildAnalyzePrompt(serializedData, action, {
      dashboardId: requestCtx.dashboardId,
      agenticMode: true,
    })}\n\n${buildAgenticToolPreamble()}`;
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg, "analyze");
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        systemPrompt,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.3,
        maxTokens: 4096,
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
 * `submit_weekly_review` tool is reachable. The model calls the tool to stage
 * the review JSON, then emits freeform Spanish prose as its final message.
 *
 * Returns `{ content: ReviewLlmOutput; message: string }` where `content` is
 * the validated review JSON (from ctx.reviewResult) and `message` is the
 * model's freeform chat reply.
 *
 * Throws AgenticRunnerError("AGENTIC_RUNNER", phase "final") if the model
 * returned final text without calling submit_weekly_review.
 */
export async function generateReviewAgentic(
  systemPrompt: string,
  opts?: { requestId?: string; onAgenticProgress?: (ev: AgenticProgressEvent) => void },
): Promise<{ content: ReviewLlmOutput; message: string }> {
  const requestId = opts?.requestId ?? "req_local";

  await checkDailyBudget();

  const cfg = loadDashboardLlmConfig();
  // Build a mutable ctx — the side-channel slots start null.
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

  const { content: finalMessage, usage } = await callWithCircuitBreaker(() =>
    runAgenticChat({
      adapter,
      model,
      systemPrompt,
      userContent: "Genera la revisión semanal ahora.",
      ctx,
      temperature: 0.2,
      maxTokens: 4096,
    }),
  );

  void logUsage("generateReview", model, usage, usageMetaFromCfg(cfg), { requestId });

  // If the model did not call submit_weekly_review, fail loudly.
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
 * Generate a weekly business review from query results (in Spanish), with optional
 * agentic progress callbacks for streaming.
 *
 * When agentic tools are enabled, delegates to `generateReviewAgentic` so that
 * `submit_weekly_review` is reachable. When tools are disabled, falls back to the
 * single-shot chatText path.
 *
 * Returns the parsed LLM output (validated with Zod). Uses max_tokens: 4096
 * (reviews are shorter than full dashboard specs).
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

  // Use chatText-with-delta path so model_text_delta events fire.
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
 *
 * Returns the parsed LLM output (validated with Zod). Uses max_tokens: 4096
 * (reviews are shorter than full dashboard specs).
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
