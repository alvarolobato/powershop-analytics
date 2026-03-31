# AGENTS.md -- AI development guide

Guidance for AI assistants. Use the **skills** ([docs/skills/skills.md](docs/skills/skills.md)) for domain detail; this file is the skeleton, index, and meta-rules.


## Project Overview

**PowerShop Analytics** extracts data from a vendor-managed PowerShop ERP (built on 4D database) and loads it into a PostgreSQL mirror for analytics via WrenAI (text-to-SQL). The extraction code runs in a Docker container on Linux.

**Data source:** PowerShop 4D v18.0.6 at `YOUR_4D_SERVER_IP` (Windows, compiled mode).
**Access paths:** P4D SQL driver (port 19812) for bulk extraction, SOAP web services (port 8080) for business-enriched data.
**Target:** PostgreSQL (mirror) → WrenAI (GenBI / text-to-SQL, self-hosted). LLM via OpenRouter (OpenAI-compatible API).

This is a **public repository** -- no credentials, customer data, or business-specific data in committed files.

---

## Repository Structure

| Path | Purpose |
|------|---------|
| `cli/` | Unified CLI (`ps`) -- commands, dispatcher |
| `cli/commands/` | Command implementations (sql.sh, config.sh, etc.) |
| `etl/` | Python ETL service — syncs 4D → PostgreSQL (nightly) |
| `wren/mdl/` | WrenAI semantic model definitions (MDL JSON files) |
| `docs/` | Documentation, schema discovery, architecture |
| `docs/architecture/` | Domain ER diagrams + ETL sync strategy per domain |
| `docs/skills/` | AI agent skills (domain-specific guides) |
| `docs/etl-sync-strategy.md` | Validated sync strategy for all tables |
| `local/` | Local config/credentials (git-ignored) |
| `.env.example` | Template for environment variables |
| `docker-compose.yml` | Full stack: PostgreSQL + ETL + WrenAI (6 containers) |
| `.env.example` | Environment variable template (no real secrets) |

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
| `ps stack status` | Show container status and WrenAI UI health |
| `ps stack logs [svc]` | Show logs (follow); optional service name |
| `ps stack open` | Open WrenAI UI in browser |
| `ps stack destroy` | Stop containers and remove volumes (with confirmation) |
| `ps etl run` | Run ETL sync once |
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
- Primary keys use Real (float) fields with a `.99` suffix pattern — store as `NUMERIC` in PostgreSQL, never `FLOAT8`
- CCStock has 582 columns (wide-format stock matrix); prefer `Exportaciones` for ETL (has FechaModifica, simpler structure)
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

- [ ] N-1b) Review cycle (owner: agent)
  - **Change**: Request Copilot review, address all feedback, re-request until no new feedback
  - **How**: `gh pr create` then `gh pr review --request copilot`. Poll every 5 minutes: `gh pr reviews <PR#> --json state,author` until Copilot has reviewed. Address all comments with inline replies. Re-request after each round.
  - **Acceptance**: Copilot review shows no unresolved comments
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

- Every piece of work goes through a PR, even solo work.
- **Always request a Copilot review** on every PR: `gh pr review --request copilot`
- If Copilot is not available via the UI, it IS available through the gh CLI — always try.
- Poll for the review result every 5 minutes: `gh pr reviews <PR#> --json state,author,body`
- Address all feedback, reply to each comment, then re-request review.
- Only merge after Copilot has reviewed and there is no unresolved feedback.

### Phase labels and execution order

Issues are labelled by phase: `phase-1`, `phase-2`, ..., `phase-6`.

**Execution rules for unattended agents:**
- Phase 1 is sequential: P1-A then P1-B.
- Phases 2+3 sync issues are independent of each other — run in batches of 2-3 after P1-B merges. Each sync issue only creates `etl/sync/<module>.py` + tests. **None touch `etl/main.py`** — P4 owns that file.
- Phase 4 (scheduler) wires all sync modules into `main.py` and runs the first full data load. Requires all sync PRs merged.
- Phase 5 (WrenAI MDL) requires P4 complete (data must be in PostgreSQL).
- Phase 6 (docs) requires P5 complete.
