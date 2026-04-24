# DECISIONS-AND-CHANGES.md — Decision Log and Changelog

> Every significant architectural decision and change is recorded here with rationale. Agents and developers MUST read this before proposing changes and MUST update it after making changes. Entries are reverse-chronological (newest first).

## Decision Log

### D-020: Dashboard redesign — token-driven "data newsroom" visual system — 2026-04-24
**Context**: Issue #404 — visual redesign to a dark-first, hierarchy-driven "data newsroom" layout.
**Decision**: Implement a CSS variable token layer (`--bg`, `--fg`, `--accent`, `--up`/`--down`/`--warn`) on the `html` element with `data-theme`/`data-accent`/`data-density`/`kpiStyle` attributes. Replace the Tremor-centric sidebar layout with a sticky 56px TopBar. Re-skin all widgets (KPI editorial cards with sparklines and anomaly rings, custom SVG charts, ranked bar chart, table heat cells). Add LogBlock streaming transparency to chat sidebar. Add TweaksPanel for theme/accent/density control.
- **Phases A-D**: Tokens, TopBar, widget re-skin (KpiRow, BarChart, LineChart, AreaChart, DonutChart, Table, InsightsStrip, RankedBars, Sparkline), Panel chrome.
- **Phases E-H**: ChatSidebar rebuilt with two independent message histories + suggestion chips; LogBlock component (streaming + collapsed); AnalyzeLauncher floating rail; TweaksPanel with 4 radio groups; `chat_messages_modify` DB column + API wiring; `docs/skills/dashboard-redesign.md` skill.
**Rationale**: Token-driven theming avoids hardcoded Tailwind class switches; CSS variable swaps are instant. The "data newsroom" hierarchy matches the retail sales manager's morning scan pattern (KPIs → anomalies → drivers → trends). TweaksPanel gives power users control without cluttering the main UI.
**See**: `dashboard/app/globals.css` (tokens), `dashboard/components/TopBar.tsx`, `dashboard/components/TweaksPanel.tsx`, `dashboard/components/LogBlock.tsx`, `dashboard/components/ChatSidebar.tsx`, `dashboard/components/AnalyzeLauncher.tsx`, `docs/skills/dashboard-redesign.md`.

### D-019: Pluggable Dashboard LLM providers (OpenRouter API vs CLI) — 2026-04-23
**Context**: Issue #394 — the Dashboard App hard-coded OpenRouter; teams with a flat-rate Claude Code subscription wanted the same flows without forcing per-token API spend.
**Decision**:
- Introduce `DASHBOARD_LLM_PROVIDER=openrouter|cli` with **per-backend model** envs (`DASHBOARD_LLM_MODEL_OPENROUTER`, `DASHBOARD_LLM_MODEL_CLI`; legacy `DASHBOARD_LLM_MODEL` still applies as fallback for both).
- **OpenRouter path**: unchanged semantics — OpenAI SDK + `OPENROUTER_API_KEY`, native `chat.completions` function calling for agentic flows.
- **CLI path**: generic `spawn` runner (`dashboard/lib/llm-provider/cli/process.ts`) + **driver** `DASHBOARD_LLM_CLI_DRIVER=claude_code` using `claude -p` / `--model`. Agentic rounds use a **JSON-only step protocol** (`kind: final|tools`) so the same `llm-tools/runner.ts` loop drives tools; handlers stay unchanged.
- **Telemetry**: `llm_usage` and `llm_tool_calls` gain `llm_provider` + `llm_driver`; CLI rows log **zero** `estimated_cost_usd`. Daily budget (`LLM_DAILY_BUDGET_USD`) sums **OpenRouter-estimated** spend only (`llm_provider = 'openrouter'`).
- **Extensibility**: new CLI drivers implement the same `AgenticModelAdapter` + single-shot helpers without touching API route business logic.
**Alternatives rejected**: Shell-string CLI invocation (injection risk); dropping agentic support on CLI (would regress generate/modify/analyze).
**Rationale**: Read-only SQL policy remains in tool handlers; argv-array spawning + timeouts + stdout caps bound operational risk.
**See**: `dashboard/lib/llm-provider/*`, `dashboard/lib/llm.ts`, `dashboard/lib/llm-tools/runner.ts`, `.env.example`, [docs/dashboard-agentic-tools.md](docs/dashboard-agentic-tools.md).

