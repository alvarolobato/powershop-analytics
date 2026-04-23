import { sql } from "@/lib/db-write";
import { query } from "@/lib/db";
import type { LlmUsageProviderMeta } from "@/lib/llm-provider/types";
import { loadDashboardLlmConfig } from "@/lib/llm-provider/config";

/**
 * Rate table: **estimated** USD per token used only for `llm_usage.estimated_cost_usd`.
 *
 * - Values follow public list pricing for the configured model (today: Claude Sonnet 4).
 * - OpenRouter may apply discounts, caching, or rounding; this app does **not** read
 *   OpenRouter’s billing API, so displayed costs are **indicative**, not invoice-accurate.
 * - Unknown models fall back to `DEFAULT_RATE` (same as Sonnet 4) with a console warning.
 * - Rows with `llm_provider = 'cli'` store **zero** estimated cost (flat-rate / unknown).
 */
const RATES: Record<string, { prompt: number; completion: number }> = {
  "anthropic/claude-sonnet-4": {
    prompt: 3.0 / 1_000_000,
    completion: 15.0 / 1_000_000,
  },
};
const DEFAULT_RATE = { prompt: 3.0 / 1_000_000, completion: 15.0 / 1_000_000 };

export class BudgetExceededError extends Error {
  constructor() {
    super("Límite diario de generación alcanzado. Reintente mañana.");
    this.name = "BudgetExceededError";
  }
}

export function logUsage(
  endpoint: string,
  model: string,
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  },
  meta?: LlmUsageProviderMeta,
): void {
  const provider = meta?.provider ?? "openrouter";
  const driver = meta?.driver ?? null;

  let estimatedCost = 0;
  if (provider === "openrouter") {
    let rate = RATES[model];
    if (!rate) {
      console.warn(`[llm-usage] Unknown model "${model}", using default rate`);
      rate = DEFAULT_RATE;
    }
    estimatedCost =
      usage.prompt_tokens * rate.prompt + usage.completion_tokens * rate.completion;
  }

  void sql(
    `INSERT INTO llm_usage (
       endpoint, model, prompt_tokens, completion_tokens, total_tokens,
       estimated_cost_usd, llm_provider, llm_driver
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      endpoint,
      model,
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
      estimatedCost.toFixed(6),
      provider,
      driver,
    ],
  ).catch((err) => {
    console.error("[llm-usage] Failed to log usage:", err);
  });
}

export async function checkDailyBudget(): Promise<void> {
  const budgetStr = process.env.LLM_DAILY_BUDGET_USD;
  if (!budgetStr || budgetStr === "0" || budgetStr === "") {
    return;
  }

  const limit = parseFloat(budgetStr);
  if (isNaN(limit) || limit <= 0) {
    return;
  }

  // CLI provider does not add OpenRouter-estimated spend; do not block on API budget.
  if (loadDashboardLlmConfig().provider === "cli") {
    return;
  }

  // TOCTOU: concurrent requests can all pass the check before any log their cost,
  // allowing overshoot by up to N×(max call cost). Acceptable for a daily soft cap.
  // CURRENT_DATE uses the PostgreSQL session timezone (default UTC); the budget
  // window resets at midnight UTC regardless of the server's local timezone.
  // Only `openrouter` rows contribute token-derived estimated spend; CLI rows use cost 0.
  try {
    const result = await query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total
       FROM llm_usage
       WHERE created_at >= CURRENT_DATE
         AND llm_provider = 'openrouter'`,
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
