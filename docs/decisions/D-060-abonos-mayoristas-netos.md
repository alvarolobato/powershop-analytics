---
id: D-060
title: Los abonos mayoristas se restan, nunca se excluyen
date: 2026-08-30
---

# D-060: Los abonos mayoristas se restan, nunca se excluyen

*Decidido: 2026-08-30*

**Contexto**: La issue #920 se abrió porque nadie había medido si 4D guarda el
importe de un abono mayorista en positivo o en negativo, y el repositorio decía
las dos cosas a la vez: `docs/etl-sync-strategy.md` mandaba **excluirlos**
(`WHERE abono = false`) y `docs/data-dictionary.md` mandaba **restarlos**. Con
esa contradicción sin resolver, las plantillas eligieron excluir.

Medido contra producción el 2026-08-30:

| | facturas | líneas | líneas > 0 | líneas < 0 |
|---|---|---|---|---|
| `abono = false` | 10.752 | 790.353 | 787.422 | 1 |
| `abono = true` | 8.597 | 220.967 | 220.885 | 4 |

Los abonos están en **positivo**, igual que las devoluciones de retail
([D-057](D-057-ventas-netas-de-devoluciones.md)). En cabecera lo mismo: 8.595 de
8.597 abonos tienen `base1+2+3` positiva. Por tanto `WHERE abono = false` no
resta la devolución, la ignora, y la facturación sale inflada:

| | excluyendo | neto | diferencia |
|---|---|---|---|
| 2026 | 3.677.893 € | 3.199.868 € | −13,0 % |
| histórico | 53.880.139 € | 47.169.063 € | −12,5 % |

El margen mayorista de 2026 pasa de **25,1 % a 21,4 %**.

No son documentos de otra naturaleza: son muchos (8.597 frente a 10.755, el 44 %)
pero pequeños — importe medio 781 € frente a 5.010 € de una factura normal. Ese
perfil es el de devoluciones reales.

**Decisión**: el importe mayorista es SIEMPRE el neto:

```sql
COALESCE(SUM(x) FILTER (WHERE abono IS NOT TRUE), 0)
  - COALESCE(SUM(x) FILTER (WHERE abono IS TRUE), 0)
```

Con dos reglas que lo acompañan:

1. **El `COALESCE` va en los dos lados.** Sin el del abono, un periodo sin
   devoluciones da `algo − NULL` = NULL y la cifra desaparece de la pantalla en
   vez de quedarse igual. Es el mismo fallo que D-057 documenta para retail.
2. **Si se netea con `FILTER`, hay que QUITAR el `WHERE abono IS NOT TRUE`.**
   Dejarlo vacía el lado del abono, el "neto" vuelve a ser el bruto y no se
   nota: la expresión del neteo está ahí, parece correcta y devuelve el número
   antiguo. Pasó al escribir este mismo cambio, en el KPI de margen de
   `general.ts`. Lo vigila `dashboard/lib/__tests__/abonos-netos.test.ts`.

Los recuentos y los listados sí conservan el filtro: "número de facturas" cuenta
facturas, no abonos, y el listado de albaranes recientes muestra entregas.

**Alternativas rechazadas**: *excluir los abonos* — es lo que había, y es
justamente lo que produce el 13 % de más. *Confiar en el signo* (`WHERE total > 0`)
— no funciona, porque el importe está en positivo y ese filtro no los excluye;
por eso convivía con el bug sin que nadie lo viera.

**Ver**: #920, #932, [D-057](D-057-ventas-netas-de-devoluciones.md),
`dashboard/lib/sql-fragments.ts` (`netoDeAbonos`).
