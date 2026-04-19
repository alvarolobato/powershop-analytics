import { sql } from "@/lib/db-write";

// Rate table: USD per token (easy to update when OpenRouter pricing changes)
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
  }
): void {
  const rate = RATES[model] ?? DEFAULT_RATE;
  const estimatedCost =
    usage.prompt_tokens * rate.prompt +
    usage.completion_tokens * rate.completion;

  void sql(
    `INSERT INTO llm_usage (endpoint, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      endpoint,
      model,
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
      estimatedCost.toFixed(6),
    ]
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

  try {
    const rows = await sql<{ total: string }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total
       FROM llm_usage
       WHERE created_at >= CURRENT_DATE`
    );
    const total = parseFloat(rows[0]?.total ?? "0");
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
