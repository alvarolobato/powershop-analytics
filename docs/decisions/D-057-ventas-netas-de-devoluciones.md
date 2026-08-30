---
id: D-057
title: "Ventas" significa NETO de devoluciones, con el vocabulario de PowerShop
date: 2026-08-30
---

# D-057: "Ventas" significa NETO de devoluciones, con el vocabulario de PowerShop

*Decidido: 2026-08-30*

**Contexto**: el 2026-08-29 el encargado de Ferrol comparó el panel con su
pantalla de caja y no cuadraba:

| | ERP (PowerShop) | Panel |
|---|---:|---:|
| `01VEN` ventas | 1.630,09 | — |
| `02DEV` devoluciones | 201,46 | *ignoradas* |
| `NETO` | **1.428,63** | — |
| Mostrado (sin IVA) | 1.180,63 | **1.347** |

El panel mostraba `1.630,09 / 1,21 = 1.347`: las ventas brutas sin IVA, con las
devoluciones **descartadas** en vez de **restadas**. No era un fallo de Ferrol:

| Mes | Devoluciones ignoradas | Sobrestimación |
|---|---:|---:|
| 2026-05 | 23.516 € | +9,7 % |
| 2026-06 | 23.194 € | +9,7 % |
| 2026-07 | 20.618 € | +8,7 % |
| 2026-08 | 18.525 € | +7,4 % |

**Todas** las cifras de ventas del producto estaban infladas entre un 7 y un
10 %, unos 20.000 €/mes.

La causa no fue desconocimiento: la base de conocimiento del LLM describía
correctamente el cálculo neto en una regla, y luego le ordenaba
`filtrar entrada=true` en otras cuatro. Ganó la instrucción dominante. El
filtro aparecía 117 veces en 19 ficheros, incluidos los *prompts*, así que la
IA también aprendía a escribir SQL que ignora devoluciones.

**Decisión**: se adopta el vocabulario del propio ERP, sin inventar
representaciones nuevas.

PowerShop presenta tres cifras distintas y el espejo las refleja tal cual:

- `01VEN` — ventas brutas
- `02DEV` — devoluciones (importe y unidades **en positivo**)
- `NETO` — `01VEN − 02DEV`

Cuando el usuario dice "ventas" sin más matices se refiere al **NETO**. El
patrón obligatorio para cualquier importe o unidad agregada:

```sql
COALESCE(SUM(x) FILTER (WHERE entrada), 0) - COALESCE(SUM(x) FILTER (WHERE NOT entrada), 0)
```

**El `COALESCE` no es cosmético.** Sin él, un grupo sin filas de un lado
devuelve `NULL` (`NULL − algo = NULL`), y como `NULL` ordena **primero** en un
`ORDER BY ... DESC`, los artículos sin devoluciones — el 30,6 %, 8.726 de
28.493 referencias — se comían el top entero. El par "top 10 artículos más
vendidos" devolvía diez filas vacías.

Excepciones legítimas, donde `entrada = true` a secas es lo correcto:

- contar **tickets** de venta (una devolución no es un ticket vendido)
- medias por línea vendida, p. ej. el descuento medio concedido
- la propia consulta de devoluciones, que filtra `entrada = false`

**Alternativas rechazadas**:

- *Una columna calculada con el importe ya firmado.* Fue mi primera propuesta y
  el dueño la rechazó con razón: inventa una representación que no existe en
  PowerShop, y entonces las cifras del espejo ya no se pueden cuadrar contra la
  pantalla del ERP. El espejo debe hablar el idioma del origen.
- *Guardar las devoluciones en negativo.* Verificado contra producción: 88.891
  devoluciones, **cero** con importe negativo. Cambiar el signo al cargar
  divergiría del origen y rompería cualquier comparación con el ERP.
- *Arreglar solo las consultas del panel.* El filtro estaba también en los
  prompts y en el bundle, así que la IA habría seguido generando SQL bruto.

**Equivalencia con el código de producción**: los programas VFP discriminan por
`Ventas.CodigoMovCaja` (`IIF(codigo='01', +1, −1)`), no por `Entrada`.
Verificado que son equivalentes — y que `Entrada` es **más fino**: existe un
tercer código `03` ("Otras Entradas"), que el VFP restaría y que `Entrada=true`
suma, que es lo correcto.

| `CodigoMovCaja` | `Entrada` | Tickets (agosto) |
|---|---|---:|
| `01` venta | true | 13.840 |
| `02` devolución | false | 1.423 |
| `03` otras entradas | **true** | 1 |

**Ver**: `docs/etl-sync-strategy.md` (`## LLM:rules`),
`docs/dashboard/sql-pairs.md`, `dashboard/lib/llm-context/system-prompt.ts`,
`dashboard/app/api/home/route.ts`,
`dashboard/lib/__tests__/ventas-netas-regresion.test.ts`, issue #916.
