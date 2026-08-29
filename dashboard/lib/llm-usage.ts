import { sql } from "@/lib/db-write";
import { query } from "@/lib/db";
import type { LlmUsageProviderMeta } from "@/lib/llm-provider/types";
import { getSystemConfig } from "@/lib/system-config/loader";

/**
 * Rate table: **estimated** USD per token used for `llm_usage.estimated_cost_usd`
 * on `llm_provider = 'openrouter'` rows.
 *
 * - Values follow public list pricing for the configured model (today: Claude Sonnet 4).
 * - OpenRouter may apply discounts, caching, or rounding; this app does **not** read
 *   OpenRouter’s billing API, so displayed costs are **indicative**, not invoice-accurate.
 * - Unknown models fall back to `DEFAULT_RATE` (same as Sonnet 4) with a console warning.
 * - Cache rates: Anthropic charges cache-write tokens at a 25% premium ($3.75/1M) and
 *   cache-read tokens at a 90% discount ($0.30/1M) vs the normal $3.00/1M input rate.
 *
 * `cli` rows do **not** use this table: the Claude CLI reports its own
 * `total_cost_usd` per call, which `logUsage` stores verbatim via
 * `LogUsageOptions.reportedCostUsd`. Before that plumbing existed every
 * `cli` row stored a hard-coded zero, which is why the usage panel showed no
 * spend at all for the default provider.
 */
const M = 1_000_000;

/**
 * Fallback rate table, USD per token, used only when the provider does not
 * report a cost itself.
 *
 * The authoritative source is the provider: OpenRouter is asked for usage
 * accounting on every call (`usage: { include: true }`, see
 * `openRouterExtras`) and its figure is stored verbatim; the Claude CLI
 * reports `total_cost_usd`. This table exists for the gap where neither
 * reports one.
 *
 * It covers the three families the dashboard targets. Entries are list prices
 * at the time of writing and WILL drift — that is precisely why they are the
 * fallback and not the primary source. A hand-kept table cannot track three
 * vendors, which is how running DeepSeek came to be billed at Claude Sonnet's
 * $3/$15 per Mtok, roughly 15x its real price, with `checkDailyBudget`
 * throttling against that fiction.
 */
const RATES: Record<string, { prompt: number; completion: number; cacheWrite: number; cacheRead: number }> = {
  // Anthropic
  "anthropic/claude-sonnet-4": { prompt: 3.0 / M, completion: 15.0 / M, cacheWrite: 3.75 / M, cacheRead: 0.30 / M },
  "anthropic/claude-sonnet-4.5": { prompt: 3.0 / M, completion: 15.0 / M, cacheWrite: 3.75 / M, cacheRead: 0.30 / M },
  "anthropic/claude-haiku-4.5": { prompt: 1.0 / M, completion: 5.0 / M, cacheWrite: 1.25 / M, cacheRead: 0.10 / M },
  // DeepSeek — the production default. Two orders of magnitude cheaper than
  // Sonnet on output, which is why the old silent fallback was so wrong.
  "deepseek/deepseek-v4-pro": { prompt: 0.28 / M, completion: 1.14 / M, cacheWrite: 0.28 / M, cacheRead: 0.028 / M },
  "deepseek/deepseek-chat": { prompt: 0.14 / M, completion: 0.28 / M, cacheWrite: 0.14 / M, cacheRead: 0.014 / M },
  "deepseek/deepseek-r1": { prompt: 0.55 / M, completion: 2.19 / M, cacheWrite: 0.55 / M, cacheRead: 0.14 / M },
  // OpenAI
  "openai/gpt-4o": { prompt: 2.5 / M, completion: 10.0 / M, cacheWrite: 2.5 / M, cacheRead: 1.25 / M },
  "openai/gpt-4o-mini": { prompt: 0.15 / M, completion: 0.60 / M, cacheWrite: 0.15 / M, cacheRead: 0.075 / M },
  "openai/o3": { prompt: 2.0 / M, completion: 8.0 / M, cacheWrite: 2.0 / M, cacheRead: 0.5 / M },
  "openai/o3-mini": { prompt: 1.1 / M, completion: 4.4 / M, cacheWrite: 1.1 / M, cacheRead: 0.55 / M },
};

/**
 * Rate for a model the table does not list.
 *
 * Deliberately NOT Claude Sonnet's price any more. An unknown model billed at
 * the most expensive family's rate overstates spend and can trip the daily
 * budget for calls that were nearly free; billed at the cheapest it would hide
 * real spend. This sits between the families so an unknown model is wrong by a
 * bounded factor in either direction rather than by 15x in one, and every use
 * warns.
 */
const DEFAULT_RATE = { prompt: 1.0 / M, completion: 4.0 / M, cacheWrite: 1.0 / M, cacheRead: 0.20 / M };

/** Exported for tests: which models the fallback table covers. */
export function knownRateModels(): string[] {
  return Object.keys(RATES);
}

export class BudgetExceededError extends Error {
  constructor() {
    super("Límite diario de generación alcanzado. Reintente mañana.");
    this.name = "BudgetExceededError";
  }
}

