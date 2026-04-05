# DECISIONS-AND-CHANGES.md — Decision Log and Changelog

> Every significant architectural decision and change is recorded here with rationale. Agents and developers MUST read this before proposing changes and MUST update it after making changes. Entries are reverse-chronological (newest first).

## Decision Log

### D-014: Label-driven AI execution — 2026-04-05
**Context**: Need a mechanism for humans to control which issues AI works on.
**Decision**: Label `ai-work` triggers Claude Code Worker. Label `ai-blocked` pauses. Priority labels (`p0`-`p3`) control order. `no-ai` excludes from AI processing.
**Rationale**: Simple, visible, auditable. Human adds label = human approves AI work. See epic #121.

### D-013: Human-in-the-loop for merges (initially) — 2026-04-05
**Context**: Could enable full auto-merge for AI-generated PRs.
**Decision**: Start with human approval required for merge. Add auto-merge for low-risk PRs (docs, deps) after trust is established.
**Rationale**: Safety first. The product handles business data. Build trust incrementally.

### D-012: Custom workflows instead of reusable action library — 2026-04-05
**Context**: Elastic has `elastic/ai-github-actions` with reusable workflow templates across repos.
**Decision**: Build workflows directly in this repo. Extract to reusable library later if needed.
**Rationale**: We have ~20 workflows vs their 70+. Premature extraction adds complexity. Keep it simple until patterns stabilize.

### D-011: AI Factory with Claude Code as primary agent — 2026-04-05
**Context**: Need autonomous development pipeline. Elastic uses GitHub Copilot SWE Agent + Gemini. We need to choose our AI engine.
**Decision**: Build an AI Factory using Claude via `anthropic/claude-code-action` GitHub Action. 20 workflows across 6 phases: Foundation, PR Lifecycle, Issue Lifecycle, Discovery Agents, Deployment, Refinement.
**Alternatives considered**: GitHub Copilot SWE Agent (Elastic's approach), hybrid Copilot+Claude.
**Rationale**: Claude is already our LLM for WrenAI and Dashboard App. Single vendor simplifies. Claude Code Action is production-ready and supports CLAUDE.md context files which we already maintain. See epic #121 and [docs/ai-factory.md](docs/ai-factory.md).

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

### 2026-04-05
- AI Factory design: 20 workflows across 6 phases for autonomous development (D-011 through D-014)
- Created [docs/ai-factory.md](docs/ai-factory.md) with full architecture, workflow catalog, and design decisions
- Created epic #121 and 20 implementation issues (#122-#141)
- Labels: `ai-factory`, `phase-f1` through `phase-f6`

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
