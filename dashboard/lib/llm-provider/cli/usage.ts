/**
 * Token/cost accounting for the Claude Code CLI provider.
 *
 * ## Why this exists
 *
 * Before this module the CLI path reported **nothing**: `llmComplete` logged
 * a hard-coded `EMPTY_USAGE` for every `cli` call, the agentic adapter
 * (`agent-adapter.ts`) hard-coded `{prompt_tokens:0, completion_tokens:0,
 * total_tokens:0}` on every round, and `checkDailyBudget` exempted the
 * provider outright — so the DEFAULT production provider was both invisible
 * in `/admin/usage` and immune to the daily spend cap. `claude -p
 * --output-format json` returns a single result envelope, and
 * `--output-format stream-json` ends with an equivalent
 * `{"type":"result", ...}` line. Both carry:
 *
 *   {
 *     "result": "<assistant text>",
 *     "total_cost_usd": 0.0176284,
 *     "usage": {
 *       "input_tokens": 9,
 *       "output_tokens": 36,
 *       "cache_creation_input_tokens": 7521,
 *       "cache_read_input_tokens": 18134
 *     }
 *   }
 *
 * `total_cost_usd` is the CLI's own list-price computation for the call, so a
 * `cli` row can carry a REAL cost instead of the rate-table estimate we
 * apply to `openrouter` rows (which is meaningless here anyway — the account
 * behind the CLI is typically a flat-rate subscription, not billed per
 * token).
 *
 * ## Token semantics (matches the OpenRouter normalisation in `llm-usage.ts`)
 *
 * Anthropic reports `input_tokens` EXCLUSIVE of cache tokens — cache-creation
 * and cache-read are separate counters, each billed at its own rate. That is
 * the same normalisation `logUsage` already documents for OpenRouter, so the
 * mapping is direct: `prompt_tokens = input_tokens`, cache counters passed
 * through verbatim, and **`total_tokens = prompt + completion`**, matching
 * what OpenRouter puts in the same column (cache volume has its own two
 * columns; anything that wants the full picture adds them explicitly).
 *
 * ## What `cost_usd` covers
 *
 * `total_cost_usd` is the CLI's estimate of everything it did for the
 * invocation. A probe of one call showed the top-level `usage` block
 * describing only the main turn while `total_cost_usd` also folded in a
 * small un-attributed auxiliary call, so deriving $/token from a single row
 * will not reconcile exactly. That is a property of the CLI, not of this
 * parser.
 */

/** Normalised usage for one CLI invocation. `null` fields = not reported. */
export interface CliReportedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  /** The CLI's own list-price cost for this call (`total_cost_usd`). */
  cost_usd: number | null;
}

function readNonNegativeInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

/**
 * Extract usage from a `--output-format json` envelope or a `stream-json`
 * `{"type":"result"}` line (identical shape for these fields).
 *
 * Defensive by design: this repo does not pin the host `claude` binary
 * version, so an older/newer build emitting a different envelope shape must
 * degrade to `null` rather than throw — telemetry must never be able to fail
 * a user-facing LLM call. `null` is logged as "unreported", never silently
 * coerced to zero (a zero would read as "this call was free", which is a
 * different claim than "the binary told us nothing").
 */
export function parseCliReportedUsage(envelope: unknown): CliReportedUsage | null {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const o = envelope as Record<string, unknown>;

  const rawUsage = o.usage;
  const cost =
    typeof o.total_cost_usd === "number" && Number.isFinite(o.total_cost_usd) && o.total_cost_usd >= 0
      ? o.total_cost_usd
      : null;

  if (!rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
    // Cost without a token breakdown is still worth recording.
    if (cost === null) return null;
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cost_usd: cost,
    };
  }

  const u = rawUsage as Record<string, unknown>;
  const input = readNonNegativeInt(u.input_tokens) ?? 0;
  const output = readNonNegativeInt(u.output_tokens) ?? 0;
  const cacheCreation = readNonNegativeInt(u.cache_creation_input_tokens);
  const cacheRead = readNonNegativeInt(u.cache_read_input_tokens);

  return {
    prompt_tokens: input,
    completion_tokens: output,
    // Excludes the cache counters on purpose — same column semantics as the
    // OpenRouter path. See the module doc.
    total_tokens: input + output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    cost_usd: cost,
  };
}
