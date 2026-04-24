# AGENTS.md -- AI development guide

Guidance for AI assistants. Use the **skills** ([docs/skills/skills.md](docs/skills/skills.md)) for domain detail; this file is the skeleton, index, and meta-rules.


## Project Overview

**PowerShop Analytics** is an AI-powered analytics platform for a retail/wholesale business. It extracts data from a vendor-managed PowerShop ERP (4D database), mirrors it into PostgreSQL, and provides two analytics interfaces:

1. **WrenAI** — Ad-hoc single-question text-to-SQL ("¿Cuánto vendimos ayer?")
2. **Dashboard App** — AI-generated multi-widget dashboards from natural language ("Créame un cuadro de mandos para ventas") — **NEW, in development**

**Data source:** PowerShop 4D v18.0.6 at `YOUR_4D_SERVER_IP` (Windows, compiled mode).
**Access paths:** P4D SQL driver (port 19812) for bulk extraction, SOAP web services (port 8080) for business-enriched data.
**Target:** PostgreSQL (mirror) → WrenAI + Dashboard App. LLM via OpenRouter (Claude Sonnet 4).

**Architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md) for system diagrams and component details.
**Decisions**: See [DECISIONS-AND-CHANGES.md](DECISIONS-AND-CHANGES.md) for rationale and changelog.

This is a **public repository** -- no credentials, customer data, or business-specific data in committed files.

---

## Repository Structure

| Path | Purpose |
|------|---------|
| `dashboard/` | **Dashboard App** — Next.js + Tremor AI dashboard generator |
| `cli/` | Unified CLI (`ps`) — commands, dispatcher |
| `cli/commands/` | Command implementations (sql.sh, config.sh, stack.sh, etl.sh, wren.sh) |
| `etl/` | Python ETL service — syncs 4D → PostgreSQL (nightly) |
| `scripts/` | Operational scripts (wren-push-metadata.py, migrate-volumes.sh, wren-setup.sh) |
| `wren/mdl/` | WrenAI semantic model reference (MDL JSON) |
| `docs/` | Documentation, schema discovery, architecture |
| `docs/architecture/` | Domain ER diagrams + ETL sync strategy per domain |
| `docs/skills/` | AI agent skills (domain-specific guides) |
| `local/` | Local config/credentials (git-ignored) |
| `data/` | Bind-mounted data (postgres, qdrant, wren) — git-ignored |
| `docker-compose.yml` | Full stack: PostgreSQL + ETL + WrenAI + Dashboard App |
| `.env.example` | Environment variable template (no real secrets) |
| `ARCHITECTURE.md` | System architecture, component diagrams, data flow |
| `DECISIONS-AND-CHANGES.md` | Decision log + changelog (always up to date) |

---

## Unified CLI (`ps`)

Single entry point for all operations. **Usage:** `ps <group> [subcommand] [options]`

| Command | Purpose |
|---------|---------|
| `ps setup` | First-time setup: create .env and repo symlink |
| `ps setup check` | Verify prerequisites (Docker, .env, connectivity) |
| `ps stack up` | Start all containers |
| `ps stack down` | Stop all containers |
| `ps stack restart` | Restart all containers |
| `ps stack update` | Pull latest, rebuild images, restart stack |
| `ps stack status` | Show container status and WrenAI UI health |
| `ps stack logs [svc]` | Show logs (follow); optional service name |
| `ps stack open` | Open WrenAI UI in browser |
| `ps stack destroy` | Stop containers and remove volumes (with confirmation) |
| `ps etl run` | Run ETL sync once (also triggerable via the Dashboard ETL Monitor "Sincronizar ahora" button → `POST /api/etl/run`) |
| `ps etl status` | Show watermark table (last sync per table) |
| `ps etl tables` | Show row counts for synced tables |
| `ps etl logs` | Show ETL container logs |
| `ps sql tables` | List all 4D tables |
| `ps sql describe <table>` | Show columns for a table |
| `ps sql query "<SQL>"` | Run a read-only SQL query |
| `ps sql sample <table> [n]` | Show n sample rows |
| `ps sql count <table>` | Row count for a table |
| `ps wren push` | Push source knowledge to WrenAI (40+ instructions, 50+ SQL pairs) |
| `ps wren validate` | Validate all SQL pairs against PostgreSQL mirror |
| `ps wren status` | Show instruction and SQL pair counts |
| `ps dashboard open` | Open Dashboard App in browser |
| `ps dashboard logs` | Show dashboard container logs |
| `ps dashboard restart` | Restart the dashboard container |
| `ps dashboard status` | Show dashboard container status |
| `ps config` | Show loaded configuration |

