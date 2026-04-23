# ARCHITECTURE.md — PowerShop Analytics Platform

> This document describes the system architecture, component relationships, and data flow. It is the single source of truth for architectural decisions. **Keep this file up to date** — agents and developers should read this before starting any work.

## System Overview

PowerShop Analytics is a platform that extracts data from a vendor-managed PowerShop ERP (4D database), mirrors it into PostgreSQL, and provides two analytics interfaces:

1. **WrenAI** — Ad-hoc single-question text-to-SQL (e.g., "¿Cuánto vendimos ayer?")
2. **Dashboard App** — AI-generated multi-widget dashboards from natural language (e.g., "Créame un cuadro de mandos para el responsable de ventas")

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Data Source                                                             │
│   4D Server (10.0.1.35)                                                 │
│     ├── P4D SQL :19812  ─┐                                              │
│     └── SOAP :8080       │                                              │
└──────────────────────────┼──────────────────────────────────────────────┘
                           │ ETL (nightly)
┌──────────────────────────▼──────────────────────────────────────────────┐
│ Docker Compose Stack                                                    │
│                                                                         │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐  │
│  │  ETL Python  │────▶│  PostgreSQL       │◄────│  Dashboard App      │  │
│  │  (nightly)  │     │  18M+ rows        │     │  (Next.js+Tremor)   │  │
│  └─────────────┘     │  ps_* tables      │     │  :4000              │  │
│                      │  dashboard_* tbls │     └────────┬────────────┘  │
│                      └────────┬─────────┘              │               │
│                               │                         │               │
│  ┌────────────────────────────┼─────────────────────────┼────────────┐  │
│  │  WrenAI Stack              │                         │            │  │
│  │   ├── wren-ui :3000 ───────┘                         │            │  │
│  │   ├── wren-ai-service :5555                          │            │  │
│  │   ├── wren-engine                         OpenRouter │            │  │
│  │   ├── ibis-server                         (Claude)   │            │  │
│  │   └── qdrant                                  ▲      │            │  │
│  └───────────────────────────────────────────────┼──────┘            │  │
│                                                  │                    │  │
└──────────────────────────────────────────────────┼────────────────────┘  │
                                                   │                       │
                                        ┌──────────▼───────────┐          │
                                        │  OpenRouter API       │          │
                                        │  Claude Sonnet 4      │          │
                                        │  text-embedding-3-lg  │          │
                                        └──────────────────────┘          │
