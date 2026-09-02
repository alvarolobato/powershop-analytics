---
id: D-021
title: PR review policy capped at two fixed rounds (Copilot → Opus clean-context)
date: 2026-04-24
---

# D-021: PR review policy capped at two fixed rounds (Copilot → Opus clean-context)

*Decided: 2026-04-24*

**Context**: The prior policy (AGENTS.md) required re-requesting Copilot "until no new feedback". In practice this produced long loops where late nit-pick rounds blocked merges without meaningfully improving the code. The human owner called it "too much".
**Decision**: Every PR gets **exactly two review rounds, each run once**:
1. **Copilot** (bot) — request via the REST API pattern already documented. Address each comment with a code change or inline reply, then stop. No re-request.
2. **Opus** — run the PR review flow **from a clean Claude Code context** (fresh session, no prior conversation about the PR or branch) so Opus reviews the diff without being anchored to the implementation history. Address each comment with a change or reply, then stop. No re-request.
Merge after both rounds; if a comment is genuinely blocking and disputed, escalate to the human owner instead of opening a third round.
**Alternatives rejected**: Keeping the "until no feedback" loop (current pain point). Opus-only or Copilot-only (loses the cross-check). Running Opus in the implementation session (context bias defeats the purpose of a second opinion).
**Rationale**: Two independent reviewers, each exactly once, bounds the review cost while preserving a cross-check from a different vantage point. The clean-context requirement for Opus is the core of why round 2 is useful — without it, the review is correlated with the implementation.
**See**: `AGENTS.md` "PR and review policy" and issue-template tasks `N-1b` (Copilot) + `N-1c` (Opus).

## Revisado (2026-09-02): sólo Opus, una ronda

**Decisión del dueño**: se deja de usar Copilot. Cada PR lleva **una** ronda de
revisión, la de Opus desde contexto limpio.

**Qué lo motivó**. La regla anterior exigía Copilot primero y `ai-pr-review.yml`
se saltaba Opus si `fact-cp-after-1` no estaba puesto. Pero pedir Copilot
requiere un PAT concreto, y `GITHUB_TOKEN` descarta esas peticiones **en
silencio** (documentado en `ai-address-feedback.yml`: *"GITHUB_TOKEN silently
drops Copilot reviewer requests"*).

El resultado medido el 2026-09-01: de las últimas ocho PRs, **siete se
mergearon sin ninguna revisión**. La puerta pensada para garantizar el orden
acabó impidiendo la única revisión que sí se podía hacer. Y el coste fue real:
un fallo del CSV que sacaba los importes como texto no sumable llegó a
producción y sólo se detectó después, al pedir una revisión a mano.

Contribuyó un error del operador: se usaba la etiqueta `ai-ready-for-review`
cuando el disparador es `fact-ready-for-review` (renombrada por
[D-039](D-039-fact-label-vocabulary.md)), así que las revisiones que se creían
pedidas nunca se pedían. Pero la lección de fondo es la otra: **un mecanismo que
falla en silencio produce la ilusión de proceso**, y aquí fallaban dos a la vez.

**Qué cambia en la práctica**:
- `ai-pr-review.yml` ya no exige `fact-cp-after-1` ni lo pone. La convergencia
  se marca sólo con `fact-o-after-1`.
- Sigue habiendo una sola revisión por commit (idempotencia por head-SHA), y
  sigue sin haber tercera ronda: si algo queda bloqueado, se escala al dueño.

**Qué no cambia**: el humano aprueba el merge ([D-013](D-013-humans-approve-merges.md)).
