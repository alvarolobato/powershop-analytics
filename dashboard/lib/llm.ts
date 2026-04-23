/**
 * OpenRouter LLM client for dashboard generation and modification.
 *
 * Uses the OpenAI SDK with a baseURL override to route requests through
 * OpenRouter.  API key and model are read from environment variables.
 */

import OpenAI from "openai";
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
import { getDashboardLlmModel } from "./llm-model-config";
import { isAgenticToolsEnabled } from "./llm-tools/config";
import { runAgenticChat, AgenticRunnerError } from "./llm-tools/runner";
import type { LlmAgenticContext } from "./llm-tools/types";

export { BudgetExceededError } from "./llm-usage";
export { CircuitBreakerOpenError } from "./llm-circuit-breaker";
export { AgenticRunnerError };
export type { LlmAgenticContext };

const EMPTY_USAGE = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

// ─── Configuration ───────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it in your environment or .env file."
    );
  }
  return key;
}

function getModel(): string {
  return getDashboardLlmModel();
}

// ─── Retry helpers ───────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

function getStatus(err: unknown): number | undefined {
  if (
    err !== null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function getHeaderValue(headers: unknown, name: string): string | null | undefined {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (headers !== null && typeof headers === "object" && !Array.isArray(headers)) {
    const targetName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === targetName && typeof value === "string") {
        return value;
      }
    }
  }
  return undefined;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== "object" || !("headers" in err)) return undefined;
  const headers = (err as { headers: unknown }).headers;
  const value = getHeaderValue(headers, "retry-after");
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 0 ? undefined : Math.min(parsed * 1000, MAX_RETRY_DELAY_MS);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = getStatus(err);

      if (status === 400) throw err;
      if (attempt === MAX_ATTEMPTS - 1) break;

      const shouldRetry =
        status === undefined || status === 429 || status >= 500;
      if (!shouldRetry) throw err;

      let delay = BASE_DELAY_MS * Math.pow(2, attempt);
      if (status === 429) {
        const retryAfterMs = getRetryAfterMs(err);
        if (retryAfterMs !== undefined) delay = retryAfterMs;
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Client factory ──────────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: getApiKey(),
    });
  }
  return _client;
}

/**
 * Reset the cached client.  Useful for testing or after changing env vars.
 */
export function resetClient(): void {
  _client = null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a new dashboard from a user prompt (in Spanish).
 *
 * Returns the raw LLM response text, which should be a JSON dashboard spec.
 */
export async function generateDashboard(
  userPrompt: string,
  ctx?: LlmAgenticContext,
): Promise<string> {
  const client = getClient();
  const requestCtx: LlmAgenticContext = ctx ?? {
    requestId: "req_local",
    endpoint: "generateDashboard",
  };

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const { content, usage } = await callWithCircuitBreaker(() =>
      withRetry(() =>
        runAgenticChat({
          client,
          model: getModel(),
          systemPrompt: `${buildGeneratePrompt()}\n\n${buildAgenticToolPreamble()}`,
          userContent: userPrompt,
          ctx: requestCtx,
          temperature: 0.2,
          maxTokens: 8192,
        }),
      ),
    );
    void logUsage("generateDashboard", getModel(), usage);
    return content;
  }

  const systemPrompt = buildGeneratePrompt();

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    ),
  );

  void logUsage("generateDashboard", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
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
  const client = getClient();
  const requestCtx: LlmAgenticContext = ctx ?? {
    requestId: "req_local",
    endpoint: "modifyDashboard",
  };

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const { content, usage } = await callWithCircuitBreaker(() =>
      withRetry(() =>
        runAgenticChat({
          client,
          model: getModel(),
          systemPrompt: `${buildModifyPrompt(currentSpec)}\n\n${buildAgenticToolPreamble()}`,
          userContent: userPrompt,
          ctx: requestCtx,
          temperature: 0.2,
          maxTokens: 8192,
        }),
      ),
    );
    void logUsage("modifyDashboard", getModel(), usage);
    return content;
  }

  const systemPrompt = buildModifyPrompt(currentSpec);

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    ),
  );

  void logUsage("modifyDashboard", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
}

