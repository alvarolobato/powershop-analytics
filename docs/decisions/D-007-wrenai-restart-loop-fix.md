---
id: D-007
title: WrenAI restart loop fix (remove SHOULD_FORCE_DEPLOY)
date: 2026-03-31
---

## STATUS: retirada (2026-08-30) — WrenAI fuera de producción

El dashboard hace el mismo trabajo y los seis contenedores de WrenAI (`wren-ui`, `wren-ai-service`, `wren-engine`, `ibis-server`, `qdrant`, `bootstrap`) costaban 1,2 GB en una máquina de 16 GB que estaba matando al ETL por falta de memoria. Esta decisión queda sin objeto; se conserva para arqueología.

---

# D-007: WrenAI restart loop fix (remove SHOULD_FORCE_DEPLOY)

*Decided: 2026-03-31*

**Context**: The wren-ai-service entrypoint waits for wren-ui on `WREN_UI_PORT` (unset), times out after 60s, exits 1, container restarts, queries get lost mid-processing.
**Decision**: Remove `SHOULD_FORCE_DEPLOY` env var. Deploy via `scripts/wren-push-metadata.py` instead of entrypoint auto-deploy.
**Rationale**: Eliminates the restart loop. Deploy is now explicit and reliable.
