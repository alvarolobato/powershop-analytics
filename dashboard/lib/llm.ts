/**
 * OpenRouter LLM client for dashboard generation and modification.
 *
 * Uses the OpenAI SDK with a baseURL override to route requests through
 * OpenRouter.  API key and model are read from environment variables.
 */

import OpenAI from "openai";
import { buildGeneratePrompt, buildModifyPrompt } from "./prompts";
import { buildSuggestPrompt, buildGapAnalysisPrompt } from "./creation-prompts";
import { buildAnalyzePrompt, buildSuggestionPrompt } from "./analyze-prompts";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

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
  return process.env.DASHBOARD_LLM_MODEL || DEFAULT_MODEL;
}

// ─── Client factory ──────────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: getApiKey(),
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/alvarolobato/powershop-analytics",
        "X-Title": "PowerShop Dashboard",
      },
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
export async function generateDashboard(userPrompt: string): Promise<string> {
  const client = getClient();
  const systemPrompt = buildGeneratePrompt();

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 8192,
  });

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
  userPrompt: string
): Promise<string> {
  const client = getClient();
  const systemPrompt = buildModifyPrompt(currentSpec);

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 8192,
  });

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

  const response = await client.chat.completions.create({
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
  });

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

  const response = await client.chat.completions.create({
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
  });

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
  action?: string
): Promise<string> {
  const client = getClient();
  const systemPrompt = buildAnalyzePrompt(serializedData, action);

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty response");
  }
  return content;
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
    const client = getClient();
    const prompt = buildSuggestionPrompt(serializedData, lastExchange);

    const response = await client.chat.completions.create({
      model: getModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 512,
    });

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