/**
 * Suggest dashboards for a given role, avoiding overlap with existing ones.
 *
 * Returns raw JSON string: array of {name, description, prompt}.
 */
export async function suggestDashboards(
  role: string,
  existingDashboards: { title: string; description: string }[]
): Promise<string> {
  const client = getClient();
  const systemPrompt = buildSuggestPrompt(role, existingDashboards);

  await checkDailyBudget();

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Sugiere 3-4 dashboards útiles para el rol: ${role}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    ),
  );

  void logUsage("suggestDashboards", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
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
  }[]
): Promise<string> {
  const client = getClient();
  const systemPrompt = buildGapAnalysisPrompt(existingDashboards);

  await checkDailyBudget();

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              "Analiza los dashboards existentes e identifica las áreas de negocio importantes que no están cubiertas.",
          },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    ),
  );

  void logUsage("analyzeGaps", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
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
  const client = getClient();
  const requestCtx: LlmAgenticContext = ctx ?? {
    requestId: "req_local",
    endpoint: "analyzeDashboard",
  };

  await checkDailyBudget();

  if (isAgenticToolsEnabled()) {
    const systemPrompt = `${buildAnalyzePrompt(serializedData, action, {
      dashboardId: requestCtx.dashboardId,
    })}\n\n${buildAgenticToolPreamble()}`;
    const { content, usage } = await callWithCircuitBreaker(() =>
      withRetry(() =>
        runAgenticChat({
          client,
          model: getModel(),
          systemPrompt,
          userContent: userPrompt,
          ctx: requestCtx,
          temperature: 0.3,
          maxTokens: 4096,
        }),
      ),
    );
    void logUsage("analyzeDashboard", getModel(), usage);
    return content;
  }

  const systemPrompt = buildAnalyzePrompt(serializedData, action, {
    dashboardId: requestCtx.dashboardId,
  });

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    ),
  );

  void logUsage("analyzeDashboard", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
}

/**
 * Generate a weekly business review from query results (in Spanish).
 *
 * Returns the parsed LLM output (validated with Zod). Uses max_tokens: 4096
 * (reviews are shorter than full dashboard specs).
 */
export async function generateReview(
  systemPrompt: string
): Promise<ReviewLlmOutput> {
  const client = getClient();

  await checkDailyBudget();

  const response = await callWithCircuitBreaker(() =>
    withRetry(() =>
      client.chat.completions.create({
        model: getModel(),
        messages: [{ role: "system", content: systemPrompt }],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    ),
  );

  void logUsage("generateReview", getModel(), response.usage ?? EMPTY_USAGE);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  // Strip optional markdown fences in case the model wraps JSON despite instructions
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : content.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for review. Raw response: ${content.slice(0, 500)}`
    );
  }

  const z = ReviewLlmOutputSchema.safeParse(parsed);
  if (!z.success) {
    throw new Error(
      `LLM returned JSON that does not match ReviewLlmOutputSchema: ${z.error.message}`
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
  lastExchange: string
): Promise<string[]> {
  try {
    await checkDailyBudget();
    const client = getClient();
    const prompt = buildSuggestionPrompt(serializedData, lastExchange);

    const response = await callWithCircuitBreaker(() =>
      withRetry(() =>
        client.chat.completions.create({
          model: getModel(),
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
          max_tokens: 512,
        }),
      ),
    );

    void logUsage("generateSuggestions", getModel(), response.usage ?? EMPTY_USAGE);

    const content = response.choices[0]?.message?.content ?? "";

    // Extract JSON from possible markdown fences
    const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : content.trim();

    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    // Never throw — suggestions are best-effort
    return [];
  }
}
