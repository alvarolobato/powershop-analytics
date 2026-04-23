# Skill: Dashboard App Development

**Use when**: Building, modifying, or debugging the AI dashboard generator (Next.js + Tremor).

## Project Structure

```
dashboard/
├── app/                     # Next.js App Router
│   ├── layout.tsx           # Root layout (sidebar, nav)
│   ├── page.tsx             # Home: dashboard list
│   ├── dashboard/
│   │   ├── [id]/page.tsx    # Dashboard view + chat sidebar
│   │   └── new/page.tsx     # Create new dashboard
│   └── api/
│       ├── dashboard/
│       │   ├── generate/route.ts   # POST: prompt → LLM → spec
│       │   ├── modify/route.ts     # POST: spec + prompt → LLM → updated spec
│       │   ├── [id]/route.ts       # GET: load, POST: save
│       │   └── route.ts            # GET: list all dashboards
│       └── query/route.ts          # POST: SQL → PG → data
├── components/
│   ├── widgets/             # Widget renderers (KpiRow, BarChart, Table, etc.)
│   ├── DashboardRenderer.tsx # Takes spec JSON, renders all widgets
│   ├── ChatSidebar.tsx      # Chat interface for dashboard modification
│   └── DashboardList.tsx    # Dashboard listing page
├── lib/
│   ├── llm.ts              # Dashboard LLM orchestration (single-shot + agentic)
│   ├── llm-provider/       # OpenRouter vs CLI adapters, safe CLI spawn, registry
│   ├── llm-tools/          # Agentic runner, tool catalog, SQL/dashboard handlers
│   ├── db.ts               # PostgreSQL client (pg)
│   ├── prompts.ts          # System prompts with knowledge context
│   ├── schema.ts           # Dashboard spec TypeScript types
│   └── knowledge.ts        # SQL pairs + instructions as LLM context
├── Dockerfile
├── package.json
└── tailwind.config.ts
```

## Key Patterns

### Dashboard Spec Generation
The LLM receives: system prompt (schema + knowledge + widget types) + user prompt.
It returns: a JSON spec with `title`, `description`, `widgets[]`.
Each widget has: `type`, `title`, `sql`, and type-specific config (x/y for charts, format for KPIs).

### Agentic tools (generate / modify / analyze)
When `DASHBOARD_AGENTIC_TOOLS_ENABLED=true` (default), `lib/llm.ts` routes those three flows through `lib/llm-tools/runner.ts`. With **`DASHBOARD_LLM_PROVIDER=openrouter`** (default), rounds use native OpenRouter function calling. With **`DASHBOARD_LLM_PROVIDER=cli`**, rounds use the Claude Code JSON step protocol (see D-019). The model can list/describe `ps_*` tables, validate or run read-only SQL, and inspect saved dashboards before the final JSON or markdown answer. Hard limits and telemetry are documented in [docs/dashboard-agentic-tools.md](../dashboard-agentic-tools.md).

### Dashboard Modification
User sends: current spec JSON + modification prompt.
LLM returns: updated spec JSON (preserving existing widgets, adding/modifying as requested).
Frontend diffs and re-renders only changed widgets.

### SQL Execution
Each widget's SQL is executed independently against PostgreSQL.
Results are cached (in-memory or Redis) with a TTL.
Errors in one widget don't break the dashboard — show error badge on that widget.

### Widget Components
Each widget type maps to a Tremor component:
- `kpi_row` → `Card` + `Metric` in a grid
- `bar_chart` → `BarChart`
- `line_chart` → `LineChart`
- `table` → `Table` with sortable columns
- `donut_chart` → `DonutChart`

## LLM System Prompt Structure

```
You are a dashboard generator for a Spanish retail/wholesale business.
You generate JSON dashboard specifications.

## Available Widget Types
[list of widget types with JSON format]

## Database Schema
[ps_* table names, key columns, descriptions]

## Business Rules
[40+ instructions from wren-push-metadata.py]

## Example SQL Patterns
[52+ SQL pairs]

## Rules
- All SQL must be valid PostgreSQL against ps_* tables
- Use column aliases in Spanish for display
- Always use total_si (sin IVA) for revenue
- Include Referencia (ccrefejofacm) not codigo for article display
- fecha_creacion for date filtering (never fecha_documento)
- Store 99 = almacén central, exclude from retail analytics
```

## Testing

- Unit tests: widget components render correct Tremor elements
- Integration tests: API routes return valid specs
- SQL validation: run EXPLAIN on all generated SQL
- E2E: Playwright test for full generate → view → modify flow

## Dependencies

- next: 14+
- @tremor/react: latest
- pg: PostgreSQL client
- openai: OpenRouter-compatible SDK
- tailwindcss: styling
- zod: spec validation
