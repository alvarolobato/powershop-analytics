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
import type { DashboardLlmConfig } from "./llm-provider/types";
import { isAgenticToolsEnabled } from "./llm-tools/config";
import { runAgenticChat, AgenticRunnerError } from "./llm-tools/runner";
import type { LlmAgenticContext } from "./llm-tools/types";
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

function usageMeta(ctx: Pick<LlmAgenticContext, "llmProvider" | "llmDriver"> | undefined): LlmUsageProviderMeta {
  const p = ctx?.llmProvider ?? "openrouter";
  const d = ctx?.llmDriver ?? null;
  return {
    provider: p,
    driver: d,
  };
}

function attachTelemetry(ctx: LlmAgenticContext, cfg: DashboardLlmConfig): LlmAgenticContext {
  return {
    ...ctx,
    llmProvider: cfg.provider,
    llmDriver: cfg.provider === "cli" ? cfg.cliDriver : null,
  };
}

async function chatText(
  messages: ChatCompletionMessageParam[],
  temperature: number,
  maxTokens: number,
  endpoint: string,
  ctx?: LlmAgenticContext,
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const model = getEffectiveDashboardModel(cfg);
  const meta = usageMeta(ctx);

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
    void logUsage(endpoint, model, EMPTY_USAGE, meta);
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
    const model = getEffectiveDashboardModel(cfg);
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
    void logUsage("generateDashboard", model, usage, usageMeta(requestCtx));
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
    requestCtx,
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
    const model = getEffectiveDashboardModel(cfg);
    const { content, usage } = await callWithCircuitBreaker(() =>
      runAgenticChat({
        adapter,
        model,
        systemPrompt: `${buildModifyPrompt(currentSpec)}\n\n${buildAgenticToolPreamble()}`,
        userContent: userPrompt,
        ctx: requestCtx,
        temperature: 0.2,
        maxTokens: 8192,
      }),
    );
    void logUsage("modifyDashboard", model, usage, usageMeta(requestCtx));
    return content;
  }

  const systemPrompt = buildModifyPrompt(currentSpec);
  return chatText(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    0.2,
    8192,
    "modifyDashboard",
    requestCtx,
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
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const ctx = attachTelemetry(
    { requestId: "req_local", endpoint: "suggestDashboards" },
    cfg,
  );

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
    ctx,
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
): Promise<string> {
  const cfg = loadDashboardLlmConfig();
  const ctx = attachTelemetry({ requestId: "req_local", endpoint: "analyzeGaps" }, cfg);

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
    ctx,
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
    })}\n\n${buildAgenticToolPreamble()}`;
    const adapter = createDashboardAgenticAdapter();
    const model = getEffectiveDashboardModel(cfg);
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
    void logUsage("analyzeDashboard", model, usage, usageMeta(requestCtx));
    return content;
  }

  const systemPrompt = buildAnalyzePrompt(serializedData, action, {
    dashboardId: requestCtx.dashboardId,
  });

  return chatText(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    0.3,
    4096,
    "analyzeDashboard",
    requestCtx,
  );
}

/**
 * Generate a weekly business review from query results (in Spanish).
 *
 * Returns the parsed LLM output (validated with Zod). Uses max_tokens: 4096
 * (reviews are shorter than full dashboard specs).
 */
export async function generateReview(systemPrompt: string): Promise<ReviewLlmOutput> {
  const cfg = loadDashboardLlmConfig();
  const ctx = attachTelemetry({ requestId: "req_local", endpoint: "generateReview" }, cfg);

  await checkDailyBudget();

  const content = await chatText(
    [{ role: "system", content: systemPrompt }],
    0.2,
    4096,
    "generateReview",
    ctx,
  );

  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : content.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for review. Raw response: ${content.slice(0, 500)}`,
    );
  }

  const z = ReviewLlmOutputSchema.safeParse(parsed);
  if (!z.success) {
    throw new Error(
      `LLM returned JSON that does not match ReviewLlmOutputSchema: ${z.error.message}`,
    );
  }
  return z.data;
}

/**
 * Generate follow-up question suggestions based on the last exchange.
 *
 * Returns an array of suggestion strings, or [] on any failure (never throws).
 */
export async function generateSuggestions(
  serializedData: string,
  lastExchange: string,
): Promise<string[]> {
  try {
    const cfg = loadDashboardLlmConfig();
    const ctx = attachTelemetry(
      { requestId: "req_local", endpoint: "generateSuggestions" },
      cfg,
    );

    await checkDailyBudget();
    const prompt = buildSuggestionPrompt(serializedData, lastExchange);

    const content = await chatText([{ role: "user", content: prompt }], 0.5, 512, "generateSuggestions", ctx);

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
