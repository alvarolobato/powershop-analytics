---
id: D-048
title: La talla de una venta está en la línea, no en el artículo
date: 2026-08-30
---

# D-048: La talla de una venta está en la línea, no en el artículo

*Decidido: 2026-08-05 · **Reescrito 2026-08-30** con evidencia del 4D en producción*

> **Esta decisión invirtió su conclusión.** La versión original proponía
> resolver la talla uniendo `LineasVentas.CodigoAsociado` con
> `BarrasAsociado.Codigo`, marcándolo como hipótesis sin verificar porque
> ningún entorno alcanzaba el 4D. Cuando se pudo medir, la hipótesis resultó
> falsa y la solución real era mucho más simple. Se conserva el historial
> porque el error es instructivo.

**Contexto**: el dueño preguntó "de este artículo, ¿qué talla se vende más?" y
el sistema no podía responder.

## La hipótesis del código de barras, refutada

Ejecutado desde el contenedor ETL de producción, único sitio con ruta al 4D,
sobre **60.048 líneas de venta** desde 2026-07-01:

| Clave candidata | Coincidencias | Cobertura |
|---|---:|---:|
| `CodigoAsociado → BarrasAsociado.Codigo` | 0 | **0,0 %** |
| `Codigo → BarrasAsociado.Codigo` | 0 | **0,0 %** |

`LineasVentas.CodigoAsociado` está **vacío en el 100 %** de las líneas. No es
que empareje mal: no hay nada que emparejar.

**Por qué no podía funcionar**, y es lo que de verdad hay que entender: la
talla no existe a nivel de artículo. Una fila de `Articulos` es
**modelo + COLOR**, no un SKU:

| `CCRefeJOFACM` | `NumColor` | Descripción |
|---|---|---|
| `I26101830` | 17 | CHAQUETA DE ANTE |
| `I26101833` | 20 | CHAQUETA DE ANTE |
| `I26101855` | 35 | CHAQUETA DE ANTE |

Misma prenda, tres artículos, un color cada uno; los dos últimos caracteres de
la referencia son el color. La talla solo aparece cuando se vende una unidad
concreta. Buscarla a nivel de artículo era buscar en el nivel equivocado.

## La solución: ya estaba escrita

`LineasVentas.CCOPTallaOjo` contiene la talla, **poblada al 100 %** (31.944 de
31.944 líneas en agosto). Es lo que usa el código de producción desde hace
años (`pw_sacarventas.prg`), y la consulta correcta llevaba tiempo en
`docs/skills/report-generation.md`.

**Ese es el fallo de fondo**: no faltaba conocimiento, faltaba *distribución*.
`report-generation.md` no está en `docs/knowledge-sources.yml`, así que nunca
llegó al LLM. De 113 MDs en `docs/`, solo 12 alcanzaban al modelo, dejando 163
consultas SQL validadas fuera de su vista. Un PR entero se construyó sobre una
hipótesis que un `grep` habría refutado.

**Decisión**:

1. La talla de una venta se resuelve con `ps_lineas_ventas.talla`, sincronizada
   desde `CCOPTallaOjo`. **No** se usa `BarrasAsociado` para esto.
2. Se normaliza a **MAYÚSCULAS en el ETL**, no en cada consulta. El origen
   mezcla `'l'`/`'L'`, `'xl'`/`'XL'`: 46 valores distintos que son 34 reales.
   Sin normalizar, en el artículo de control la talla más vendida cambiaba de
   **L a M**. `ps_stock_tienda.talla` ya venía en mayúsculas (salvo un `6Xl`,
   también corregido), así que sin esto un cruce ventas↔stock perdería filas en
   silencio.
3. Un artículo es **modelo + color**. Para "top artículos" hay que agrupar por
   `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)`; agrupar por la referencia
   completa parte un mismo modelo en 3-5 filas y falsea el ranking.

**Alternativas rechazadas**:

- `BarrasAsociado` — 0 % de cobertura. Su función real es otra: es el catálogo
  de códigos escaneables por artículo×talla (etiquetado, RFID), y cubre solo el
  22 % de los artículos porque solo se puebla para los que lo necesitan. Que
  sea parcial demuestra que no es la tabla maestra de tallas.
- `Cubo` — el plan B que documentaba la versión anterior. Resultó ser un
  agregado de 1.778 filas con `NivelElegido`/`CodigoValor`, no un detalle por
  línea. No hizo falta.
- Normalizar en cada consulta en vez de en el ETL — dejaría el espejo sucio y
  cualquier consulta futura podría olvidarse del `UPPER()`.

**Ver**: `etl/sync/ventas.py`, `etl/schema/init.sql`,
`docs/dashboard/sql-pairs.md`, PR #914 (cerrada con esta evidencia),
[D-057](D-057-ventas-netas-de-devoluciones.md), issue #916.
