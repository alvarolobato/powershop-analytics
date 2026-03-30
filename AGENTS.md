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
| `credentials.conf.template` | Template for credentials file |
| `docker-compose.yml` | Full stack: PostgreSQL + ETL + WrenAI (6 containers) |
| `.env.example` | Environment variable template (no real secrets) |

---

## Unified CLI (`ps`)

Single entry point for all operations. **Usage:** `ps <group> [subcommand] [options]`

| Command | Purpose |
|---------|---------|
| `ps sql tables` | List all 4D tables |
| `ps sql describe <table>` | Show columns for a table |
| `ps sql query "<SQL>"` | Run a read-only SQL query |
| `ps sql sample <table> [n]` | Show n sample rows |
| `ps sql count <table>` | Row count for a table |
| `ps config` | Show loaded configuration |

### CLI-first principle

All automation should delegate work to the CLI. This ensures every operation is reproducible locally and in Docker/CI.

### Read-only policy

**CRITICAL:** All SQL operations are read-only. The CLI rejects INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, and TRUNCATE statements. We are extracting data, never modifying the source ERP.

---

## Configuration

### Credential storage (three-tier hierarchy)

1. **Environment variables** -- Direct override (highest priority)
2. **`local/credentials.conf`** -- Worktree-specific (git-ignored)
3. **`~/.config/powershop-analytics/credentials.conf`** -- Centralized (shared across worktrees, recommended)

See `credentials.conf.template` for the expected format. The CLI loads credentials via `cli/commands/load-env.sh` before executing any command.

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
| `OPENROUTER_API_KEY` | OpenRouter API key for WrenAI LLM |
| `ETL_CRON_HOUR` | Hour to run nightly sync (default: 2) |

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

Store all credentials in `~/.config/powershop-analytics/credentials.conf` or `local/credentials.conf`. The template file shows the format but contains no real secrets.

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
