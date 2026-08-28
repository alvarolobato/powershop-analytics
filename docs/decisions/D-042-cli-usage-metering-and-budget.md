---
id: D-042
title: Meter and budget-cap the Claude CLI provider like OpenRouter
date: 2026-08-28
---

# D-042: Meter and budget-cap the Claude CLI provider like OpenRouter

*Decided: 2026-08-28*

**Context**: `DASHBOARD_LLM_PROVIDER=cli` is the production default, and under it spend
was both invisible and uncapped. `llmComplete`'s CLI branch logged a
hard-coded `EMPTY_USAGE` for every call. The agentic adapter
(`llm-provider/cli/agent-adapter.ts`) hard-coded `{prompt_tokens:0,
completion_tokens:0, total_tokens:0}` on every round. `llm-context/assemble.ts`
computed `normalizedUsage` for the agentic path and then never persisted it —
no `logUsage` call existed on that branch for either provider, so an entire
multi-round chat/generate/modify/analyze turn was invisible to `llm_usage`
regardless of transport. The history-summariser's CLI branch
(`llm-context/history.ts`) called `claudeCliSingleShot` and discarded the
result outright. Separately, `checkDailyBudget` (`llm-usage.ts`) early-returned
for `provider === "cli"` and its spend query filtered to
`llm_provider = 'openrouter'`, so the one configurable safety net could never
apply to the default provider even if metering existed.

The data was always available: `claude -p --output-format json` (and the
`stream-json` `{"type":"result"}` line) returns a `usage` block plus a
`total_cost_usd` figure — the CLI's own list-price computation for the call.

**Decision**:
- The single-shot CLI path (`claudeCliSingleShot`) now runs with
  `--output-format json` (was `text`) and returns `{ text, usage }` instead of
  bare text. The result envelope is located by scanning stdout LINE BY LINE
  (`findResultEnvelope`), not by `JSON.parse`-ing the whole blob — this repo
  does not pin the host `claude` binary version, so a stray line ahead of the
  JSON (a deprecation notice, an update nag) must not break the call, and a
  flow whose own answer happens to be JSON must not be mistaken for the
  envelope. `lib/llm-provider/cli/usage.ts` (`parseCliReportedUsage`) is the
  single parser for this shape, shared by both the single-shot envelope and
  the agentic `stream-json` result line. It is defensive by construction: a
  missing `usage` block, a missing `total_cost_usd`, or any other
  unrecognised shape degrades to a `null` usage field — never a thrown error,
  never a silent zero. `null` means "the binary reported nothing parseable"
  and stays distinguishable from a genuinely free call all the way through
  `AgenticUsageTotals.reported_cost_usd`.
- The agentic step (`claudeCliAgenticStep` / `parseStreamJsonLine`) now
  attaches this round's parsed usage to its `result` line, and the CLI
  agentic adapter (`agent-adapter.ts`) forwards it instead of the previous
  hard-coded zero. `AgenticUsageTotals` (`llm-tools/types.ts`) gained
  `reported_cost_usd`, summed across rounds by `addUsage`.
- `llm-context/assemble.ts`'s agentic branch now calls `logUsage(...)` with
  the normalised usage and `reportedCostUsd: usage.reported_cost_usd` — the
  single seam every agentic run (chat, generate, modify, analyze) passes
  through, for both providers.
- `llm-context/history.ts`'s CLI branch of `buildSummary` now logs the real
  usage from the summarisation call instead of nothing.
- `logUsage` (`llm-usage.ts`) gained `LogUsageOptions.reportedCostUsd`: when
  present and non-negative it wins over the rate-table estimate outright,
  regardless of provider — a CLI row gets a real cost instead of the
  estimator (which would be meaningless for it anyway, see below).
- `checkDailyBudget` no longer exempts `provider === "cli"`, and its spend
  query no longer filters to `llm_provider = 'openrouter'` — it sums every
  provider's `estimated_cost_usd`, which now includes the CLI's real
  `reportedCostUsd` rows.
- `dashboard/app/admin/usage/page.tsx`'s "Cómo se calcula el coste" panel had
  its own hard-coded copy claiming CLI rows "registran tokens a cero y coste
  estimado 0" — a display-layer bug independent of the plumbing above; fixed
  to describe the real mechanism (binary-reported `total_cost_usd`) and the
  OAuth-subscription caveat below.
