---
id: D-053
title: A turn that describes tool calls instead of making them must fail, never complete
date: 2026-08-29
---

# D-053: A turn that describes tool calls instead of making them must fail, never complete

*Decided: 2026-08-29*

**Context**: On 2026-08-28, conversation `0a566ce7cc78` (free chat, `mode='chat'`,
`context_kind='global'`) returned two consecutive answers that were a hand-written
imitation of the history tool-call block:

```
[Datos consultados con herramientas en esta respuesta]
- execute_query({"sql":"SELECT p.codigo, ... LIKE 'V265103%' ..."})
- execute_query({"sql":"SELECT c.color, SUM(lv.unidades) ..."})
- execute_query({"sql":"SELECT c.color, SUM(s.stock) ..."})
```

Evidence that the model wrote it rather than the code emitting it:

| Turn | Ask | Duration | Rows in `llm_tool_calls` |
|------|-----|----------|--------------------------|
| 5 | v265101 mismo informe | 20.6s | 3 |
| **6** | **v265103 mismo informe** | **5.9s** | **0** |
| **7** | **v265103 (repetido)** | **5.8s** | **0** |
| 8 | v26510399 todos los colores | 24.0s | 3 |

Every line lacks the ` → result` segment that `formatToolCallsForHistory`
appends unconditionally, and the stored `content` has no `tool_calls` key at
all — the model had no results to write because it never ran anything. Both
turns were persisted with `status='complete'`. The user, shown what looked like
a finished answer, asked the same question three times.

The cause was the framing. `flattenStoredMessage` prepends the tool block to the
assistant's own text, so after a few turns *every* prior assistant message in
history began with a plain Spanish heading. That reads as something an assistant
says, and the model completed the pattern instead of using the tools.

**Decision**: two binding rules.

1. The history tool block is framed as a tagged system record
   (`<herramientas_ya_ejecutadas>` … `</herramientas_ya_ejecutadas>`) carrying an
   explicit "never reproduce this block" instruction — not as a bare heading that
   reads like assistant prose.
2. `runTurnBackground` calls `looksLikeFabricatedToolLog(text, toolCallCount)`
   before persisting, and **throws** when a turn's final text has the tool-log
   shape with zero real tool calls. It is persisted as an `is_error` assistant
   message, never as `complete`.

The zero-tool-call condition is required, not incidental: it is what keeps a turn
that genuinely ran tools — and happens to quote itself — from being killed.

**Alternatives rejected**:
- *Retry the turn automatically.* Better UX in principle, but the dispatch in
  `turn-background.ts` has side effects per branch (`spec_update` events,
  streamed progress), so re-running risks duplicate emissions. Worth doing later
  behind a refactor that makes the dispatch idempotent; not worth the blast
  radius as a hotfix.
- *Drop the tool block from history entirely.* It was added deliberately
  (`ed3c177`) so later turns retain tool results; removing it trades one failure
  mode for a worse one.
- *Persist it as `complete` and let the UI flag it.* A fabricated log is
  indistinguishable from a real answer once rendered. Silence here means the user
  believes data was checked when nothing ran — strictly worse than an error.

**Rationale**: The failure is invisible by construction, which is what makes it
dangerous: it costs no error, no log line, and the answer looks authoritative.
Failing loudly converts a silent wrong answer into an obvious retry. The
reframing addresses the cause so the guard should rarely fire; the guard exists
because prompt-level fixes are never guarantees.

**See**: `dashboard/lib/llm-context/history.ts` (`formatToolCallsForHistory`,
`looksLikeFabricatedToolLog`), `dashboard/lib/turn-background.ts`,
`dashboard/lib/llm-context/__tests__/history.test.ts` (regression built from the
production payload), production conversation `0a566ce7cc78`.