### CLI-first principle

All automation should delegate work to the CLI. This ensures every operation is reproducible locally and in Docker/CI.

### Read-only policy

**CRITICAL:** All SQL operations are read-only. The CLI rejects INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, and TRUNCATE statements. We are extracting data, never modifying the source ERP.

---

## Configuration

### Credential storage (single file, survives worktrees)

**One file**: `~/.config/powershop-analytics/.env` (standard `.env` format). Copy from `.env.example`.

This file is loaded by all three systems:
- **CLI** (`load-env.sh`): loads `~/.config/powershop-analytics/.env`, then `local/.env`
- **ETL** (`config.py` via python-dotenv): loads from `./.env`, then `local/.env`, then `~/.config/powershop-analytics/.env`
- **docker-compose**: symlink `.env` in the worktree → `~/.config/powershop-analytics/.env`

Run `ps setup` to create the file and symlink automatically.

Priority (highest to lowest):
1. **Environment variables** -- Direct override
2. **`.env`** in worktree root -- standard for docker-compose (symlink to centralized)
3. **`local/.env`** -- Worktree-specific override (git-ignored)
4. **`~/.config/powershop-analytics/.env`** -- Centralized (shared across worktrees)

### Key environment variables

| Variable | Purpose |
|----------|---------|
| `P4D_HOST` | 4D SQL server hostname/IP |
| `P4D_PORT` | 4D SQL server port (default: 19812) |
| `P4D_USER` | 4D SQL username |
| `P4D_PASSWORD` | 4D SQL password |
| `SOAP_URL` | SOAP endpoint URL |
| `SOAP_WSDL` | WSDL URL |
| `POSTGRES_DSN` | PostgreSQL connection string (ETL target) |
| `OPENROUTER_API_KEY` | OpenRouter API key for WrenAI LLM + embeddings |
| `ETL_CRON_HOUR` | Hour to run nightly sync (default: 2) |
| `WREN_LLM_MODEL` | LLM model for WrenAI text-to-SQL (default: anthropic/claude-sonnet-4) |

---

## WrenAI Configuration

### LLM and Embeddings (via OpenRouter)

WrenAI uses two AI providers, both routed through OpenRouter with a single API key:
- **LLM**: `openrouter/anthropic/claude-sonnet-4` via litellm. Configured in `wren-config.yaml`.
- **Embeddings**: `openai/text-embedding-3-large` via litellm. Note: litellm does NOT support the `openrouter/` prefix for embeddings — use `openai/` prefix with `OPENAI_API_BASE` set to `https://openrouter.ai/api/v1`.

Model IDs must match OpenRouter's catalog exactly (e.g. `anthropic/claude-sonnet-4` not `anthropic/claude-sonnet-4-20250514`). Check https://openrouter.ai/models for valid IDs.

### Semantic Model

Relationships and models are managed through WrenAI's GraphQL API at `http://localhost:3000/api/graphql`:
- `createRelation(data: { fromModelId, fromColumnId, toModelId, toColumnId, type })` — create relationship
- `mutation { deploy(force: true) }` — deploy/re-index the semantic model

The MDL JSON at `wren/mdl/model.json` is a reference but WrenAI community edition manages its own model internally via the UI/API, not by loading external JSON files.

