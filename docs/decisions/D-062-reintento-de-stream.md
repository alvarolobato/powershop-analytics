---
id: D-062
title: Un corte de stream reintenta el paso; el gasto se registra aunque el run falle
date: 2026-08-31
---

# D-062: Un corte de stream reintenta el paso; el gasto se registra aunque el run falle

*Decided: 2026-08-31*

**Context**: El turno 7 de la conversación `39990d7e7b0b` (31/08 16:52) murió con
`GENERATE_FAILED: terminated` tras 168 s y 20 tool calls correctas. `terminated`
es lo que lanza undici cuando el otro extremo cierra la conexión en seco a mitad
del cuerpo de la respuesta. Reintentar a mano funcionó: el turno 9 completó en
143 s.

Una generación son ~11 llamadas de streaming encadenadas. El único reintento que
existía, `withOpenRouterRetry`, envuelve el `create()` inicial y **no** el
`for await` del cuerpo, así que un corte en la ronda 10 tiraba las diez rondas ya
pagadas.

Al investigarlo apareció algo peor: `logUsage` sólo corría cuando el runner
**retornaba**. Verificado en producción — el turno 7 hizo 20 tool calls entre
16:52:18 y 16:55:06 y no dejó ni una fila en `llm_usage` entre las 16:52:21 y las
17:07:18. Unas 10 rondas de ~300k tokens facturados por OpenRouter, invisibles
para `checkDailyBudget` y para `/admin/usage`.

**Decision**:

1. Un paso del modelo que falle por **corte de red** se reintenta hasta
   `dashboard.agentic_max_stream_retries` veces (por defecto 2). Es seguro
   porque `messages` no se muta hasta después de que el paso vuelva bien y las
   herramientas del catálogo son de sólo lectura: reenviar la misma petición es
   idempotente.
2. El clasificador es **estrecho a propósito** (`esCorteTransitorioDeStream`):
   sólo `terminated`, `ECONNRESET`, `socket hang up`, `other side closed`,
   `premature close`, `EPIPE`, `UND_ERR`, mirando también dentro de `cause`. Un
   error de aplicación —presupuesto, 400, `TOOL_TIMEOUT`, `LLM_EMPTY`— falla a la
   primera. Reintentar un error de aplicación es dinero quemado y un fallo que
   tarda el triple en aparecer.
3. **El gasto se registra siempre**, también cuando el run muere: el error
   transporta lo acumulado y `assemble` lo escribe antes de relanzar, dentro de
   un `try` que nunca puede tapar el error original.
4. `err.cause` se aplana en el mensaje (`conCausa`): undici mete ahí el detalle
   real y se descartaba.

**Alternatives rejected**:
- *Atar un `AbortController` al ciclo de la petición*: se barajó cuando la
  hipótesis era que Next.js mataba los fetch al desmontar el contexto de la
  petición. La hipótesis es **falsa** —el fondo siguió 3 min 50 s después de
  cerrarse la petición originante, con 15 tool calls correctas— y el cambio
  habría matado los fetch de verdad.
- *Subir timeouts*: ninguno disparó. Ninguno de los configurados vale 233 s ni
  65 s. Sólo enmascararía cuelgues reales.
- *Cambiar de modelo o proveedor*: un transitorio con N=1 no es evidencia, y
  [D-056](D-056-multi-model-support.md) exige neutralidad de modelo.
- *Reintentar el run completo en vez del paso*: redundante si el reintento por
  paso está bien hecho, y duplica el coste de un run entero.
- *Relajar `readInt` para todas las claves*: el 0 debe seguir colapsando al valor
  por defecto en rondas y timeouts, donde no significa nada. Se añadió
  `readIntCeroValido` **sólo** para el contador de reintentos, donde 0 es el
  apagado legítimo — sin eso, ponerlo a 0 devolvía 2 en silencio.

**Rationale**: el coste de reintentar un paso son los tokens de entrada de esa
ronda, que con la caché de OpenRouter (95 % de acierto medido) son céntimos. El
coste de no reintentar es un run de cuatro minutos perdido y un usuario
repitiendo la pregunta a mano. La asimetría es enorme y el riesgo, acotado por lo
estrecho del clasificador.

**See**: `dashboard/lib/llm-tools/runner.ts` (`esCorteTransitorioDeStream`,
`conCausa`, `runStepConReintento`), `dashboard/lib/llm-context/assemble.ts`,
`dashboard/lib/llm-tools/config.ts` (`readIntCeroValido`), PR #948,
[D-049](D-049-async-dashboard-generation-tool.md) (la durabilidad ante reinicios
se descartó expresamente), [D-024](D-024-surface-cli-errors.md),
[D-043](D-043-cli-usage-metering-and-budget.md).