### D-018: Native tool-calling (agentic) for Dashboard LLM flows — 2026-04-22
**Context**: Issue #384 — `generate`, `modify`, and `analyze` were single-shot: the model could not iterate with read-only SQL or saved-dashboard context before answering.
**Decision**:
- Use OpenRouter `chat.completions` with `tools` + `tool_choice: auto` and a **backend-controlled loop** (`dashboard/lib/llm-tools/runner.ts`).
- **Mandatory** for the three flows when `DASHBOARD_AGENTIC_TOOLS_ENABLED` is true (default); when `false`, keep the prior single-shot path (operational kill switch).
- **No silent fallback** if the agentic runner throws (limits, empty final message) — APIs return `AGENTIC_RUNNER` with structured details.
- **Catalog (MVP)**: `validate_query`, `execute_query`, `explain_query`, `list_ps_tables`, `describe_ps_table`, `list_dashboards`, `get_dashboard_spec`, `get_dashboard_queries`, `get_dashboard_widget_raw_values`, `get_dashboard_all_widget_status`.
- **Limits** (env-tunable, defaults per issue): 4 tool rounds, 12 tool calls/request, 15s timeout per tool, execute capped at 200×30 cells, 20k chars per tool JSON payload to the model.
- **Telemetry**: every tool invocation inserts into PostgreSQL `llm_tool_calls`; admin GET `/api/admin/tool-calls` returns 30-day aggregates.
**Alternatives rejected**: Single-shot with RAG-only context (cannot validate live SQL); client-side tool execution (security/compliance).
**Rationale**: Read-only policy stays centralized in `db.ts` / `query-validator` / `sql-heuristics`; the model can self-correct before emitting final JSON or markdown.
**See**: [docs/dashboard-agentic-tools.md](docs/dashboard-agentic-tools.md), `dashboard/lib/llm-tools/*`, `etl/schema/init.sql` (`llm_tool_calls`).

### D-017: Signed 16-bit `Exportaciones.StockN` over 4D SQL / p4d — 2026-04-22
**Context**: Dashboard stock KPIs showed hundreds of millions of units; investigation showed `ps_stock_tienda.stock = 65535` while PowerShop POS showed `−1` for the same slot, with `CCStock` (Real) matching the signed row total. Users asked whether metadata and a “native 4D” path exist.
**Evidence**:
- Live **`_USER_COLUMNS`**: all **`Exportaciones.Stock1`…`Stock34`** are **`DATA_TYPE = 3`**, **`DATA_LENGTH = 2`** (16-bit integer). **`CCStock`** is **`DATA_TYPE = 6`** (Real, length 8). **`LineasVentas.Unidades`** and **`Traspasos.UnidadesS/E`** are **Real (6/8)** in the catalog — not 16-bit slots.
- Cross-check **4D SQL** (`ps sql query`) returns the same `65535` values the ETL saw; the UI uses native 4D types and shows negatives.
- Local **PowerShop Server / PSClient** file trees (e.g. install bundles) contain **compiler/resources** (XLF mentions `WORD` types) but **not** `.4DProject` field lists — **not** a substitute for `_USER_COLUMNS` on the server.
**Decision**: Implement **`decode_signed_int16_word()`** in `etl/db/fourd.py`: for integers in ``32768..65535``, subtract **65536** (exact signed-int16 reinterpretation of the low 16 bits — **not** a domain heuristic). Call **only** when normalizing **`Exportaciones.Stock1`…`Stock34`**, because **`_USER_COLUMNS`** alone marks those as **`DATA_TYPE = 3`**, **`DATA_LENGTH = 2`**. **Do not** apply to **`LineasVentas.Unidades`** or **`Traspasos.UnidadesS/E`** (catalog: **Real**, type 6) or to wholesale **`GCLin*`** line quantities (can exceed 32767) — see `mayorista.py` note.
**Alternatives rejected**: Relying on a `p4d.connect()` option (none exposed for type coercion). Fixing only in dashboards (would leave raw mirror wrong for WrenAI/SQL). Guessing additional columns without type-3/length-2 proof.
**Rationale**: 4D “knows” the type from the **structure**; the bug is at the **SQL wire representation**. The decode rule is **metadata-driven** (which columns) + **bit-accurate** (how to convert).
**See**: `etl/db/fourd.py`, `etl/sync/stock.py`, [docs/skills/4d-sql-dialect.md](docs/skills/4d-sql-dialect.md), [docs/skills/data-access.md](docs/skills/data-access.md), [docs/architecture/stock-logistics.md](docs/architecture/stock-logistics.md).

