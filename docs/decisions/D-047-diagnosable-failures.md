---
id: D-047
title: Every failure surface must leave a trace that outlives the container
date: 2026-08-28
---

# D-047: Every failure surface must leave a trace that outlives the container

*Decided: 2026-08-28*

**Context**: An observability audit found the app well instrumented for LLM
flows — `llm_errors`, `llm_interactions`, `llm_tool_calls`, `llm_usage` and
`etl_sync_runs` are all rich and durable in Postgres — and blind in three
specific places.

1. `dashboard/app/admin/config/error.tsx` was the **only** React error boundary
   in the app. Every other route — `/`, `/paneles`, `/dashboard/[id]`,
   `/conversations`, `/review`, `/etl`, the rest of `/admin` — fell back to
   Next's bare, unstyled 500 with nothing on screen to report. That file's own
   comment had said so since it was written.
2. The agentic tool handlers discarded the real error at the catch.
   `handleGetDashboardWidgetRawValues` runs a saved widget's own SQL and, on
   failure, returned `toolOk({ error: "Query execution failed." })` with no
   logging at all. `llm_tool_calls` durably records *that* a tool failed and
   its `error_code`, never *why*, so the cause existed nowhere.
3. `POST /api/query` — the endpoint that executes each widget's SQL, and
   therefore where the `there is no parameter $1` incident behind
   [D-041](D-041-e2e-required-for-features.md) surfaced — wrote to none of the
   observability tables. Worse than the audit reported: its `isClientError`
   branch (Postgres class 22/42, which is exactly where `42P02`
   `undefined_parameter` lands) emitted **no `console.error` either**. That
   failure produced no trace anywhere, of any kind.

Compounding all three: production containers have no logging driver, no
rotation and no shipper configured, so container stdout dies on the next
`ps prod deploy`. Anything not in Postgres is gone.

**Decision**:

- Every user-facing route tree carries an `error.tsx`, and the app carries a
  root `global-error.tsx`. Segment boundaries share `components/RouteError.tsx`
  and must NOT render `<html>`/`<body>`; `global-error.tsx` must, because it
  replaces the root layout.
- A tool handler that swallows a database or query failure logs the error
  **object** (not `err.message`, so the stack survives) with the
  `[${ctx.requestId}]` prefix used across the codebase, before returning the
  generic model-facing message. What the model receives does not change.
- `POST /api/query` persists every failure to `query_errors`, keyed on the same
  `request_id` the user is shown under "Detalles técnicos".

**Alternatives rejected**:

- *Fold query failures into `llm_errors`.* Its `provider` column is `NOT NULL`
  and no LLM is involved at request time, so every row would carry a fake
  provider and every future query of that table would need a filter.
  `/admin/interactions/[request_id]` reads it expecting LLM context. A separate
  dedicated table is honest and smaller.
- *Log every one of the 21 bare `catch` blocks in the tool handlers.* Most are
  `JSON.parse` of the model's own tool arguments, returning `INVALID_ARGS` —
  self-describing, and the arguments are already in `llm_tool_calls`. Logging a
  `SyntaxError` there adds noise, and noise in a log is itself a diagnostic
  hazard. Only the five sites that destroy a real Postgres error are logged.
- *Fire-and-forget the `query_errors` insert.* The response is already an
  error, so awaiting costs nothing that matters, and a detached promise can
  lose the row — which defeats the point.

**Rationale**: The distinguishing property is surviving a deploy, not being
verbose. Postgres survives; stdout does not. The `requestId` already reaches
the user and already prefixes most log lines, so it is the correlation handle
to lean on rather than inventing another.

**Known limits, stated rather than implied**: an error boundary makes a client
failure *legible*, not *observable* — `console.error` inside one runs in the
visitor's browser. There is still no channel carrying browser errors to the
operator, and no `window.onerror`/`unhandledrejection` handler. A reporting
endpoint is the natural follow-up and is deliberately not in this change.
`query_errors` has no pruning, consistent with every other observability table
here.

**See**: `dashboard/lib/query-errors.ts`, `dashboard/components/RouteError.tsx`,
`dashboard/app/global-error.tsx`, `dashboard/lib/llm-tools/handlers/{sql,dashboards}.ts`,
`etl/schema/init.sql` (`query_errors`), [D-041](D-041-e2e-required-for-features.md).
