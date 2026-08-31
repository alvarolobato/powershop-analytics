---
id: D-049
title: start_dashboard_generation runs detached, reporting back through the turn/SSE machinery
date: 2026-08-28
---

# D-049: `start_dashboard_generation` runs detached, reporting back through the turn/SSE machinery

*Decided: 2026-08-28*

**Context**: Production `llm_tool_calls` showed `start_dashboard_generation` at a 100%
failure rate — 10/10 calls, all `TOOL_TIMEOUT`, spanning 2026-08-12 to 2026-08-26. It had
never once succeeded. Root cause: `dashboard/lib/llm-tools/runner.ts` wraps every tool
dispatch in one `withTimeout(dispatchTool(...), cfg.toolTimeoutMs)` (15s in prod,
`DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS`), and the handler `await`ed a full nested
`generateDashboard()` call — itself a multi-round agentic loop with several LLM calls and
SQL exploration — inside that same 15s budget. A nested full generation structurally
cannot fit in 15 seconds, so every call was guaranteed to time out. It also compounded a
second problem: the model would call the tool, wait out the 15s, get a timeout, then burn
further agentic rounds retrying or improvising, contributing to requests hitting the
round/call caps.

Raising `toolTimeoutMs` was rejected: the other ~13 registered tools (`execute_query`,
`describe_ps_table`, `apply_dashboard_modification`, etc.) are quick, bounded DB reads —
giving all of them a multi-minute timeout to accommodate one categorically different tool
would hide a real hang in any of them for much longer before the model gets useful
feedback.

**Decision**: `handleStartDashboardGeneration` (`dashboard/lib/llm-tools/handlers/start-dashboard-generation.ts`)
no longer awaits generation. It validates arguments, kicks off the generation as a
detached (`void`, not awaited) background task, and returns immediately with
`{ status: "started", message: "…" }` — well inside the per-tool timeout. The tool's
catalog description (`dashboard/lib/llm-tools/catalog.ts`) and the returned `message`
both spell out, for the model's NEXT round, that generation has only just started, that
it must not call the tool again or wait, and that it should just tell the user and end
its turn.

The detached background task (`runBackgroundGeneration`) follows the same pattern
`POST /api/conversations/:id/turns` already uses for the outer turn itself
(`dashboard/lib/turn-background.ts`: create a tracking row, run the work, report through
`turn_events` + SSE, persist the final result as a `conversation_messages` row):

- It inserts a new `conversation_turns` row via a new `createBackgroundTurn()`
  (`dashboard/lib/turn-events.ts`) — same per-conversation advisory lock as
  `createTurnIfIdle`, but WITHOUT the "reject if a turn is already active" check, since
  this is system-initiated bookkeeping running alongside whatever turn (if any) is
  currently streaming, not a second user-submitted message competing for that slot.
- **`conversation_turns.source` (`'user'` | `'background'`, added post-review):** the
  tracking row is inserted with `source = 'background'`, and `createTurnIfIdle`'s
  active-turn guard now filters `AND source = 'user'`. Without this, the tracking row's
  `status = 'streaming'` for the whole 30s-2min generation was indistinguishable from a
  genuine in-flight user turn: any message the user sent in that window hit
  `createTurnIfIdle`, saw the tracking row as active, and got rejected with 409
  `TURN_IN_PROGRESS` — the chat going dead for up to two minutes, the exact opposite of
  what this decision set out to fix. `status` keeps its normal
  pending/streaming/complete/error meaning; SSE replay and `ConversationPane`'s
  turn-adoption logic key on `turnId`, not `source`, so neither needed to change.
