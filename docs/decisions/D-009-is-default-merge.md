---
id: D-009
title: Production knowledge merge strategy (is_default flag)
date: 2026-03-31
---

## STATUS: retirada (2026-08-30) — WrenAI fuera de producción

El dashboard hace el mismo trabajo y los seis contenedores de WrenAI (`wren-ui`, `wren-ai-service`, `wren-engine`, `ibis-server`, `qdrant`, `bootstrap`) costaban 1,2 GB en una máquina de 16 GB que estaba matando al ETL por falta de memoria. Esta decisión queda sin objeto; se conserva para arqueología.

---

# D-009: Production knowledge merge strategy (is_default flag)

*Decided: 2026-03-31*

**Context**: When pushing source knowledge to production WrenAI, we must not delete user-created instructions/SQL pairs.
**Decision**: Source entries use `is_default=1` in SQLite. Script deletes only `is_default=1` before re-inserting. User entries (`is_default=0`) are never touched. SQL pairs use question-text matching.
**Rationale**: Simple, robust, no schema changes needed. See issue #66.