- New `ErrorCode` entries in `lib/errors.ts`: `CONFLICT`, `RATE_LIMITED`
  (generic, no producer in this change), `LLM_DISABLED` and
  `LLM_QUOTA_EXCEEDED` (reserved for a master kill switch and a CLI
  subscription-quota cap — both deferred follow-up work, not built here).
- New `lib/llm-guard-response.ts` (`classifyGuardError` / `guardErrorResponse`)
  centralises the `BudgetExceededError` → 429 / `CircuitBreakerOpenError` →
  503 mapping that had drifted across four independent call sites
  (`llm-error-payload.ts`, `review/generate`'s two catches,
  `dashboard/gaps`, `dashboard/suggest`). `review/generate` and the
  gaps/suggest routes checked `BudgetExceededError` but never
  `CircuitBreakerOpenError`, so an open breaker fell through their
  generic-`Error` branch to a bare 500 instead of the 503 the
  generate/modify/analyze routes already gave it. Now that the CLI path's
  calls are budget-checked like OpenRouter's, that inconsistency reaches the
  CLI path too, so it was worth closing here rather than deferring it. The
  module is also where a later change adds `LlmDisabledError` /
  `LlmQuotaExceededError` cases so every wired route picks them up at once.

**Alternatives rejected**:
- Leaving `BudgetExceededError` at 429 vs. moving everything to 503 — kept
  429 for the budget cap (an existing, test-locked contract:
  `llm-error-payload.test.ts` asserts 429/`LLM_BUDGET_EXCEEDED`) and used 503
  only for `CircuitBreakerOpenError`, which is the actual "falls to a generic
  500" bug found in this repo. `BudgetExceededError` was never the one
  falling through here.
- Wiring `checkDailyBudget()` into `assembleRequest`/`turn-background.ts` (the
  chat/generate/modify/analyze path) — out of scope for this change; that
  path currently calls neither provider's budget check at all (it's only
  called from `llm.ts`'s weekly-review/gaps/suggest flows). Fixing that is a
  separate, larger change and is left for a follow-up.
- A master `dashboard.llm_enabled` kill switch and a CLI
  subscription-quota poller — explicitly deferred; only the `ErrorCode`
  slots and the `llm-guard-response.ts` extension point are prepared here.

**Rationale**: The CLI provider is the production default. Without real
accounting, every dashboard operation running under it was both financially
invisible and immune to the one configurable safety net. The parser is
deliberately defensive because a version mismatch between the host `claude`
binary (unpinned) and this repo's assumptions about its output shape must
degrade to "unmetered but working," never to "the default provider stops
answering."

**Caveat for the deployed value of `dashboard.llm_daily_budget_usd`**: its
schema default (`config/schema.yaml`) is `null` (no cap), so this change is
inert until an operator sets a real value — nothing changes for a stock
install. But `total_cost_usd` under an OAuth subscription is a notional
list-price figure, not money actually billed, so a dollar cap can halt real
work over imaginary spend; and any budget value ALREADY configured in
production was calibrated back when CLI spend was invisible and ungated — the
day this change deploys, real costs start accruing against it for the first
time, and the dashboard could start returning 429s mid-session. Re-check or
explicitly re-confirm that value at deploy time.

**See**: `dashboard/lib/llm-provider/cli/usage.ts`,
`dashboard/lib/llm-provider/cli/claude-code.ts`,
`dashboard/lib/llm-provider/cli/agent-adapter.ts`, `dashboard/lib/llm-client.ts`,
`dashboard/lib/llm-usage.ts`, `dashboard/lib/llm-context/assemble.ts`,
`dashboard/lib/llm-context/history.ts`, `dashboard/lib/llm-tools/types.ts`,
`dashboard/lib/llm-tools/runner-types.ts`, `dashboard/lib/errors.ts`,
`dashboard/lib/llm-guard-response.ts`, `dashboard/lib/llm-error-payload.ts`,
`dashboard/app/admin/usage/page.tsx`,
`dashboard/app/api/dashboard/{gaps,suggest}/route.ts`,
`dashboard/app/api/review/generate/route.ts`.