```

## Components

### 1. ETL Service (`etl/`)
- **Language**: Python 3.12
- **Schedule**: Nightly at 02:00 (configurable via `ETL_CRON_HOUR`)
- **Source**: 4D database via p4d driver (SQL port 19812)
- **Target**: PostgreSQL `ps_*` tables
- **Strategy**: Upsert delta for large tables (Ventas, LineasVentas), full refresh for small tables (Articulos, Clientes)
- **Key file**: `etl/main.py` (orchestrator), `etl/sync/*.py` (per-domain modules)

### 2. PostgreSQL (`postgres` container)
- **Data volume**: 18M+ rows across 26 `ps_*` tables
- **Key tables**: `ps_ventas` (911K), `ps_lineas_ventas` (1.7M), `ps_stock_tienda` (12.3M), `ps_gc_lin_albarane` (1M)
- **Indexes**: FK indexes, date indexes, store indexes (see `etl/schema/init.sql`)
- **Dashboard tables**: `dashboards`, `dashboard_versions` (for the Dashboard App)
- **Bind mount**: `./data/postgres/`

### 3. WrenAI Stack (5 containers)
- **Purpose**: Ad-hoc single-question text-to-SQL
- **UI**: http://localhost:3000
- **Semantic layer**: 26 models, 19 relationships, 107 column descriptions
- **Knowledge**: 40+ instructions, 52+ SQL pairs (managed via `scripts/wren-push-metadata.py`)
- **LLM**: Claude Sonnet 4 via OpenRouter
- **Embeddings**: text-embedding-3-large via OpenRouter

### 4. Dashboard App (`dashboard/`) — NEW
- **Purpose**: AI-generated multi-widget dashboards from natural language
- **Language**: TypeScript (Next.js 14+ App Router)
- **UI Framework**: Tremor (React dashboard components) + Tailwind CSS
- **Port**: 4000 (configurable)
- **LLM**: OpenRouter API (default) **or** local Claude Code CLI — selectable via `DASHBOARD_LLM_PROVIDER` (D-019); OpenRouter reuses `OPENROUTER_API_KEY` like WrenAI

#### Dashboard App Architecture

```
┌───────────────────────────────────────────────────────┐
│  Browser                                              │
│                                                       │
│  ┌─────────────────┐  ┌───────────────────────────┐  │
│  │  Dashboard View  │  │  Chat Sidebar             │  │
│  │                  │  │                            │  │
│  │  ┌──────────┐   │  │  User: "Créame un cuadro  │  │
│  │  │ KPI Row  │   │  │   de mandos para ventas"  │  │
│  │  ├──────────┤   │  │                            │  │
│  │  │ Bar Chart│   │  │  AI: "He creado un panel   │  │
│  │  ├──────────┤   │  │   con 6 widgets..."        │  │
│  │  │ Table    │   │  │                            │  │
│  │  └──────────┘   │  │  User: "Añade el margen"  │  │
│  │                  │  │                            │  │
│  └─────────────────┘  └───────────────────────────┘  │
└───────────────────────────┬───────────────────────────┘
                            │ REST API
┌───────────────────────────▼───────────────────────────┐
│  Next.js API Routes                                   │
│                                                       │
│  POST /api/dashboard/generate  ← prompt → LLM (+ tools) → spec │
│  POST /api/dashboard/modify    ← prompt + spec → LLM (+ tools) │
│  POST /api/dashboard/analyze   ← spec + widget data → LLM (+ tools) │
│  POST /api/query               ← SQL → PG → data     │
│  GET  /api/dashboard/:id       ← load saved spec      │
│  POST /api/dashboard/:id/save  ← persist spec         │
│  GET  /api/dashboards          ← list all             │
└───────────────────────────────────────────────────────┘
```

#### Dashboard JSON Spec Format

The LLM generates a JSON specification that the frontend renders:

```json
{
  "title": "Cuadro de Mandos — Ventas Marzo 2026",
  "description": "Panel para el responsable de ventas",
  "widgets": [
    {
      "id": "w1",
      "type": "kpi_row",
      "items": [
        {"label": "Ventas Netas", "sql": "SELECT SUM(total_si) ...", "format": "currency", "prefix": "€"},
        {"label": "Tickets", "sql": "SELECT COUNT(DISTINCT reg_ventas) ...", "format": "number"},
        {"label": "Ticket Medio", "sql": "SELECT SUM(total_si)/COUNT(...) ...", "format": "currency", "prefix": "€"}
      ]
    },
    {
      "type": "bar_chart",
      "title": "Ventas por Tienda",
      "sql": "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas ...",
      "x": "label", "y": "value"
    },
    {
      "type": "line_chart",
      "title": "Tendencia Semanal",
      "sql": "SELECT DATE_TRUNC('week', fecha_creacion) AS x, SUM(total_si) AS y FROM ps_ventas ..."
    },
    {
      "type": "table",
      "title": "Top 10 Artículos",
      "sql": "SELECT p.ccrefejofacm AS \"Referencia\", p.descripcion AS \"Descripción\", ..."
    }
  ]
}
```

#### Widget Types

| Type | Tremor Component | Purpose |
|------|-----------------|---------|
| `kpi_row` | Card + Metric | Row of KPI numbers (ventas, tickets, ticket medio) |
| `bar_chart` | BarChart | Category comparison (ventas por tienda) |
| `line_chart` | LineChart | Time series (tendencia semanal) |
| `area_chart` | AreaChart | Stacked time series |
| `donut_chart` | DonutChart | Proportions (mix por familia) |
| `table` | Table | Detailed data (top artículos) |
| `number` | Metric | Single big number |

## Data Flow

### ETL Flow (nightly)
```
4D Server → p4d driver → Python ETL → PostgreSQL ps_* tables
```

### WrenAI Flow (ad-hoc questions)
```
User question → WrenAI UI → AI Service (RAG + LLM) → SQL → ibis-server → PostgreSQL → result
```

### Dashboard App Flow (dashboard generation)
```
User prompt (Spanish)
  → Next.js API route
  → Dashboard LLM backend (OpenRouter chat.completions, or CLI driver with JSON tool-step protocol)
  → Same knowledge context + optional agentic tools: validate/explain/execute SQL, list/describe ps_* tables, inspect saved dashboards
  → Dashboard JSON spec (widgets + SQL queries)
  → Frontend renders spec with Tremor components
  → Each widget's SQL executed against PostgreSQL
  → Data rendered in charts/tables
```

When `DASHBOARD_AGENTIC_TOOLS_ENABLED=true` (default), `generate`, `modify`, and `analyze` use a bounded tool loop (`dashboard/lib/llm-tools/runner.ts`) instead of a single completion. Tool calls are logged to PostgreSQL `llm_tool_calls` (with `llm_provider` / `llm_driver`). See [docs/dashboard-agentic-tools.md](docs/dashboard-agentic-tools.md).

### Dashboard Modification Flow
```
User: "Añade el margen por familia"
  → Current dashboard spec + user prompt → LLM
  → Updated spec (original widgets + new margin widget)
  → Frontend re-renders
```

## Configuration

### Single credential file
`~/.config/powershop-analytics/.env` — loaded by all components:
- ETL: via python-dotenv
- docker-compose: via `.env` symlink
- CLI: via `load-env.sh`
- Dashboard App: via Next.js env loading

### Key environment variables

| Variable | Component | Purpose |
|----------|-----------|---------|
| `P4D_HOST/PORT/USER/PASSWORD` | ETL | 4D SQL connection |
| `POSTGRES_USER/PASSWORD/DB` | All | PostgreSQL connection |
| `OPENROUTER_API_KEY` | WrenAI + Dashboard (openrouter) | LLM + Embeddings |
| `WREN_LLM_MODEL` | WrenAI | LLM model for WrenAI |
| `DASHBOARD_LLM_PROVIDER` | Dashboard App | `openrouter` (default) or `cli` |
| `DASHBOARD_LLM_MODEL_OPENROUTER` / `DASHBOARD_LLM_MODEL_CLI` | Dashboard App | Per-backend model; legacy `DASHBOARD_LLM_MODEL` fills both when set |
| `DASHBOARD_LLM_CLI_*` | Dashboard App | CLI binary, driver, timeout, capture cap — see `.env.example` |
| `DASHBOARD_AGENTIC_*` | Dashboard App | Tool-calling limits and kill switch — see [docs/dashboard-agentic-tools.md](docs/dashboard-agentic-tools.md) |
| `DASHBOARD_PORT` | Dashboard App | HTTP port (default: 4000) |

## Data Persistence

| Data | Location | Survives restart | Survives `down -v` |
|------|----------|:----------------:|:-------------------:|
| PostgreSQL data | `./data/postgres/` | Yes | Yes (bind mount) |
| Qdrant vectors | `./data/qdrant/` | Yes | Yes (bind mount) |
| WrenAI config/SQLite | `./data/wren/` | Yes | Yes (bind mount) |
| Dashboard data | PostgreSQL tables | Yes | Yes (in PG bind mount) |

## Technology Decisions

See [DECISIONS-AND-CHANGES.md](DECISIONS-AND-CHANGES.md) for the rationale behind each choice.
