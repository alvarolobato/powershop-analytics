---
id: D-066
title: Las tablas upsert no tienen «full» programado; se reconcilian por particiones
date: 2026-09-03
---

# D-066: Las tablas upsert no tienen «full» programado; se reconcilian por particiones

*Decidido: 2026-09-03*

**Context**:

`run_full_sync` prometía en su docstring que la pasada nocturna hace *«truncate-and-reinsert (so hard-deletes in 4D are reflected)»*. Para las tablas upsert eso es **falso**: `etl/sync/ventas.py` y `etl/sync/stock.py` no contienen ni un TRUNCATE ni un DELETE. Un «full» de `ventas`, `lineas_ventas`, `pagos_ventas`, `traspasos` o `stock` es literalmente un delta con `since=2014-01-01`.

Es decir, la pasada que costaba entre 2 y 3,5 horas cada noche —y que fallaba 114 de 151 veces en 30 días— no hacía lo único que justificaba su existencia.

Medido en el run 1594 (2026-09-03, 207 minutos en total):

| tabla | min | ¿trunca? | borrados verificados | filas con `FechaModifica` NULL |
|---|---|---|---|---|
| `stock` | 81,1 | no | 0 | **599** |
| `lineas_ventas` | 34,3 | no | 34 | 0 |
| `ventas` | 20,8 | no | **0** | 0 |
| `pagos_ventas` | 18,0 | no | 32 | 0 |
| `traspasos` | 3,3 | no | **0** | (no tiene la columna) |
| `gc_lin_albarane` | 22,7 | **sí** | — | — |
| `gc_lin_facturas` | 20,8 | **sí** | — | — |

Los borrados se verificaron comparando claves primarias contra 4D y confirmando **cada candidata por valor numérico**. La comparación textual da falsos positivos: el espejo escribe `10087687.990` (NUMERIC(20,3)) donde 4D escribe `10087687.99`. Con ese artefacto, `ventas` parecía tener 11 borrados y `pagos_ventas` 43; los números reales son 0 y 32.

**Decision**:

Las tablas con watermark que **no truncan** usan su watermark también en la pasada nocturna, en vez de barrer desde 2014. La lista vive en `SIN_BARRIDO_COMPLETO` (`etl/main.py`).

Su corrección viene de la **reconciliación por particiones** (`etl/sync/reconcile.py`), que compara un censo por partición entre origen y espejo, baja sólo a por las que no cuadran, y **sí borra** las claves que ya no están en 4D — cosa que el barrido nunca hizo.

Sólo llevan reconciliación las tablas con borrados demostrados: `lineas_ventas` y `pagos_ventas`. `ventas`, `traspasos` y `stock` dieron cero y no la llevan: sería pagar un censo cada noche para no encontrar nunca nada. Hay un test que fija esa lista para que añadir una spec exija justificarla.

El barrido completo sigue siendo alcanzable por dos caminos, y sólo por esos dos: una tabla sin watermark (carga inicial) y «Forzar resync», que borra los watermarks antes de arrancar.

**Excepción: `stock`.** No trunca y aun así conserva el barrido, porque su sync hace `include_nulls = since is None`: la pasada completa es lo único que trae las filas con `FechaModifica` NULL, invisibles al delta por definición. Hay 599 en el espejo. Quitárselo exige antes que el delta las incluya.

**Alternatives rejected**:

- *Pasar el barrido a semanal.* Espaciar algo que no hace nada sigue sin hacer nada, y mientras tanto deja una semana de deriva sin detectar en vez de un día.
- *Reconciliar las cinco tablas grandes.* Tres no tienen borrados. El censo acotado cuesta poco, pero no cero, y añade una consulta nocturna al ERP en vivo por tabla para no encontrar nada.
- *Fiarse de los huecos en la secuencia de claves para detectar borrados.* No sirve: el entero de la PK lo comparten muchas tiendas a la vez (verificado: el entero `10021142` lo usan 13 tiendas), y un hueco dentro de una tienda es un número que se llevó otra. Además un contador puede saltar sin que se haya borrado nada.

**Rationale**:

Una pasada de 3,5 horas que se justifica por reflejar borrados, y que no borra, es peor que no tener nada: consume la máquina media jornada, compite con el dashboard por el mismo Postgres, y da una sensación de cobertura que no existe. La reconciliación hace el trabajo real —anoche quitó 34 filas y dejó el espejo cuadrando con 4D fila a fila— en 59 segundos.

**See**:

- `etl/main.py::SIN_BARRIDO_COMPLETO`, `etl/sync/reconcile.py`
- `etl/tests/test_scheduler.py::TestBarridoCompleto`, `etl/tests/test_reconcile.py`
- [#963](https://github.com/alvarolobato/powershop-analytics/issues/963) — la investigación que lo destapó
- [D-065](D-065-watermark-solo-avanza-con-exito.md) — el barrido era lo único que tapaba los huecos de watermark; por eso se arregló antes que esto
- [D-003](D-003-single-select-no-offset.md), [D-004](D-004-stock-sync-per-store.md) — restricciones de lectura sobre 4D que condicionan el censo