- It emits `log` events (including the nested generation's own tool calls, e.g.
  `execute_query`) and a final `complete` or `error` event on that turn, via
  `insertTurnEvent` + `sse-pubsub.publish` — exactly what a live SSE client already knows
  how to render (`ConversationPane`'s turn-adoption logic needs no changes).
- On success, it persists the generated dashboard's summary as a normal assistant
  `conversation_messages` row (`appendMessage`), so the result is visible on reload even
  if no client was connected when it finished.
- On failure at any stage (LLM error, invalid spec, SQL lint failure, DB insert failure),
  it persists an `is_error: true` assistant message AND emits an `error` turn_event AND
  logs to the server console — mirroring `runTurnBackground`'s own catch block. Nothing
  fails silently: this codebase has a recurring pattern of swallowed background failures
  (see `runTurnBackground`'s own #824 fix), and prod has no cost/usage visibility to catch
  a silent one after the fact.
- Even a failure to create the tracking row itself (`createBackgroundTurn` throwing —
  e.g. a transient DB error) is surfaced: there is no `turnId` yet, so no `error`
  turn_event is possible, but an `is_error: true` assistant message is still appended
  directly. Before the post-review fix, this specific catch block only did
  `console.error` — the user had already been told "se está generando" and would never
  learn it failed.

**Alternatives rejected**:
- *Raise `toolTimeoutMs` globally or per-tool.* Rejected — see Context. A per-tool timeout
  override was considered but doesn't fix the shape of the problem: even 2 minutes is not
  a guaranteed upper bound for a multi-round agentic sub-generation, and it still leaves
  the outer agentic loop (and the user) blocked with no visibility for however long that is.
- *Pre-create a placeholder dashboard row so `dashboard_id`/`redirect_url` are known
  synchronously.* Rejected — nothing in the frontend consumes the tool's `redirect_url`
  synchronously (checked: only backend files and the unrelated D-032 handoff route
  reference it), so there is no UI benefit, and it would add a "generating" pseudo-state
  to the `dashboards` table for no payoff.

**Rationale**: This makes `start_dashboard_generation` consistent with how every other
long-running operation in the Dashboard App already works — turns are always
fire-and-forget from the API layer, with SSE as the progress/result channel — rather than
inventing a second mechanism. It also means a slow/failed generation degrades gracefully:
the enclosing free-chat turn finishes normally within its own budget, and the user is told
plainly what is happening instead of hitting a generic timeout error.

**Other tools checked for the same shape**: none. Every other registered tool handler
(`dashboard/lib/llm-tools/handlers/sql.ts`, `dashboard/lib/llm-tools/handlers/dashboards.ts`)
either runs a single bounded SQL statement (own `statement_timeout`) or only stages a
result object on `ctx` (`apply_dashboard_modification`, `submit_dashboard_analysis`,
`submit_weekly_review`) — no other handler awaits a nested LLM call or another
inherently-long operation.

**See**: `dashboard/lib/llm-tools/handlers/start-dashboard-generation.ts`,
`dashboard/lib/turn-events.ts` (`createBackgroundTurn`, `createTurnIfIdle`),
`etl/schema/init.sql` (`conversation_turns.source`), `dashboard/lib/turn-background.ts`,
`dashboard/lib/llm-tools/runner.ts` (`withTimeout`), `dashboard/lib/llm-tools/catalog.ts`.

## No sobrevive a un reinicio, y se acepta (2026-08-31)

La generación vive dentro del proceso de Node, así que un `ps prod update` la
mata a mitad. Se ve en producción: el barrido de arranque de `turn-events.ts`
marca esos turnos como "El servidor se reinició mientras se procesaba este
turno".

Se evaluó moverla a una tabla `generation_jobs` en PostgreSQL —mismo patrón que
`etl_manual_trigger` ([D-016](D-016-etl-manual-trigger-table.md))— con
re-encolado de huérfanos al arrancar. **Descartado por el dueño**: una sola
instalación, pocos usuarios y despliegues poco frecuentes, así que la
probabilidad de que un despliegue pille una generación en vuelo no justifica el
mecanismo. Si algún día hay más carga o despliegues continuos, se reevalúa.

Descartado también, y con más motivo, un worker o contenedor aparte: se
liberaron 1,2 GB retirando WrenAI ([D-058](D-058-wrenai-retirado.md)) en una
máquina que asfixiaba al ETL; añadir otro runtime revierte eso para comprar una
durabilidad que la tabla daba más barata.

Lo que sí se arregló, porque era otra cosa: un corte de red a mitad de stream
mataba el run entero y su gasto no se registraba — ver
[D-062](D-062-reintento-de-stream.md).
