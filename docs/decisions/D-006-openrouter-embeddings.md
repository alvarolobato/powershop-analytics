---
id: D-006
title: OpenRouter embedding routing
date: 2026-03-31
---

## STATUS: retirada (2026-08-30) — WrenAI fuera de producción

El dashboard hace el mismo trabajo y los seis contenedores de WrenAI (`wren-ui`, `wren-ai-service`, `wren-engine`, `ibis-server`, `qdrant`, `bootstrap`) costaban 1,2 GB en una máquina de 16 GB que estaba matando al ETL por falta de memoria. Esta decisión queda sin objeto; se conserva para arqueología.

---

# D-006: OpenRouter embedding routing

*Decided: 2026-03-31*

**Context**: litellm does not support `openrouter/` prefix for embeddings, only for chat completions.
**Decision**: Use `openai/text-embedding-3-large` model name with `OPENAI_API_BASE=https://openrouter.ai/api/v1`. litellm routes it correctly via the base URL.
**Rationale**: The `openrouter/` prefix causes "Unmapped LLM provider" error for embeddings. The `openai/` prefix with OpenRouter base URL works.