### D-016: Proposed PostgreSQL trigger table for manual ETL sync — 2026-04-18
**Context**: Issue #271 defines a "Sincronizar ahora" button for the ETL Monitor dashboard page.
The button needs to signal the ETL container (a pure Python scheduler with no HTTP API) to start an out-of-schedule sync.
**Proposed design**: Use a PostgreSQL `etl_manual_trigger` table. Dashboard writes a `pending` row; ETL polls the table every 10 s and atomically picks it up (`FOR UPDATE SKIP LOCKED`).
**Alternatives rejected**:
- ETL HTTP endpoint: requires adding Flask/aiohttp, exposing a new port in docker-compose, and handling concurrency in a single-threaded scheduler process.
- Shared filesystem flag file: fragile across container restarts, no atomicity.
**Rationale**: PG is already the shared state store for both containers. No new deps, no new ports, idempotent polling, single source of truth.
**Status**: Not yet implemented. The `etl_manual_trigger` table/DDL is not present in `etl/schema/init.sql`; the dashboard write and ETL polling flow are planned work tracked in issue #271.

### D-015: Deep schema extraction from application server files — 2026-04-05
**Context**: Issue #142 identified gaps in our data model knowledge. A copy of the production application server, client, and database files became available locally.
**Decision**: Perform string extraction on the compiled `.4DC` structure file (360 MB) and query all SQL views (`_USER_VIEWS`) directly from the live server.
**Findings**:
- 5.7M string lines extracted from `PowerShop.4DC` — yielded 324 confirmed tables, 2,522+ field names, 130 WS_JS_* SOAP methods
- 100 SQL views discovered (`_USER_VIEWS`): 50 `*_SQL` + 50 `*_BI` — vendor's intended query patterns
- `Exportaciones_SQL` confirmed 34 stock slots (Stock1-34, Talla1-34), not 17 as partially documented
- `Ventas_SQL` has 150 columns including TBAI, marketplace, tax-free, Aena airport, SAF-T fiscal fields
- `Tiendas_SQL` has 208 columns including per-store accounting codes, Aena airport concession rents, store groupings
- `GCLinPedidos_SQL` has 239 columns: 34-slot × 5 quantity dimensions (Pedidas/Entregadas/Asignadas/Original/Talla)
- `FamiGrupMarc.SERIETALLAS` maps product family to size series — key for interpreting the 34-slot matrix
- 10 new business modules discovered: airport/Aena, B2B/B2C e-commerce, jewelry/couture manufacturing, RFID, TicketBAI, corners/concessions, ADIDAS data feeds, SAF-T, CRM/marketing
**Rationale**: String extraction from compiled binaries is non-destructive and yields the same schema information as `EXPORT STRUCTURE` XML without vendor cooperation. SQL views are readable via the standard p4d SQL driver.
**See**: [sql-views.md](docs/sql-views.md), [schema-discovery.md](docs/schema-discovery.md), GitHub issue #142.

### D-014: Label-driven AI execution — 2026-04-05
**Context**: Need a mechanism for humans to control which issues AI works on.
**Decision**: Label `ai-work` triggers Claude Code Worker. Label `ai-blocked` pauses. Priority labels (`p0-critical`, `p1-high`, `p2-medium`, `p3-low`) control order. `no-ai` excludes from AI processing.
**Rationale**: Simple, visible, auditable. Human adds label = human approves AI work. See epic #121.

### D-013: Human-in-the-loop for merges (initially) — 2026-04-05
**Context**: Could enable full auto-merge for AI-generated PRs.
**Decision**: Start with human approval required for merge. Add auto-merge for low-risk PRs (docs, deps) after trust is established.
**Rationale**: Safety first. The product handles business data. Build trust incrementally.

### D-012: Custom workflows instead of reusable action library — 2026-04-05
**Context**: GitHub Actions reusable workflow libraries (`uses: org/repo/.github/workflows/x.yml@ref`) let teams share workflow templates across repos.
**Decision**: Build AI Factory workflows directly in this repo. Extract to a reusable library later if we end up with a second consumer.
**Rationale**: We have ~20 workflows, all project-specific. Premature extraction adds indirection and a second repo to maintain. Keep it simple until patterns stabilize.

### D-011: AI Factory with Claude Code as primary agent — 2026-04-05
**Context**: Need an autonomous development pipeline where scheduled agents discover work, an implementation agent fixes it, and review/deployment agents close the loop. Need to choose the AI engine.
**Decision**: Build an AI Factory using Claude via `anthropic/claude-code-action` GitHub Action. 20 workflows across 6 phases: Foundation, PR Lifecycle, Issue Lifecycle, Discovery Agents, Deployment, Refinement.
**Alternatives considered**: GitHub Copilot SWE Agent, hybrid Copilot+Claude, Google Gemini CLI action.
**Rationale**: Claude is already our LLM for WrenAI and Dashboard App — single vendor, single billing, single rate limit. Claude Code Action is production-ready and reads `CLAUDE.md`/`AGENTS.md` automatically, so the extensive project context we already maintain carries over for free. See epic #121 and [docs/ai-factory.md](docs/ai-factory.md).

