---
id: D-064
title: clave_temporada no tiene formato fijo; el catálogo es ps_temporadas
date: 2026-09-01
---

# D-064: `clave_temporada` no tiene formato fijo; el catálogo es `ps_temporadas`

*Decided: 2026-09-01*

**Context**: El bundle de conocimiento llegó a contener dos convenios de
temporada a la vez: uno inventado ("PV = Primavera-Verano, OI = Otoño-Invierno")
que hacía construir la clave a partir del nombre, y otro con los formatos
medidos. La regla mala venía de antiguo; la buena la añadió #946 **sin retirar
la mala**, así que el modelo recibía las dos y ganaba una u otra según el turno.
Ese es el peor modo de fallo: funciona unas veces y otras no.

Pero la regla "buena" también estaba mal. Enumeraba tres formatos como si
fueran exhaustivos y decía literalmente *"no hace falta hacer SELECT DISTINCT
para averiguarlo"* — es decir, enseñaba a no mirar en un dominio que el negocio
cambia cuando quiere.

Medido el 2026-09-01: conviven numéricos (92, 93, 99), letra+año (V26, I25),
M-prefijados de mayorista (M80, MI26), PV26, y sueltos como BA, OU, TE.

**Decision**:

1. `clave_temporada` es **texto opaco sin formato fijo**. No se supone, no se
   deduce del nombre, no se construye. Preguntar por "primavera-verano 2026" no
   implica que la clave sea `PV26`.
2. **El catálogo autoritativo es `ps_temporadas`** (`clave` + `temporada_tipo`
   legible). Una temporada nombrada en palabras se **busca** ahí con `ILIKE`
   sobre `temporada_tipo`. Para saber qué existe: `SELECT clave, temporada_tipo
   FROM ps_temporadas ORDER BY clave`.
3. **Siempre `LEFT JOIN`, nunca `INNER`.** Hoy el catálogo cubre el 100 % de las
   claves de `ps_articulos` (71 filas, medido), pero una clave nueva sin dar de
   alta haría que un `INNER` se comiera esas ventas en silencio.
4. **No usar `ps_temporadas.inicio_ventas` / `fin_ventas`**: vacías en las 71
   filas. **`temporada_activ` no marca la temporada actual** (V26 está a `false`
   y 92 a `true`).
5. No filtrar por año natural: una temporada se vende antes de su año nominal
   (V26 registra su primera venta el 2025-12-06).
6. Ningún parser de temporadas puede descartar un código que no reconozca. Un
   código feo en un desplegable es cosmético; un código ausente es dato
   inalcanzable.

**Alternatives rejected**:
- *Enumerar los formatos vivos en la regla*: es lo que estaba mal. La lista
  caduca en cuanto el negocio añade una clave, y una regla que enumera invita a
  tratar la lista como cerrada.
- *Deducir el rango de fechas de la clave*: un rango inventado recorta datos en
  silencio, la misma clase de fallo que se está corrigiendo.

**Rationale**: el dominio lo controla el negocio, no el código. Cualquier regla
que fije el formato caduca; una que enseñe a mirar el catálogo, no.

**See**: `docs/etl-sync-strategy.md` (regla TEMPORADAS),
`dashboard/lib/seasons.ts`, `dashboard/lib/__tests__/convenio-de-temporadas.test.ts`,
PR #950, [D-063](D-063-una-carga-corta-es-perdida-de-datos.md).