### Data Persistence

All data lives in bind-mounted directories under `./data/`:
- `./data/postgres/` — PostgreSQL data files
- `./data/qdrant/` — Qdrant vector store
- `./data/wren/` — WrenAI config, SQLite DB, MDL

This survives `docker compose down` and container recreation. Only `docker compose down -v` or deleting `./data/` will destroy it.

### Knowledge Management

WrenAI has two knowledge channels that feed the RAG pipeline for text-to-SQL generation:

#### Instructions (business rules)
- Stored in SQLite `instruction` table + indexed in qdrant `instructions` collection
- Source instructions: managed by `scripts/wren-push-metadata.py`, marked `is_default=1`
- User instructions: created via WrenAI UI, marked `is_default=0` — **never touched by the script**
- Current count: **40 source instructions** covering retail sales, wholesale, stock, customers, payments, margins, products, transfers, pricing, and data quality rules

#### SQL Pairs (example query patterns)
- Stored in SQLite `sql_pair` table + indexed in qdrant `sql_pairs` collection
- Source pairs tracked by question text (deterministic). On update: delete matching, re-insert new.
- User pairs with different question text survive updates.
- Current count: **52 source SQL pairs** across all business domains

#### Merge strategy
Run `ps wren push` to update source knowledge without losing user entries:
```bash
ps wren push                     # update knowledge
ps wren validate                 # test SQL pairs against PostgreSQL
ps wren status                   # show counts
```

The script:
1. Deletes `instruction` rows where `is_default=1`, inserts new source instructions with `is_default=1`
2. Deletes `sql_pair` rows whose question matches any source question, inserts new source pairs
3. Restarts wren-ui, deploys (re-indexes schema embeddings)
4. POSTs instructions and SQL pairs to qdrant AI service

#### Critical: deploy does NOT index instructions/sql_pairs
`mutation { deploy(force: true) }` only re-indexes the schema (table/column embeddings). Instructions and SQL pairs require separate POST calls to the AI service at port 5555.

#### Adding new knowledge
To add new instructions or SQL pairs: add entries to `INSTRUCTIONS` or `SQL_PAIRS` in `scripts/wren-push-metadata.py`, then run `ps wren push`. All SQL in `SQL_PAIRS` must be valid PostgreSQL against `ps_*` mirror tables.

---

## Data Architecture

### 4D Database (source)

- **325 tables**, ~8.6 million rows across key tables
- **Key domains:** Products (Articulos), Sales (Ventas/LineasVentas), Customers (Clientes), Wholesale (GC* tables), Purchasing (Compras), Invoicing (Facturas), Stock (Exportaciones/CCStock), Logistics, HR (RRHH*), Finance, Stores (Tiendas)
- **Schema details:** Run `ps sql schema` to generate locally (git-ignored, contains real data)
- **Authoritative field types:** Query **`_USER_COLUMNS`** on the live 4D server (`ps sql query "SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH FROM _USER_COLUMNS WHERE TABLE_NAME = 'Exportaciones' AND COLUMN_NAME LIKE 'Stock%'"`). Type IDs are documented in [docs/skills/4d-sql-dialect.md](docs/skills/4d-sql-dialect.md). A local **PowerShop Server / PSClient** directory tree (install or backup files) is mainly **binaries and resources** — it does **not** replace structure discovery; use SQL system tables or vendor `*_SQL` views.
- Primary keys use Real (float) fields with a `.99` suffix pattern — store as `NUMERIC` in PostgreSQL, never `FLOAT8`
- CCStock has 582 columns (wide-format stock matrix); prefer `Exportaciones` for ETL (has FechaModifica, simpler structure)
- **`Exportaciones.Stock1..Stock34`:** **`_USER_COLUMNS`** declares **every** slot as **`DATA_TYPE = 3`**, **`DATA_LENGTH = 2`** (16-bit integer). The **4D SQL + p4d** path can return **unsigned widened** values for negatives (`65535` = `−1`). The ETL applies **`decode_signed_int16_word()`** (subtract 65536 when `32768 ≤ n ≤ 65535` — exact int16 bit reinterpretation) **only** on these columns before `ps_stock_tienda.stock`. **`CCStock`** is **Real** (type 6) and is not passed through that decoder. See [docs/skills/data-access.md](docs/skills/data-access.md), `DECISIONS-AND-CHANGES.md` D-017.
- Articulos has 379 columns (prices, sizes, multilingual descriptions) — never `SELECT *`, always specify columns
- **ETL sync strategy:** See [docs/etl-sync-strategy.md](docs/etl-sync-strategy.md) for validated delta fields, PKs, and sync method per table

