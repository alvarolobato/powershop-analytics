---
id: D-056
title: The dashboard supports DeepSeek, Anthropic and OpenAI — never hardcode one model's behaviour
date: 2026-08-29
---

# D-056: The dashboard supports DeepSeek, Anthropic and OpenAI — never hardcode one model's behaviour

*Decided: 2026-08-29*

**Context**: `ARCHITECTURE.md` and `AGENTS.md` stated the LLM was Claude Sonnet 4.
Production has run `deepseek/deepseek-v4-pro` since 2026-05-13 — for the entire
recorded life of the dashboard, on WrenAI as well. Nobody noticed because the
docs were never checked against `config.yaml`.

That gap produced three real defects, all found on 2026-08-29 while auditing
production conversations:

1. **Cost accounting was wrong by ~15x.** `lib/llm-usage.ts` knew one model's
   rates and silently billed everything else at Claude Sonnet's $3/$15 per Mtok.
   DeepSeek costs a fraction of that, and `checkDailyBudget` was throttling
   against the inflated figure.
2. **Tool-call markup leaked to users as answers.** DeepSeek serialises tool
   calls in its own DSML markup; when OpenRouter failed to parse it,
   `openrouter.ts` saw non-empty text, returned `kind:"final"`, and the raw
   markup was persisted as the answer (production messages `582e0af1`,
   `b0e8a038`, `0cd5c169` — one leaking real data rows, so the tool HAD run).
3. **Free chat was starved at 4096 output tokens** while every other call site
   used 8192. On a reasoning model, reasoning tokens count against `max_tokens`,
   so the budget was spent before any answer was emitted: two turns recorded
   exactly 4096 thinking events, zero token events, then `LLM_EMPTY`.

None of these are DeepSeek bugs. Each is the code assuming one model's
behaviour was universal.

**Decision**: three families are supported targets — DeepSeek, Anthropic,
OpenAI — and the model is configuration, not a constant. Concretely:

1. **Cost comes from the provider.** OpenRouter returns `usage.cost` on every
   response — it never had to be requested. The defect was purely read-side:
   nothing looked at the field. (`usage: { include: true }` is sent anyway to
   make the dependency explicit and keep the richer `cost_details` breakdown
   available, but it is not what fixed the bug.) The figure is stored to the
   full precision of `llm_usage.estimated_cost_usd`, `NUMERIC(14,10)`; the
   Claude CLI's `total_cost_usd` is used the same way. **This must be wired at
   every call site, including the agentic adapter** — `assemble.ts` routes all
   tool-using flows through `runAgenticChat`, so a fix that covers only the
   `llmComplete` paths misses the calls that spend the most. The rate table is a
   fallback only, covers all three families, and its unknown-model default sits
   *between* the families rather than at the most expensive one, so an unknown
   model is wrong by a bounded factor in either direction.
2. **No single tool-call dialect may be assumed.** `looksLikeFabricatedToolLog`
   matches DeepSeek, Anthropic, OpenAI and the common Llama/Mistral/Qwen forms.
   Adding a family means adding its dialect and a test.
3. **Output budgets are configurable, never hardcoded**
   (`dashboard.chat_max_output_tokens`), because the right value depends on how
   verbose the configured model's reasoning is.
4. **Docs state that the model is configuration** and name the production value,
   rather than naming a model as if it were fixed.

**Alternatives rejected**:
- *Standardise on one model.* Would make the code simpler and is explicitly not
  what is wanted — the owner requires all three.
- *Keep a hand-maintained price table as the source of truth.* Cannot track
  three vendors' pricing; this is what produced the 15x error.
- *Detect the model and branch.* Model-sniffing spreads family-specific
  assumptions instead of removing them. The guards above are written to be
  correct for any model, which is why the markup detector matches every dialect
  rather than only the configured one.

**Rationale**: Every one of the three defects was invisible in normal
operation — no error, no log line, a plausible-looking answer or a plausible
cost figure. Assumptions about "the model" do not announce themselves when they
break.

**See**: `dashboard/lib/llm-usage.ts`, `dashboard/lib/llm-provider/openrouter.ts`
(`openRouterExtras`, `extractOpenRouterCost`),
`dashboard/lib/llm-provider/openrouter.ts` (`createOpenRouterAgenticAdapter`,
`readOpenRouterCacheTokens`), [D-019](D-019-pluggable-llm-providers.md).

Rules 2 and 3 are implemented by separate changes landing alongside this one
(the tool-markup guard and the configurable output budget); this record states
the standing rule, and the symbols that implement it are named in those
records rather than here, so this file does not reference code that may not be
present yet.
