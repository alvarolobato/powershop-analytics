# DECISIONS.md — Decision index

> **Purpose.** One-line binding rules so agents don't re-evaluate settled decisions. Full rationale, alternatives, and incident context live in `docs/decisions/D-NN-<slug>.md` — read those when you need the *why*.
>
> **Adding a new decision.** Write a one-liner here (binding rule, ≤180 chars) + a full file in `docs/decisions/`. See [AGENTS.md § Recording decisions](AGENTS.md#recording-decisions).
>
> **Do not pick the ID by reading this file** when other work is in flight. Two branches that each take "the next free one" write files differing only by slug, so git merges them with no conflict and the duplicate stays invisible — which is exactly how three branches once landed on `D-042` together. Use the range reserved for your workstream: [AGENTS.md § Decision IDs](AGENTS.md#decision-ids-reserve-a-range-dont-pick-a-number). Append your line **inside your group's heading**, never at the end of the file, so two agents touch different regions.
>
> Files in this index are kept terse on purpose. Don't expand entries — expand the per-decision file instead.

## AI Factory — policy and lifecycle

| ID | Binding rule |
|----|--------------|
| [D-011](docs/decisions/D-011-ai-factory-on-claude-code.md) | The AI Factory uses `anthropics/claude-code-action` (single LLM vendor); CLAUDE.md/AGENTS.md are the agent's context. |
| [D-012](docs/decisions/D-012-no-reusable-workflows.md) | Build workflows in-repo. Don't extract to a reusable-action library until there's a second consumer. |
| [D-013](docs/decisions/D-013-humans-approve-merges.md) | Humans approve PR merges. No auto-merge for AI-generated PRs until trust is established per area. |
| [D-014](docs/decisions/D-014-label-driven-ai.md) | `ai-work` triggers the worker; `ai-blocked` pauses it; `no-ai` excludes the issue; priority labels (`p0`/`p1`/`p2`/`p3`) order work. |
| [D-021](docs/decisions/D-021-two-review-rounds.md) | Every PR gets exactly two review rounds, each once: Copilot, then Opus from a clean Claude Code context. No third round; escalate to owner if blocked. |
| [D-028](docs/decisions/D-028-weekly-business-review.md) | Weekly business-review issues carry `needs-human-approval` and never `ai-work` — the factory may triage and plan, never implement, until a human authorises. |
| [D-029](docs/decisions/D-029-no-worker-workflows.md) | The worker (and any claude-code-action job) must NOT write under `.github/workflows/`. Propose YAML in the PR body for a human commit. |
| [D-030](docs/decisions/D-030-watchdog-cadence.md) | Watchdog cron is `*/30` + `pull_request_review:[submitted]` + `pull_request:[closed]` to compensate for GitHub schedule queue saturation. |
| [D-031](docs/decisions/D-031-copilot-opus-sequencing.md) | `ai-pr-review.yml` fires only on `labeled:ai-ready-for-review`. Strict order: Copilot → address → Opus → address → owner-merge. No `\|\| true` on critical dispatches. |
| [D-033](docs/decisions/D-033-opus-review-marker.md) | Opus head-SHA idempotency requires `(.body \| length) > 0` (inline replies have empty body). Workflow runs matched by `display_title` via top-level `run-name`, never `head_sha` or `.inputs.*`. |
| [D-034](docs/decisions/D-034-single-track-issues.md) | Single-track issues by default (phases in body, one PR per phase). `ai-plan` for plan-only checkpoint; `ai-decompose` opts into sub-issues. Internal labels renamed `fact-*`. |
| [D-035](docs/decisions/D-035-action-required-bot-gating.md) | GitHub gates `pull_request_review` runs as `action_required` for the `Copilot` actor; use `*/30` cron watchdog via `workflow_dispatch` as the recovery path. |
| [D-037](docs/decisions/D-037-multi-phase-no-auto-close.md) | Multi-phase issues never auto-close from a non-final phase. Non-final-phase PRs MUST use `Part of #N (Phase X of Y)` — never `Closes/Fixes/Resolves`. Three-layer defense: worker self-check + CI gate + post-merge reopen. |
| [D-038](docs/decisions/D-038-llm-ec-validation.md) | EC validator: shell scripts judge (verified/not); LLM scribes (formats comment). Never let the LLM decide "verified". Model: `claude-haiku-4-5-20251001`. Labels: `ai-validate-ec`, `fact-awaiting-human-validation`. |
| [D-039](docs/decisions/D-039-fact-label-vocabulary.md) | Review-state labels are `fact-*` (only `ai-awaiting-owner` stays `ai-*`); `config.yml` must match the workflows (it's dumped verbatim into the factory-manager prompt). `owner_handoff_or_ci_gate` strips `ai-awaiting-owner` only on CI `failing`, never on transient `running`/`unknown`. |

## Runtime / infrastructure

| ID | Binding rule |
|----|--------------|
| [D-002](docs/decisions/D-002-bind-mounts.md) | All container data lives in `./data/<svc>/` bind mounts. Never named volumes. |
| [D-005](docs/decisions/D-005-qdrant-no-recreate.md) | `recreate_index: false` in `wren-config.yaml`. Collections and embeddings must survive restarts. |
| [D-006](docs/decisions/D-006-openrouter-embeddings.md) | WrenAI embeddings use `openai/text-embedding-3-large` + `OPENAI_API_BASE=https://openrouter.ai/api/v1`. The `openrouter/` prefix breaks embeddings under litellm. |
| [D-007](docs/decisions/D-007-wrenai-restart-loop-fix.md) | Don't set `SHOULD_FORCE_DEPLOY` on wren-ai-service. Deploy via `scripts/wren-push-metadata.py`. |
| [D-016](docs/decisions/D-016-etl-manual-trigger-table.md) | Dashboard signals manual ETL syncs via the PostgreSQL `etl_manual_trigger` table — never via an HTTP endpoint on the ETL container. |
| [D-020](docs/decisions/D-020-force-resync.md) | Force-resync writes `force_full` / `force_tables` to `etl_manual_trigger`; scheduler resets watermarks (from a single allow-list) before the run. |
| [D-023](docs/decisions/D-023-central-config-yaml.md) | All settings live in `~/.config/powershop-analytics/config.yaml`. Precedence: env var > config.yaml > default. Schema is `config/schema.yaml`. |
| [D-055](docs/decisions/D-055-config-keys-must-be-read.md) | A key declared in `config/schema.yaml` must be read via `getSystemConfig()`, never `process.env` alone; read env first, then the loader (its mtime cache would otherwise invert D-023). |
| [D-024](docs/decisions/D-024-surface-cli-errors.md) | CLI/agentic failures must surface a sanitized `diagnostic` (provider/driver/model/phase/duration/tool/CLI tail). All free-form strings pass through `dashboard/lib/llm-provider/sanitize.ts`. |
| [D-025](docs/decisions/D-025-oauth-single-refresher.md) | Only the host `claude` CLI ever refreshes the OAuth token. The launchd agent only mirrors the macOS Keychain into `~/.claude/.credentials.json`. Never POST to the OAuth endpoint from code. |
| [D-042](docs/decisions/D-042-otel-head-sampling.md) | ETL/dashboard use SDK head sampling (`parentbased_traceidratio`, default 0.1); the pinned elastic-agent collector lacks `tail_sampling`/`zpages` — don't re-add without switching images. |

## Data / ETL

| ID | Binding rule |
|----|--------------|
| [D-001](docs/decisions/D-001-postgres-mirror.md) | Analytics queries hit a PostgreSQL mirror. Never touch the live 4D ERP from analytics paths. ETL is the only writer to the mirror. |
| [D-003](docs/decisions/D-003-single-select-no-offset.md) | For 4D tables < 2M rows, use a single SELECT — never LIMIT/OFFSET (4D re-scans from row 0 at each offset). |
| [D-004](docs/decisions/D-004-stock-sync-per-store.md) | Stock sync fetches one store at a time (`WHERE Tienda='X'`). 50 stores × ~80s. Don't fetch the full Exportaciones table. |
| [D-015](docs/decisions/D-015-schema-from-4dc.md) | Schema discovery uses string extraction on `PowerShop.4DC` + live `_USER_VIEWS` / `_USER_COLUMNS` queries. Don't rely on PowerShop install file trees alone. |
| [D-017](docs/decisions/D-017-signed-int16-stock.md) | Apply `decode_signed_int16_word()` ONLY to `Exportaciones.Stock1..Stock34` (and `CCStock.Stock1..Stock34`) — the type-3/length-2 columns. Never on Real (type-6) columns. |
| [D-050](docs/decisions/D-050-upsert-batch-loss.md) | `upsert()` pre-filters NULL/NaN-PK rows, falls back to row-by-row SAVEPOINT inserts on batch failure, and raises if zero rows survive — never a quiet 0-row "ok". |
| [D-051](docs/decisions/D-051-fetch-anomaly-guard.md) | `safe_fetch()` scans every fetch for decode-corruption-shaped rows and refetches once to discriminate transient corruption from real data; evidence goes to `etl_fetch_anomalies`, never the D-050 skip log. |

## WrenAI knowledge

| ID | Binding rule |
|----|--------------|
| [D-008](docs/decisions/D-008-wrenai-knowledge-indexing.md) | After writing instructions/SQL-pairs to SQLite, POST them to wren-ai-service `/v1/instructions` and `/v1/sql-pairs` to index into qdrant. `deploy(force:true)` only indexes schema. |
| [D-009](docs/decisions/D-009-is-default-merge.md) | Source knowledge entries use `is_default=1`. The push script only deletes/rewrites `is_default=1`. User entries (`is_default=0`) are never touched. |

## Dashboard App

| ID | Binding rule |
|----|--------------|
| [D-010](docs/decisions/D-010-custom-dashboard-generator.md) | Dashboard App is custom Next.js + Tremor (LLM generates a dashboard JSON spec). Don't try to retrofit Metabase / Evidence / ToolJet. |
| [D-018](docs/decisions/D-018-agentic-tools.md) | `generate`/`modify`/`analyze` use a backend-controlled tool loop via OpenRouter `chat.completions`. Read-only SQL only. Tool catalog + limits in `dashboard/lib/llm-tools/runner.ts`. |
| [D-019](docs/decisions/D-019-pluggable-llm-providers.md) | Dashboard LLM provider is `openrouter` or `cli` (selected by `DASHBOARD_LLM_PROVIDER`). CLI path uses argv-array spawn + JSON tool-step protocol. |
| [D-022](docs/decisions/D-022-dashboard-redesign.md) | Dashboard chrome is token-driven (CSS variables on `<html>` data-attrs). New widgets/components go through the redesign tokens, not Tremor defaults. |
| [D-026](docs/decisions/D-026-home-page-inicio.md) | `/inicio` is a read-only home — no chat, no save flow, no Analizar launcher. Filters are implicit via `CURRENT_DATE`/`DATE_TRUNC`. Not a user-pickable template. |
| [D-027](docs/decisions/D-027-inicio-redesign.md) | `/` (root) renders the new home; dashboard list moved to `/paneles`. Home is bespoke React, not `DashboardRenderer`-driven. |
| [D-032](docs/decisions/D-032-free-chat-tools.md) | Free-chat uses `FREE_CHAT_TOOLS` (10 inspection + `start_dashboard_generation` + `set_title` = 12). `set_title` is idempotent (`AND title IS NULL`). Full write tools in `FULL_DASHBOARD_TOOLS`. Handoff via `POST /api/conversations/:id/handoff-to-dashboard`. |
| [D-036](docs/decisions/D-036-llm-context-centralization.md) | All dashboard LLM calls must go through `assembleRequest()` in `dashboard/lib/llm-context/`. No file outside that directory may import `llmComplete` or `runAgenticChat` directly; CI enforces this. |
| [D-040](docs/decisions/D-040-context-log-files.md) | Per-turn context logs (exact payload sent to the LLM) live in files at `<DASHBOARD_CONTEXT_DIR>/<convId>/<turnId>.json` (bind mount); Postgres stores only the `conversation_turns.context_file` pointer. UI lazy-loads on expand; writes best-effort. |
| [D-041](docs/decisions/D-041-e2e-required-for-features.md) | Every PR adding or modifying a user-facing dashboard surface must ship a Playwright e2e test asserting no error surface against seeded Postgres. PRs without one are not mergeable for those areas. |
| [D-043](docs/decisions/D-043-cli-usage-metering-and-budget.md) | CLI-provider calls log real token/cost accounting (`--output-format json`, `total_cost_usd`) at every call site; `checkDailyBudget` applies to every provider, not just OpenRouter. |
| [D-044](docs/decisions/D-044-mobile-breakpoint-and-pad-x-token.md) | Mobile breakpoint is Tailwind's `md:` (768px); Tailwind owns display/visibility only, inline styles own everything else; horizontal padding shrink goes through one `--pad-x` token declared unconditionally at `:root`. |
| [D-045](docs/decisions/D-045-title-generation-contract.md) | Titles use the first user message, clamped to 100 chars; failures log, never throw. `buildSystemPrompt` is exhaustive over `LLM_FLOWS` — no silent fallback onto `chat`'s tools. |
| [D-046](docs/decisions/D-046-cli-lean-mode-and-kill-switch.md) | CLI calls strip the harness (`dashboard.llm_cli_lean_mode`, default true); only vars-independent flows put `stable` on `--system-prompt` (`CLI_SYSTEM_PROMPT_SAFE_FLOWS`). `dashboard.llm_enabled` stops every LLM call at the two `assembleRequest`/`llmComplete` seams; `checkDailyBudget` runs once, pre-flight, in `assembleRequest`. |
| [D-047](docs/decisions/D-047-diagnosable-failures.md) | Every route tree carries an `error.tsx` (+ root `global-error.tsx`); tool handlers log the real error object before returning the generic one; `/api/query` failures persist to `query_errors`. Container stdout dies on deploy — Postgres is the only durable trace. |
| [D-049](docs/decisions/D-049-async-dashboard-generation-tool.md) | `start_dashboard_generation` never awaits `generateDashboard()` inline — it starts it detached and reports back via a tracking turn + turn_events/SSE + a persisted assistant message. Never raise the shared per-tool `toolTimeoutMs` to work around a single long tool. |
| [D-052](docs/decisions/D-052-dashboard-otel-sdk.md) | Dashboard's OTel SDK (traces+logs, `dashboard/lib/otel/`) must fail open on any error and never set a `DiagConsoleLogger` — the console bridge must not feed the SDK's own diagnostics back into itself. |
| [D-053](docs/decisions/D-053-no-fabricated-tool-logs.md) | A turn whose text carries raw provider tool markup, or tool-log shape with zero real tool calls, must fail — never persist as `complete`. |
| [D-056](docs/decisions/D-056-multi-model-support.md) | DeepSeek, Anthropic and OpenAI are all supported. Cost comes from the provider (never a rate table), no single tool-call dialect may be assumed, output budgets are configurable. |