### Access Paths

1. **P4D (SQL on port 19812)** -- Recommended for bulk extraction. Python DB-API 2.0 via `p4d` package. Use for schema discovery, bulk loads, delta queries.
2. **SOAP (HTTP on port 8080)** -- 100+ operations at `/4DSOAP/`. Use for business-enriched data (calculated prices, aggregated stock). WS_JS_* methods return JSON strings.
3. **ODBC** -- Not viable (no Linux driver).
4. **REST API** -- Not enabled (404).

---

## Development Setup

### Prerequisites

- Python 3.11+ with venv
- System packages for CFFI: `build-essential`, `libffi-dev` (Linux/Docker)
- Network access to YOUR_4D_SERVER_IP (ports 19812, 8080)

### Quick start

```bash
# Clone and set up
python3 -m venv .venv
.venv/bin/pip install p4d

# Copy credentials template
cp credentials.conf.template ~/.config/powershop-analytics/credentials.conf
# Edit with your values

# Test connection
cli/ps.sh sql tables
```

### Adding the CLI to PATH

```bash
chmod +x cli/ps
cp cli/ps ~/bin/ps-analytics  # or symlink
```

---

## Important Rules for AI Assistants

### Read-only data access

**Never** issue SQL statements that modify data. The PowerShop ERP is vendor-managed and production. We only read.

### No credentials in committed files

Store all credentials in `~/.config/powershop-analytics/.env` (see `.env.example` for format). Symlink to the worktree with `ln -sf ~/.config/powershop-analytics/.env .env`.

### No customer/business data in committed files

Schema metadata (table names, column names, types, row counts) is fine. Actual customer records, sales data, or any PII must never be committed.

### Working with worktrees

Credentials live in `~/.config/powershop-analytics/` (centralized) so they work across git worktrees. Use `local/` for worktree-specific overrides only.

### Python changes and commits

**Before any commit that touches Python** (`.py` under `etl/`, `scripts/`, or elsewhere in the repo), run **Ruff format** on the paths you changed so CI does not fail on style. From the repo root, typical patterns:

```bash
python -m ruff format etl/ scripts/
# or narrow to files you edited:
python -m ruff format path/to/edited_file.py
```

Run this **after** your edits and **before** `git commit`. Formatting is required even for small diffs; skipping it has been causing repeated lint failures in PRs. `ruff check` still applies for non-format rules—fix any issues it reports on the same trees.

---

## Self-learning and documentation

When you fix a non-obvious bug or discover a gotcha, document it. Procedure: [agent-efficiency.md](docs/skills/agent-efficiency.md).

---

## Keeping data architecture docs up to date

The `docs/architecture/` files and `docs/etl-sync-strategy.md` are **living documents**. Whenever you run real queries against the 4D database and learn something new, update them immediately — do not defer.

### What to update and where

