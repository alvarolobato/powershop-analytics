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

The stored `content` has no `tool_calls` key at all and `llm_tool_calls` holds
no rows for the window — the model wrote the block rather than calling
anything. Both turns were persisted with `status='complete'`. The user, shown
what looked like a finished answer, asked the same question three times.

**Corrections after auditing the full corpus** (an earlier draft of this record
got both of these wrong, and they are the kind of claim a future reader would
build a detector on):

- *Scale*: this is not two turns in one conversation. **13 of 120 assistant
  messages (10.8%)**, across 8 conversations, spanning 2026-08-12 to 08-29.
  Roughly one answer in nine becomes a hard error once the guard is live — a
  real cost, accepted because a silent wrong answer is worse, but it is also
  why the deferred auto-retry (below) is worth revisiting.
- *Signature*: the claim that fabrications never contain ` → result` is
  **false** — 10 of the 13 do. The model copies the results out of history too.
  The discriminator is the absence of real tool calls, never the arrow.

There are also **two distinct mechanisms** behind the one symptom: 10 are the
model imitating the history framing, and 3 are DeepSeek emitting its native
DSML tool-call markup that OpenRouter failed to parse into `tool_calls`, which
`openrouter.ts` then returned as `kind:"final"` because the text was non-empty.

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
   before persisting and **throws** on a match, so the turn is persisted as an
   `is_error` assistant message, never as `complete`. The discarded text is
   written to the turn's error event, because container stdout dies on deploy
   and Postgres is the only durable trace (D-047).

The predicate has **two tiers**, and the split matters:

- **Unambiguous provider markup** (DSML, `<function_calls>`, `<|python_tag|>`,
  harmony `<|channel|>commentary to=`) fails a turn **regardless of the tool
  count**. Raw tool-call syntax is never a valid final answer. Gating it behind
  zero-calls disabled it in exactly the case it was written for: round 1 calls a
  tool successfully, round 2 emits markup, `ctx.toolCalls` (which accumulates
  across rounds and is never reset) is non-zero, and the markup sails through.
- **Loose shapes** (`<tool_call>`, `<parameter …>`, `[TOOL_CALLS]`) and the
  framing check need `actualToolCalls === 0`, because they legitimately appear
  in an answer that shows an XML snippet. `[TOOL_CALLS]` is matched
  case-sensitively — case-insensitive fired on the markdown link
  `[tool_calls](url)`.

The framing check searches anywhere rather than anchoring at the start: one word
of preamble defeated `startsWith`, and this decision changes the very block the
model imitates, so its shape is expected to shift.

3. `flattenStoredMessage` skips stored assistant rows that are themselves
   fabrications. The 13 already in production carry the legacy heading in their
   text and were being replayed verbatim into every later turn — so in exactly
   the conversations that already relapsed, the model kept being shown the
   pattern it copied. The reframing alone could not fix that: it only affects
   blocks rendered from `tool_calls`, and a fabrication is plain text.

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
