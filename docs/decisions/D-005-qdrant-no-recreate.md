---
id: D-005
title: Qdrant recreate_index: false
date: 2026-03-31
---

## STATUS: retirada (2026-08-30) — WrenAI fuera de producción

El dashboard hace el mismo trabajo y los seis contenedores de WrenAI (`wren-ui`, `wren-ai-service`, `wren-engine`, `ibis-server`, `qdrant`, `bootstrap`) costaban 1,2 GB en una máquina de 16 GB que estaba matando al ETL por falta de memoria. Esta decisión queda sin objeto; se conserva para arqueología.

---

# D-005: Qdrant recreate_index: false

*Decided: 2026-03-31*

**Context**: `recreate_index: true` in wren-config.yaml wiped all qdrant collections on every service restart, losing all indexed schema/instructions.
**Decision**: Set `recreate_index: false`.
**Rationale**: Collections and embeddings must survive restarts.