| Discovery | Where to document |
|-----------|------------------|
| New delta field / PK found for a table | `docs/etl-sync-strategy.md` + relevant `docs/architecture/*.md` ETL section |
| Table is (or isn't) append-only — confirmed with data | `docs/etl-sync-strategy.md` + domain architecture file |
| Row count significantly different from what's documented | Update the Table Descriptions table in the relevant `docs/architecture/*.md` |
| New field gotcha (NULL column, wrong type, encoding issue) | `docs/skills/data-access.md` Gotchas section |
| New FK relationship or join path discovered | ER diagram in the relevant `docs/architecture/*.md` |
| Table that was empty now has data, or vice versa | Update Empty/Unused Tables section in domain architecture file |
| New SOAP method reverse-engineered | `docs/skills/data-access.md` SOAP section |

### How to update

1. Run the relevant queries to confirm the fact (use `ps sql query "..."` or direct Python).
2. Add a dated note if the finding is time-sensitive (e.g. `> Validated 2026-03-30`).
3. Update the relevant file. Keep descriptions concise — add facts, not prose.
4. If the discovery was non-obvious and cost significant investigation time, also create a GitHub issue with label `agent-efficiency` per [agent-efficiency.md](docs/skills/agent-efficiency.md).

### Do NOT leave knowledge only in conversation context

If you discover something during a session — a null field, an unexpected table name, a sync gotcha — and do not write it to docs, the next agent (or the next session) will have to rediscover it. Write it down.

---

## AI Assistant Configuration

This project supports **Claude Code** and other AI assistants. All follow the same guideline:

- **Entry point:** AGENTS.md (this file) for skeleton, index, and meta-rules.
- **Domain detail:** [docs/skills/skills.md](docs/skills/skills.md) to choose the right skill.
- **Self-learning:** [docs/skills/agent-efficiency.md](docs/skills/agent-efficiency.md).

### Configuration files

| File | Editor | Purpose |
|------|--------|---------|
| `CLAUDE.md` | Claude Code | Imports AGENTS.md + skills |

---

## GitHub access

Use the [GitHub CLI](https://cli.github.com/) (`gh`) for all GitHub operations.

---

## Issue and PR format

All GitHub issues in this project follow a single standard format. When creating issues, always use this template exactly.

### Issue template

```markdown
# <Feature name>

## Context
- **Problem**: <what's wrong / missing; why it matters>
- **Worktree**: <required: git worktree name for isolated execution, e.g. `wren-p1-compose`>
- **Scope**: <what is in / out of scope>
- **Constraints**: <perf, compatibility, no-breaking-changes, deps, etc.>
- **Repo touchpoints**: <files/dirs likely involved, commands, datasets impacted>
- **Definition of done**: <e.g., builds + tests pass; feature-specific checks>
- **How is it going to be tested**: <testing strategy and specific test cases>

## Tasks
- [ ] 1) <task title> (owner: agent)
  - **Change**: <precise behavior or code change>
  - **Files**: <exact file paths>
  - **Acceptance**: <how to verify; exact commands and expected output>
  - **Spec update**: mark done + update remaining tasks/context as needed

- [ ] 2) ... (owner: agent)

- [ ] N-1) Run all checks and fix issues (owner: agent)
  - **Change**: Run all tests, linting, type-checking, and formatting; fix any failures
  - **Files**: any files with issues
  - **Acceptance**: `docker compose run --rm etl python -m pytest && python -m ruff check etl/ && python -m mypy etl/`
  - **Spec update**: mark done

- [ ] N-1b) Copilot review (owner: agent, **one round only**)
  - **Change**: Request a Copilot review, address all feedback, then stop. Do **not** re-request Copilot.
  - **How**: `gh pr create`, then request Copilot review via REST API: `gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`. Poll for review: `gh api repos/{owner}/{repo}/pulls/{PR#}/reviews --jq '[.[] | {state, user: .user.login, body}]'`. Address all comments with inline replies.
  - **Acceptance**: Copilot review arrived, every comment has either a code change or a reply explaining why it does not apply. No second Copilot round.
  - **Spec update**: mark done

- [ ] N-1c) Opus review (owner: agent, **one round only, clean context**)
  - **Change**: Run a single Opus review of the PR **from a fresh context** (new session, no implementation history), address all feedback, then stop.
  - **How**: Start a new Claude Code session with no prior conversation about this PR and invoke the PR review flow on this PR number. Reply inline to every comment; apply the fixes that are correct.
  - **Acceptance**: Opus review completed; every comment has either a code change or a reply. No second Opus round.
  - **Spec update**: mark done

- [ ] N) Create commit (owner: agent)
  - **Change**: Stage all changes and create a descriptive commit
  - **Files**: none (git operation)
  - **Acceptance**: `git status` shows clean working tree; `git log -1` shows the new commit
  - **Spec update**: mark done

## Additional Context
<append-only notes: discoveries, links, decisions, gotchas found during execution>
```

### Worktree workflow

Each issue specifies a **worktree name**. Before starting work:
```bash
git worktree add ../<repo>-<worktree-name> -b <worktree-name>
cd ../<repo>-<worktree-name>
```
Work in the worktree. When done, PR is merged and worktree is removed:
```bash
git worktree remove ../<repo>-<worktree-name>
```

### PR and review policy

Every PR gets **exactly two review rounds, in order, each run only once**:

1. **One Copilot review** (bot).
2. **One Opus review**, started from a **clean context** (fresh Claude Code session with no prior history about this PR or its implementation).

After each round: address every comment with either a code change or an inline reply, then move on. **Do not re-request the same reviewer.** Iterating "until there are no comments" is no longer the policy — it was too much. If a later round surfaces a genuinely blocking issue, use judgement and escalate to the human owner rather than looping.

Rules:
- Every piece of work goes through a PR, even solo work.
- **Round 1 — Copilot.** Request via the REST API:
  ```bash
  gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers \
    --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  ```
  Do NOT use `gh pr review --request copilot` (doesn't work) or `gh pr edit --add-reviewer copilot` (can't resolve bot users). The REST API with `copilot-pull-request-reviewer[bot]` is the only working CLI method.
  - **From GitHub Actions**, the default `GITHUB_TOKEN` **cannot** assign `copilot-pull-request-reviewer[bot]` — the API returns 200 but with an empty `requested_reviewers` array. Workflows must use a PAT stored in the repo secret `COPILOT_PAT` (fine-grained PAT, scope `Pull requests: Read and write`). Pattern:
    ```bash
    GH_TOKEN="$COPILOT_PAT" gh api repos/{owner}/{repo}/pulls/{PR#}/requested_reviewers \
      --method POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
    ```
    Always verify the response contains `Copilot` in `requested_reviewers` before claiming the review was requested.
  - Poll for the review: `gh api repos/{owner}/{repo}/pulls/{PR#}/reviews --jq '[.[] | {state, user: .user.login, body}]'`.
  - Address every comment with a code change or inline reply. **One round only — do not re-request Copilot.**
- **Round 2 — Opus, clean context.** Start a new Claude Code session (no prior conversation about this PR or the branch) and run the PR review flow on this PR number. Reply inline to every comment; apply the correct fixes. **One round only — do not re-request Opus.**
- **Merge** after both rounds are done and every comment has a change or a reply. Unresolved disagreement → flag to the human owner; don't start a third round to paper over it.

### Phase labels and execution order

Issues are labelled by phase: `phase-1`, `phase-2`, ..., `phase-6`.

**Execution rules for unattended agents:**
- Phase 1 is sequential: P1-A then P1-B.
- Phases 2+3 sync issues are independent of each other — run in batches of 2-3 after P1-B merges. Each sync issue only creates `etl/sync/<module>.py` + tests. **None touch `etl/main.py`** — P4 owns that file.
- Phase 4 (scheduler) wires all sync modules into `main.py` and runs the first full data load. Requires all sync PRs merged.
- Phase 5 (WrenAI MDL) requires P4 complete (data must be in PostgreSQL).
- Phase 6 (docs) requires P5 complete.
