# Informe — Workflows AI desactivados

> Análisis de los 21 workflows `.github/workflows/ai-*.yml.disabled` con vistas a una **reactivación conservadora** de la AI Factory (D-011, epic #121).
>
> Fecha: 2026-05-07. Asume Claude vía `anthropics/claude-code-action@v1` con OpenRouter (Sonnet 4 ≈ $3/M input + $15/M output; Opus ≈ $15/M + $75/M; Haiku ≈ $0.80/M + $4/M).

## Resumen ejecutivo

| Tier | Cuántos | Coste mensual estimado | Recomendación |
|------|--------:|-----------------------:|---------------|
| **0 — Sin LLM** | 4 | $0 | Reactivar ya |
| **1 — Cron, Haiku, bajo coste** | 7 | ~$30–60 | Reactivar tras tier 0 |
| **2 — Cron, Opus/Sonnet, coste medio** | 2 | ~$80–110 | Reactivar con monitorización |
| **3 — Event-driven con multiplicador** | 8 | ~$300–800+ | NO reactivar sin presupuesto y rediseño |

**Coste si se reactiva todo tal cual**: ~$500–1.000 USD/mes asumiendo 1–2 PRs/semana y 5–10 issues/mes. En ráfagas de actividad puede multiplicarse fácilmente x2–x3.

**Coste plan conservador (tier 0 + 1, opcional tier 2)**: ~$30–170 USD/mes.

---

## Tier 0 — Sin coste de LLM (reactivar ya)

Estos workflows **no llaman a Claude**. Sólo cuestan minutos de runner gratuito en repo público.

| Workflow | Trigger | Runtime | Qué hace |
|----------|---------|--------:|----------|
| `ai-watchdog` | cron `*/15 * * * *` (96/día) | ≤10 min | Bash + `gh` CLI. Recupera workflows colgados, re-dispatcha jobs huérfanos, restaura etiquetas `ai-auto-retry`. **Crítico para que el resto de la factoría no quede en zombi.** |
| `ai-pr-labeler` | `pull_request_target` open/sync | ~2 min | `actions/github-script@v7`. Etiqueta PR por tamaño y riesgo (líneas cambiadas). |
| `ai-auto-release` | cron `0 20 * * 0` (Dom) | ~5 min | Bash + `gh`. Genera changelog y crea release semanal. |
| `ai-deploy-notify` | `release: published` | ~2 min | Crea issue de aviso al publicar release. |

**Riesgo**: bajo. El único matiz es `ai-watchdog` corriendo 96 veces/día — verificar que los pasos dentro del loop sean idempotentes (sí lo son a primera vista, pero hay un `sleep 15` secuencial que puede acumular si hay muchos PRs en cola).

---

## Tier 1 — Cron + Haiku/Sonnet, bajo coste (reactivar después)

Tareas planificadas, mayoritariamente con Haiku. Cada ejecución suele ser de un solo comentario o issue. Coste por ejecución: $0.05–$0.30.

| Workflow | Cron | Runtime | Modelo | Tokens/run (est.) | $/mes (est.) | Qué hace |
|----------|------|--------:|--------|------------------:|-------------:|----------|
| `ai-etl-health` | `0 8 * * 1-5` (22/mes) | ~8 min | Haiku, 15 turns | 8k in / 3k out | $5–8 | Audita schema y sincronía ETL, abre issue si hay drift. |
| `ai-project-summary` | `0 9 * * 1-5` (22/mes) | ~10 min | Haiku, 15 turns | 8k / 3k | $5–8 | Resumen diario de PRs/issues/AI activity. |
| `ai-docs-patrol` | `0 14 * * 2` (4/mes) | ~10 min | Haiku, 20 turns | 10k / 4k | $1–2 | Detecta desfase entre docs y código. |
| `ai-dashboard-audit` | `0 14 * * 3` (4/mes) | ~15 min | Haiku, 20 turns | 10k / 4k | $1–2 | Build + types + tests del dashboard, comenta si hay regresiones. |
| `ai-sql-validator` | `0 10 * * 1` (4/mes) | ~5 min | Haiku, 15 turns | 7k / 3k | $1 | Valida los SQL pairs de WrenAI contra Postgres. |
| `ai-security-audit` | `0 10 * * 5` (4/mes) | ~12 min | Haiku, 20 turns | 12k / 5k | $1–2 | npm audit + pip-audit + revisión Claude. |
| `ai-stale-manager` | `0 16 * * 5` (4/mes) | ~8 min | Haiku, 20 turns | 10k / 4k | $1–2 | Cierra issues/PRs stale, respeta `p0-critical` y `p1-high`. |
| `ai-issue-triage` | `issues: opened` (no bots) | ~3 min | Haiku, 10 turns | 5k / 2k | $2–4 | Etiqueta y propone prioridad para issues nuevas. |

**Suma tier 1**: ~$15–30/mes.

**Riesgo**: bajo. El único event-driven aquí es `ai-issue-triage`, limitado naturalmente por la frecuencia de creación de issues humanas.

---

## Tier 2 — Cron + Opus/Sonnet, coste medio (reactivar con monitor)

Tareas planificadas que invocan modelos caros. Útiles pero no esenciales.

| Workflow | Cron | Runtime | Modelo | Tokens/run | $/mes | Qué hace |
|----------|------|--------:|--------|-----------:|------:|----------|
| `ai-bug-hunter` | `0 11 * * 1-5` (22/mes) | ~10 min | Sonnet, 25 turns | 20k / 8k | $30–60 | Escanea repo en busca de bugs, abre issue si encuentra algo. |
| `ai-feature-ideas` | `0 14 * * 4` (4/mes) | ~15 min | **Opus**, 40 turns | 25k / 10k | $40–60 | Propone ideas de features. Opus por elección de diseño. |

**Suma tier 2**: ~$70–120/mes.

**Riesgo**: medio. `ai-feature-ideas` es Opus, así que cada run cuesta ~$10. Recomendable bajarlo a Sonnet si el output sigue siendo útil. `ai-bug-hunter` es razonable como está.

---

## Tier 3 — Event-driven con multiplicador (NO reactivar sin rediseño)

Aquí está el riesgo real. Estos se disparan en eventos de usuario (PR, comentario, label, fallo CI) y tienen `max_turns` muy altos. **Una ráfaga de actividad puede disparar el coste fácilmente x5–x10.**

| Workflow | Trigger | Timeout | Modelo / max_turns | Coste por evento (est.) | Qué hace |
|----------|---------|--------:|--------------------|------------------------:|----------|
| `ai-pr-review` | label `ai-ready-for-review` | 45 min | Opus, 80 turns | $5–15 | Revisión completa del PR + actualiza fase. |
| `ai-address-feedback` | `pull_request_review: submitted` | 50 min | Sonnet, 80 turns | $3–10 | Responde a comentarios inline aplicando cambios. **Se dispara en CADA review submission.** |
| `ai-ci-remediation` | `workflow_run` fallido en `ai/*` | 45 min | Sonnet, 120 turns | $3–8 | Auto-fix de fallos CI en ramas `ai/*`. **120 turns y sin tope explícito de reintentos** — si el job realmente está roto, gasta tokens sin progreso. |
| `ai-worker` | label `ai-work` | 30 + 60 min | Sonnet, 40 + 120 turns | $5–12 | Plan + implement de issues. Dos fases secuenciales por issue. |
| `ai-plan` | `/plan` en comentarios | 20 min | **Opus**, 40 turns | $5–8 | Plan de implementación on-demand. |
| `ai-command` | `/ai …` en comentarios | 15 min | Sonnet, 120 turns | $2–5 | Slash command genérico. **120 turns y sin scope guard**: `/ai fix everything` puede tocar todo el repo. |
| `ai-test` | `workflow_dispatch` | variable | Sonnet, 5 turns | $0.10–0.30 | Ping de prueba manual. Sólo coste si lo lanzas. |

### Problemas de diseño detectados

1. **Concurrencia global en `ai-pr-review` y `ai-address-feedback`**: serializan TODO Opus. Con 3 PRs en paralelo, el último espera ~2h.
2. **`ai-ci-remediation` 120 turns**: sin circuito de "después de N intentos, parar". Combinado con CI rojo persistente puede gastar ~80k tokens input por intento sin avance.
3. **`ai-command` sin scope**: cualquiera con permisos puede escribir `/ai refactoriza todo el ETL` y dispara el gasto.
4. **`ai-worker` plan + implement**: 30 + 60 min de timeout, dos llamadas a Claude por issue. Si la fase plan es ambigua, implement parte de mala base y reintenta caro.
5. **Falta `concurrency:` por-issue/por-PR en varios**: una issue con label `ai-work` puesta y quitada dos veces dispara dos workers en paralelo.

---

## Plan de reactivación conservadora (recomendado)

### Fase 1 — Inmediata (coste ~$0/mes)
Reactivar **tier 0** completo. Renombrar de `.yml.disabled` a `.yml`:
- `ai-watchdog`
- `ai-pr-labeler`
- `ai-auto-release`
- `ai-deploy-notify`

Justificación: cero coste LLM, alto valor operativo, y `ai-watchdog` es **prerequisito** para que el resto no quede colgado cuando se reactive más adelante.

### Fase 2 — 1 semana después (coste ~$15–30/mes)
Reactivar **tier 1** uno a uno, de menor a mayor frecuencia:
1. Empezar por los semanales (`ai-docs-patrol`, `ai-sql-validator`, `ai-stale-manager`, `ai-security-audit`, `ai-dashboard-audit`).
2. Si una semana después el gasto es razonable, añadir los diarios (`ai-etl-health`, `ai-project-summary`).
3. Por último `ai-issue-triage` (event-driven pero limitado).

Después de 2 semanas con tier 1, revisar consumo en OpenRouter y decidir si seguir.

### Fase 3 — Opcional (coste ~$70–120/mes)
Reactivar **tier 2** si el budget lo permite. Considerar:
- Bajar `ai-feature-ideas` de Opus a Sonnet (el output rara vez justifica el x5 de coste).
- Mantener `ai-bug-hunter` con Sonnet pero monitorizar señal/ruido del primer mes.

### Fase 4 — Sólo con rediseño previo
**No reactivar** tier 3 hasta haber:
1. Reducido `max_turns` a la mitad (40/60 en lugar de 80/120).
2. Añadido `concurrency:` por-PR / por-issue donde falte.
3. Añadido tope explícito de reintentos en `ai-ci-remediation` (ej: 3 intentos por commit).
4. Añadido scope guard en `ai-command` (ej: limitar a paths cambiados en el PR).
5. Establecido un budget cap en OpenRouter (alerta a $X/mes) para detener el gasto si una ráfaga descontrolada.

Una vez hecho esto, reactivar **uno a uno**:
- Primero `ai-worker` (es el que cierra el bucle issue → PR y justifica la factoría).
- Luego `ai-pr-review` (con concurrencia global aceptada como trade-off).
- Luego `ai-plan` y `ai-command` (los slash commands son los más arriesgados).
- Por último `ai-address-feedback` y `ai-ci-remediation`.

---

## Anexo — Tabla completa por trigger

| # | Workflow | Trigger | Modelo | Tier |
|---|----------|---------|--------|------|
| 1 | `ai-watchdog` | cron `*/15 * * * *` | — | 0 |
| 2 | `ai-auto-release` | cron `0 20 * * 0` | — | 0 |
| 3 | `ai-etl-health` | cron `0 8 * * 1-5` | Haiku | 1 |
| 4 | `ai-project-summary` | cron `0 9 * * 1-5` | Haiku | 1 |
| 5 | `ai-sql-validator` | cron `0 10 * * 1` | Haiku | 1 |
| 6 | `ai-security-audit` | cron `0 10 * * 5` | Haiku | 1 |
| 7 | `ai-bug-hunter` | cron `0 11 * * 1-5` | Sonnet | 2 |
| 8 | `ai-docs-patrol` | cron `0 14 * * 2` | Haiku | 1 |
| 9 | `ai-dashboard-audit` | cron `0 14 * * 3` | Haiku | 1 |
| 10 | `ai-feature-ideas` | cron `0 14 * * 4` | Opus | 2 |
| 11 | `ai-stale-manager` | cron `0 16 * * 5` | Haiku | 1 |
| 12 | `ai-pr-labeler` | `pull_request_target` | — | 0 |
| 13 | `ai-deploy-notify` | `release: published` | — | 0 |
| 14 | `ai-issue-triage` | `issues: opened` | Haiku | 1 |
| 15 | `ai-pr-review` | label `ai-ready-for-review` | Opus | 3 |
| 16 | `ai-address-feedback` | `pull_request_review` | Sonnet | 3 |
| 17 | `ai-ci-remediation` | `workflow_run` failure (`ai/*`) | Sonnet | 3 |
| 18 | `ai-worker` | label `ai-work` | Sonnet | 3 |
| 19 | `ai-plan` | `/plan` comment | Opus | 3 |
| 20 | `ai-command` | `/ai …` comment | Sonnet | 3 |
| 21 | `ai-test` | `workflow_dispatch` | Sonnet | 3 (manual) |