### D-010: Build custom AI dashboard generator (Option B) — 2026-04-04
**Context**: WrenAI excels at single text-to-SQL queries but cannot generate multi-widget dashboards. Business users need to describe dashboards in natural language and get complete panels.
**Decision**: Build a custom Next.js + Tremor dashboard app that uses the LLM to generate dashboard JSON specs.
**Alternatives rejected**:
- Metabase: No "one prompt → full dashboard" capability. Metabot generates chart-by-chart only.
- Metabase + custom LLM layer (hybrid): Too much coupling complexity for the benefit.
- Evidence.dev: Requires SQL+Markdown writing — not suitable for non-technical users.
- ToolJet: AI features are Enterprise-only (not open source).
**Rationale**: Only custom build delivers the core requirement. We have all the building blocks: 52 SQL pairs, 40 instructions, PostgreSQL with 18M rows, OpenRouter with Claude Sonnet 4. See issue #69 for full analysis.

### D-009: Production knowledge merge strategy (is_default flag) — 2026-03-31
**Context**: When pushing source knowledge to production WrenAI, we must not delete user-created instructions/SQL pairs.
**Decision**: Source entries use `is_default=1` in SQLite. Script deletes only `is_default=1` before re-inserting. User entries (`is_default=0`) are never touched. SQL pairs use question-text matching.
**Rationale**: Simple, robust, no schema changes needed. See issue #66.

### D-008: WrenAI instructions + SQL pairs require AI service API calls — 2026-03-31
**Context**: `deploy(force: true)` only indexes schema (Documents + table_descriptions) into qdrant. Instructions and SQL pairs in SQLite are NOT automatically indexed.
**Decision**: After SQLite writes, POST to `/v1/instructions` and `/v1/sql-pairs` on the AI service (port 5555) to index into qdrant.
**Rationale**: Discovered empirically. WrenAI's deploy mutation only handles schema embedding.

### D-007: WrenAI restart loop fix (remove SHOULD_FORCE_DEPLOY) — 2026-03-31
**Context**: The wren-ai-service entrypoint waits for wren-ui on `WREN_UI_PORT` (unset), times out after 60s, exits 1, container restarts, queries get lost mid-processing.
**Decision**: Remove `SHOULD_FORCE_DEPLOY` env var. Deploy via `scripts/wren-push-metadata.py` instead of entrypoint auto-deploy.
**Rationale**: Eliminates the restart loop. Deploy is now explicit and reliable.

### D-006: OpenRouter embedding routing — 2026-03-31
**Context**: litellm does not support `openrouter/` prefix for embeddings, only for chat completions.
**Decision**: Use `openai/text-embedding-3-large` model name with `OPENAI_API_BASE=https://openrouter.ai/api/v1`. litellm routes it correctly via the base URL.
**Rationale**: The `openrouter/` prefix causes "Unmapped LLM provider" error for embeddings. The `openai/` prefix with OpenRouter base URL works.

### D-005: Qdrant recreate_index: false — 2026-03-31
**Context**: `recreate_index: true` in wren-config.yaml wiped all qdrant collections on every service restart, losing all indexed schema/instructions.
**Decision**: Set `recreate_index: false`.
**Rationale**: Collections and embeddings must survive restarts.

### D-004: Progressive stock sync by store — 2026-03-31
**Context**: Exportaciones has 2M rows. Single SELECT caused OOM. LIMIT/OFFSET was 51 hours (4D re-scans from row 0 at each offset).
**Decision**: Fetch one store at a time (`WHERE Tienda = 'X'`). 50 stores × ~41K rows × ~80s = ~67 min total.
**Rationale**: Each store fits in memory. No LIMIT/OFFSET needed. Total time is reasonable.

### D-003: Single SELECT instead of LIMIT/OFFSET for 4D — 2026-03-31
**Context**: LIMIT/OFFSET on 4D is catastrophically slow for large tables because 4D re-scans all preceding rows at each offset.
**Decision**: For tables <2M rows (Ventas 911K, LineasVentas 1.7M), use single SELECT. p4d buffers the full result set in memory.
**Rationale**: 911K rows fetched in 15 min (single query) vs estimated 51 hours (LIMIT/OFFSET at 5K batches). Memory cost (~500MB) is acceptable.