/** Optional row fields for correlating `llm_usage` with `llm_tool_calls` (same endpoint + request id). */
export type LogUsageOptions = {
  requestId?: string | null;
  /**
   * Cost reported by the provider itself for this call, in USD.
   *
   * Set by the CLI provider from `total_cost_usd` in the `claude -p` JSON
   * envelope — a real list-price figure for the call, not an estimate
   * derived from the rate table above. When present it wins over the rate
   * table estimate; when absent (openrouter, or a CLI call the binary
   * reported nothing parseable for) the row falls back to that estimator or
   * to 0.
   */
  reportedCostUsd?: number | null;
};

export function logUsage(
  endpoint: string,
  model: string,
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Tokens written to Anthropic prompt cache (charged at 25% premium). NULL = not supported. */
    cache_creation_input_tokens?: number | null;
    /** Tokens read from Anthropic prompt cache (90% discount). NULL = not supported. */
    cache_read_input_tokens?: number | null;
  },
  meta?: LlmUsageProviderMeta,
  options?: LogUsageOptions,
): void {
  const provider = meta?.provider ?? "openrouter";
  const driver = meta?.driver ?? null;
  const requestId = options?.requestId ?? null;
  const cacheCreation = usage.cache_creation_input_tokens ?? null;
  const cacheRead = usage.cache_read_input_tokens ?? null;

  const reportedCost = options?.reportedCostUsd;
  let estimatedCost = 0;
  if (reportedCost !== null && reportedCost !== undefined && Number.isFinite(reportedCost) && reportedCost >= 0) {
    // Provider-reported (CLI `total_cost_usd`) — authoritative, no estimation.
    estimatedCost = reportedCost;
  } else if (provider === "openrouter") {
    let rate = RATES[model];
    if (!rate) {
      console.warn(`[llm-usage] Unknown model "${model}", using default rate`);
      rate = DEFAULT_RATE;
    }
    // NOTE: OpenRouter normalises `prompt_tokens` to exclude cache tokens (they are
    // reported separately in `cache_creation_input_tokens` / `cache_read_input_tokens`).
    // This differs from the raw Anthropic API where `input_tokens` is an inclusive sum.
    // The formula below is correct under the OpenRouter normalisation: cache tokens are
    // billed at their specific rates and NOT again at the base prompt rate.
    estimatedCost =
      usage.prompt_tokens * rate.prompt +
      usage.completion_tokens * rate.completion +
      (cacheCreation ?? 0) * rate.cacheWrite +
      (cacheRead ?? 0) * rate.cacheRead;
  }

  void sql(
    `INSERT INTO llm_usage (
       endpoint, model, prompt_tokens, completion_tokens, total_tokens,
       estimated_cost_usd, llm_provider, llm_driver, request_id,
       cache_creation_input_tokens, cache_read_input_tokens
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      endpoint,
      model,
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
      estimatedCost.toFixed(6),
      provider,
      driver,
      requestId,
      cacheCreation,
      cacheRead,
    ],
  ).catch((err) => {
    console.error("[llm-usage] Failed to log usage:", err);
  });
}

export async function checkDailyBudget(): Promise<void> {
  // Read the budget from the central config loader (env > config.yaml > default).
  // Uses the cached getSystemConfig() for production performance; tests that stub env
  // vars should call resetDashboardLlmConfigCache() (which also clears the system-config
  // cache) in their afterEach to ensure fresh reads.
  let budgetStr: string | null = null;
  try {
    const cfg = getSystemConfig();
    const raw = cfg["dashboard.llm_daily_budget_usd"]?.value;
    budgetStr = raw !== null && raw !== undefined ? String(raw).trim() : null;
  } catch {
    // Loader unavailable (e.g., schema file missing) — fall back to process.env
    budgetStr = process.env.LLM_DAILY_BUDGET_USD ?? null;
  }

  if (!budgetStr || budgetStr === "0" || budgetStr === "") {
    return;
  }

  const limit = parseFloat(budgetStr);
  if (isNaN(limit) || limit <= 0) {
    return;
  }

  // The CLI provider used to be exempted here ("CLI rows always cost 0, so a
  // sum over them can never trip the cap"). That exemption is gone: `cli`
  // rows now carry the CLI's own `total_cost_usd` (see `logUsage`'s
  // `reportedCostUsd`), so the daily cap finally applies to the DEFAULT
  // provider — which is the whole point of having a cap. Rows written before
  // this change stored 0 and simply contribute nothing retroactively.
  //
  // TOCTOU: concurrent requests can all pass the check before any log their cost,
  // allowing overshoot by up to N×(max call cost). Acceptable for a daily soft cap.
  // CURRENT_DATE uses the PostgreSQL session timezone (default UTC); the budget
  // window resets at midnight UTC regardless of the server's local timezone.
  try {
    const result = await query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total
       FROM llm_usage
       WHERE created_at >= CURRENT_DATE`,
    );
    const total = parseFloat((result.rows[0]?.[0] as string | undefined) ?? "0");
    if (total >= limit) {
      throw new BudgetExceededError();
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      throw err;
    }
    // Fail-open: if the query fails, allow the call rather than blocking
    console.error("[llm-usage] Budget check failed, allowing request:", err);
  }
}