### D-002: Bind mount volumes instead of named Docker volumes — 2026-03-31
**Context**: Named Docker volumes are anonymous — data lost if pruned or compose recreated.
**Decision**: All data in `./data/postgres/`, `./data/qdrant/`, `./data/wren/` bind mounts.
**Rationale**: Data survives `docker compose down` and is visible on the host filesystem. Migration script provided for existing named volumes.

### D-001: PostgreSQL mirror + WrenAI for analytics — 2026-03-30
**Context**: PowerShop ERP runs on 4D database (vendor-managed, production). Need analytics without impacting the ERP.
**Decision**: ETL extracts to PostgreSQL mirror. WrenAI (text-to-SQL) queries the mirror.
**Rationale**: 4D has no Linux ODBC driver, REST API disabled, SOAP is limited. P4D SQL driver works but is slow and production-critical. PostgreSQL is fast, well-supported, and WrenAI has native connector.

---

## Changelog

### 2026-04-24
- Dashboard redesign Phases E-H (D-020): ChatSidebar rebuilt with two independent message histories, suggestion chips, LogBlock streaming; AnalyzeLauncher floating rail; TweaksPanel (theme/accent/density/kpiStyle); `chat_messages_modify` DB column + API route; `docs/skills/dashboard-redesign.md` skill added.

### 2026-04-23
- Dashboard LLM: OpenRouter vs Claude Code CLI provider abstraction (issue #394, D-019); `llm_usage` / `llm_tool_calls` provider columns; admin usage aggregates by provider.

### 2026-04-22
- Dashboard App (issue #384): agentic OpenRouter tool-calling for `POST /api/dashboard/generate|modify|analyze` with SQL + dashboard context tools, hard limits, `llm_tool_calls` telemetry, admin aggregates — D-018; see [docs/dashboard-agentic-tools.md](docs/dashboard-agentic-tools.md)
- ETL: `decode_signed_int16_word()` **only** for `Exportaciones.Stock1..Stock34` (`_USER_COLUMNS` type 3, length 2); D-017 tightened — no decode on Real-typed quantity columns
- Docs: AGENTS.md, `docs/skills/4d-sql-dialect.md`, `docs/skills/data-access.md`, `docs/architecture/stock-logistics.md`, `docs/etl-sync-strategy.md` — `_USER_COLUMNS` evidence, SQL vs native 4D, PowerShop file-tree limits

### 2026-04-18
- Documented D-016 for Dashboard ETL Monitor manual sync design via PostgreSQL `etl_manual_trigger` table (issue #271)

### 2026-04-05
- AI Factory design: 20 workflows across 6 phases for autonomous development (D-011 through D-014)
- Created [docs/ai-factory.md](docs/ai-factory.md) with full architecture, workflow catalog, and design decisions
- Created epic #121 and 20 implementation issues (#122-#141)
- Labels: `ai-factory`, `phase-f1` through `phase-f6`
- Deep schema extraction from compiled `.4DC` file and SQL views (D-015)
- Discovered 100 SQL views (`_USER_VIEWS`) — vendor's intended query patterns
- Created `docs/sql-views.md` — complete SQL views reference
- Updated `docs/schema-discovery.md` with multi-source extraction methods
- Updated architecture docs (sales.md, wholesale.md, stores-hr.md) with view-confirmed schemas
- Updated ARCHITECTURE.md with confirmed table row counts and Exportaciones 34-slot clarification
- Key corrections: Exportaciones has 34 stock slots (not 17), GCLinPedidos has 5-dimension 34-slot matrix

### 2026-04-04
- Created ARCHITECTURE.md and DECISIONS-AND-CHANGES.md
- Created epic and issues for Dashboard App (AI-driven dashboard generator)
- Created agent skills for specialized development work

### 2026-03-31
- WrenAI fully operational: 40 instructions, 52 SQL pairs, 107 column descriptions
- Fixed: restart loop (D-007), embedding routing (D-006), recreate_index (D-005)
- Fixed: `entrada` field location instruction, pivot query guidance, dashboard prompt handling
- Knowledge management: production merge strategy with `is_default` flag (D-009)
- CLI: `ps wren push/validate/status` commands
- PostgreSQL optimization: 15 indexes, 10 FK constraints, ANALYZE
- Volume migration: named volumes → bind mounts under `./data/`
- ETL complete: 18M+ rows across 26 tables (Stock 12.3M, Ventas 911K, LineasVentas 1.7M)

### 2026-03-30
- Initial WrenAI integration plan created (19 issues, 6 phases)
- ETL scaffold, all sync modules, scheduler implemented
- docker-compose with 8 services (PostgreSQL, ETL, 5 WrenAI, qdrant)
- CLI commands: setup, stack, etl, sql, config
- All architecture docs created (7 domain files, ETL sync strategy, data access skills)
