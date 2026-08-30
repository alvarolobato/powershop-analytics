# PowerShop Stock Analysis Guide

> How stock is tracked, moved, and reconciled — **as queried from the PostgreSQL
> mirror** (`ps_*` tables), which is the only thing the dashboard and WrenAI can
> execute against.
>
> **Dialect.** Every SQL block in this file is PostgreSQL against the mirror.
> The 4D ERP tables it derives from (`CCStock`, `Exportaciones`, `Traspasos`,
> `GCAlbaranes`…) are named only as *lineage*, never in a `FROM` clause: they do
> not exist in the mirror and a query against them fails.
>
> Date placeholders `:curr_from` / `:curr_to` (and `:comp_from` / `:comp_to` for
> the comparison period) are bound by the caller. Never hardcode `CURRENT_DATE`.

## Table of Contents

1. [Stock Model Overview](#1-stock-model-overview)
2. [ps_stock_central — Central Warehouse (Store 99)](#2-ps_stock_central--central-warehouse-store-99)
3. [ps_stock_tienda — Retail Store Stock](#3-ps_stock_tienda--retail-store-stock)
4. [Total Stock Calculation](#4-total-stock-calculation)
5. [Stock Movement Formula](#5-stock-movement-formula)
6. [Transfers (ps_traspasos)](#6-transfers-ps_traspasos)
7. [Wholesale Returns (ps_gc_albaranes)](#7-wholesale-returns-ps_gc_albaranes)
8. [Negative Stock](#8-negative-stock)
9. [Common Stock Queries](#9-common-stock-queries)
10. [What is NOT in the mirror](#10-what-is-not-in-the-mirror)

---

## 1. Stock Model Overview

Stock is split across **two mirror tables**, by location:

```
            +---------------------------+
            |       ps_articulos        |
            |  reg_articulo / codigo /  |
            |       ccrefejofacm        |
            +------+-------------+------+
                   |             |
     num_articulo  |             |  codigo
    = reg_articulo |             |  = codigo
                   |             |
      +------------v----+   +----v----------------------+
      | ps_stock_central|   |      ps_stock_tienda      |
      | central wh (99) |   | all retail stores, by size|
      | 1 row / article |   | 1 row / article+store+size|
      |   ~42.8k rows   |   |        ~13.6M rows        |
      +-----------------+   +---------------------------+
```

### Key rules

1. **`ps_stock_central`** holds the central warehouse (store 99). One row per
   article, keyed by `num_articulo` = `ps_articulos.reg_articulo`. It has **no
   size breakdown** — only a total `stock`.
2. **`ps_stock_tienda`** holds retail stores, keyed by
   `(codigo, tienda_codigo, talla)`. It joins to `ps_articulos` by **`codigo`**,
   not by a record id.
3. **Store 99 does not appear in `ps_stock_tienda`.** Filtering `tienda <> '99'`
   there is a no-op that costs nothing and documents intent; the central figure
   must come from `ps_stock_central`. A query that looks for central stock in
   `ps_stock_tienda` returns zero rows, not an error — which is the dangerous
   failure mode.
4. **Total stock for an article = central + all stores.** There is no
   pre-aggregated total column in the mirror; `ps_articulos` has no `stock`.
5. `ps_stock_tienda.talla` is normalised to **UPPERCASE** by the ETL, but the
   source mixes cases (`'6Xl'`), so always compare sizes with `UPPER()` on both
   sides when joining to `ps_lineas_ventas.talla`.
6. `stock` is a signed `INTEGER`. Negatives are real (see §8), so
   `SUM(stock)` is a *net* figure — add `WHERE stock > 0` when you want the
   gross positive position.

*Lineage:* `ps_stock_central` comes from 4D `CCStock` (582 columns, wide format),
`ps_stock_tienda` from 4D `Exportaciones` (161 columns, 34 size slots per row).
The ETL unpivots the 34 `StockN`/`TallaN` slot pairs into rows and applies the
signed-int16 decode of [D-017](decisions/D-017-signed-int16-stock.md). None of
that wide structure survives into the mirror.

---

## 2. `ps_stock_central` — Central Warehouse (Store 99)

**~42,800 rows.** One row per article at the central warehouse.

| Column | Type | Notes |
|--------|------|-------|
| `num_articulo` | `NUMERIC(20,3)` PK | FK → `ps_articulos.reg_articulo` |
| `stock` | `INTEGER` | Total units, all sizes summed. Can be negative. |
| `fecha_modifica` | `DATE` | Source modification date |

**No per-size detail exists here.** Size-level questions about the central
warehouse cannot be answered from the mirror — see §10.

```sql
-- Total units at the central warehouse (net, includes negatives)
SELECT COALESCE(SUM(sc."stock"), 0) AS "Unidades Central"
FROM "public"."ps_stock_central" sc;
```

```sql
-- Central stock valued at cost, active articles only
SELECT SUM(sc."stock" * p."precio_coste") AS "Valor Coste",
       SUM(sc."stock")                    AS "Unidades",
       COUNT(*)                           AS "Referencias"
FROM "public"."ps_stock_central" sc
JOIN "public"."ps_articulos" p ON sc."num_articulo" = p."reg_articulo"
WHERE sc."stock" > 0 AND p."anulado" = false;
```

---

## 3. `ps_stock_tienda` — Retail Store Stock

**~13.6M rows.** One row per article + store + size. The largest table in the
mirror — always filter or aggregate, never scan it raw.

| Column | Type | Notes |
|--------|------|-------|
| `codigo` | `TEXT` PK part | FK → `ps_articulos.codigo` |
| `tienda_codigo` | `TEXT` PK part | Composite `"store/article"`, e.g. `"104/169"` |
| `talla` | `TEXT` PK part | UPPERCASE in the ETL |
| `tienda` | `TEXT` | Store code. **Never `'99'`.** |
| `stock` | `INTEGER` | Units for that article+store+size. Can be negative. |
| `fecha_modifica` | `DATE` | |

```sql
-- Total units across retail stores
SELECT COALESCE(SUM(s."stock"), 0) AS "Unidades Tiendas"
FROM "public"."ps_stock_tienda" s
WHERE s."tienda" <> '99';
```

```sql
-- Per-store, per-size stock for one reference
SELECT s."tienda"        AS "Tienda",
       UPPER(s."talla")  AS "Talla",
       SUM(s."stock")    AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE p."ccrefejofacm" = 'REFERENCIA_AQUI'
  AND s."tienda" <> '99'
GROUP BY s."tienda", UPPER(s."talla")
ORDER BY s."tienda", UPPER(s."talla");
```

---

## 4. Total Stock Calculation

```
Total = ps_stock_central.stock  (central warehouse, store 99)
      + SUM(ps_stock_tienda.stock)  (all retail stores, all sizes)
```

PostgreSQL does the whole thing in one statement — no Python loop, no `UNION`
workaround (that constraint was a 4D SQL limitation, not a mirror one):

```sql
SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion"  AS "Descripción",
       COALESCE(sc."stock", 0) AS "Central",
       COALESCE((SELECT SUM(s."stock")
                 FROM "public"."ps_stock_tienda" s
                 WHERE s."codigo" = p."codigo" AND s."tienda" <> '99'), 0) AS "Tiendas",
       COALESCE(sc."stock", 0)
         + COALESCE((SELECT SUM(s."stock")
                     FROM "public"."ps_stock_tienda" s
                     WHERE s."codigo" = p."codigo" AND s."tienda" <> '99'), 0) AS "Total"
FROM "public"."ps_articulos" p
LEFT JOIN "public"."ps_stock_central" sc ON sc."num_articulo" = p."reg_articulo"
WHERE p."ccrefejofacm" = '85170712';
```

Note the two different join keys: `ps_stock_central` joins on
`num_articulo = reg_articulo`, `ps_stock_tienda` on `codigo = codigo`. Getting
these the wrong way round silently returns zero rows.

A reference (`ccrefejofacm`) is **model + colour**, so it usually maps to several
`codigo` values. Grouping by `ccrefejofacm` aggregates the colour; grouping by
`LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)` aggregates the model across
colours.

---

## 5. Stock Movement Formula

Conceptually, expected stock is opening stock plus net movements:

```
Stock_esperado = Stock_inicial + (Entradas - Salidas)
```

Of the movement legs, **only some are mirrored**:

| Leg | Direction | Mirror source | Available? |
|-----|-----------|---------------|:----------:|
| Retail sales | out | `ps_lineas_ventas` where `entrada` | yes |
| Retail returns | in | `ps_lineas_ventas` where `NOT entrada` | yes |
| Transfers out | out | `ps_traspasos` where `entrada IS FALSE`, `unidades_s` | yes |
| Transfers in | in | `ps_traspasos` where `entrada IS TRUE`, `unidades_e` | yes |
| Wholesale shipments | out | `ps_gc_lin_albarane` + header `abono IS NOT TRUE` | yes |
| Wholesale credit notes | in | `ps_gc_lin_albarane` + header `abono IS TRUE` | yes |
| **Goods received from suppliers** | in | — | **no** (§10) |
| **Returns to supplier** | out | — | **no** (§10) |

Because the purchase-receipt leg is missing, **a full reconciliation
(`Stock_esperado` vs `stock`) cannot be computed from the mirror.** Any shrinkage
figure derived without it is wrong by the entire volume of incoming goods. Use
the mirror for the *sales / transfer / wholesale* legs only, and say so.

Net retail movement per article, which *is* computable:

```sql
SELECT p."ccrefejofacm" AS "Referencia",
       COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Unidades Netas",
       COALESCE(SUM(s."stock"), 0) AS "Stock Tiendas"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
LEFT JOIN (SELECT "codigo", SUM("stock") AS "stock"
           FROM "public"."ps_stock_tienda"
           WHERE "tienda" <> '99'
           GROUP BY "codigo") s ON s."codigo" = lv."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Unidades Netas" DESC
LIMIT 30;
```

The `COALESCE` on **each** side of the subtraction is mandatory
([D-057](../DECISIONS.md)): a period with no returns makes the second
`SUM ... FILTER` `NULL`, `x - NULL` is `NULL`, and `NULL` sorts first in
`ORDER BY ... DESC` — the top of the ranking becomes the articles with no data.

---

## 6. Transfers (`ps_traspasos`)

**~262,700 rows.** Movements between stores.

### Dual-entry pattern

Every physical transfer writes **two rows**, one per side:

| Row | `entrada` | Store column | Qty column | Date column |
|-----|-----------|--------------|------------|-------------|
| Exit | `FALSE` | `tienda_salida` | `unidades_s` | `fecha_s` |
| Entry | `TRUE` | `tienda_entrada` | `unidades_e` | `fecha_e` |

**Never sum both sides together** — that double-counts every movement. Pick one
side and stay on it.

### `tipo` values actually present in the mirror

| `tipo` | Rows | Treat as a transfer? |
|--------|------|:--------------------:|
| `Apertura` | ~247.5k | **No** — store opening load, not a movement |
| `Inventario Parcial` | ~739 | **No** — stock count adjustment |
| `Regularización` | ~14.1k | Yes (adjustment, but a real stock change) |
| `Autoreposicion` | ~425 | Yes |

`tipo` is **nullable**, so the exclusion must be written with `COALESCE`:

```sql
COALESCE(t."tipo", '') NOT IN ('Apertura', 'Inventario Parcial')
```

Written as `t."tipo" NOT IN (...)` it silently drops every row with a NULL
`tipo`, because `NULL NOT IN (...)` is `NULL`, not `TRUE`.

### Transfers into a store

```sql
SELECT t."fecha_s"        AS "Fecha",
       t."tienda_salida"  AS "Origen",
       p."ccrefejofacm"   AS "Referencia",
       t."talla"          AS "Talla",
       t."unidades_s"     AS "Unidades",
       t."tipo"           AS "Tipo",
       t."concepto"       AS "Concepto"
FROM "public"."ps_traspasos" t
LEFT JOIN "public"."ps_articulos" p ON t."codigo" = p."codigo"
WHERE t."tienda_entrada" = '97'
  -- `Autoreposicion` es el unico traspaso real entre tiendas y va SIEMPRE con
  -- entrada=false, llevando origen Y destino en la misma fila. Filtrar
  -- `entrada IS TRUE` aqui devuelve cero: la "pata de entrada" que describia la
  -- doc antigua no existe para este tipo.
  AND t."tipo" = 'Autoreposicion'
  AND t."fecha_s" BETWEEN :curr_from AND :curr_to
ORDER BY t."fecha_s" DESC
LIMIT 50;
```

### Transfer volume by route

```sql
SELECT t."tienda_salida"  AS "Origen",
       t."tienda_entrada" AS "Destino",
       DATE_TRUNC('month', t."fecha_s") AS "Mes",
       COUNT(*)           AS "Movimientos",
       SUM(t."unidades_s") AS "Unidades"
FROM "public"."ps_traspasos" t
WHERE t."entrada" IS FALSE
  AND t."fecha_s" BETWEEN :curr_from AND :curr_to
  AND COALESCE(t."tipo", '') NOT IN ('Apertura', 'Inventario Parcial')
GROUP BY t."tienda_salida", t."tienda_entrada", DATE_TRUNC('month', t."fecha_s")
ORDER BY "Unidades" DESC
LIMIT 15;
```

---

## 7. Wholesale Returns (`ps_gc_albaranes`)

In the wholesale channel a return is a **credit note**, flagged on the *header*:
`ps_gc_albaranes.abono IS TRUE`. `entrada` does not exist there — that is the
retail discriminator, and using it on GC tables is a column-does-not-exist error.

Two rules that are easy to get wrong:

- **Line → header joins by `num_albaran` → `reg_albaran`** (both are 4D record
  ids, despite the `num_` prefix). `n_albaran` is the *visible* document number
  and is **not unique** — joining on it fans out the result set.
- **Effective date** of a delivery note is
  `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.
  `fecha_envio` can be NULL or a sentinel; the `CASE` falls back to `fecha_valor`.

```sql
-- Credit notes by customer
SELECT c."nombre" AS "Cliente",
       COUNT(*)   AS "Abonos",
       SUM(a."base1" + a."base2" + a."base3") AS "Importe Neto",
       SUM(a."entregadas")                    AS "Unidades"
FROM "public"."ps_gc_albaranes" a
JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente"
WHERE a."abono" IS TRUE
  AND (CASE WHEN a."fecha_envio" >= DATE '2000-01-01'
            THEN a."fecha_envio" ELSE a."fecha_valor" END)
      BETWEEN :curr_from AND :curr_to
  AND COALESCE(c."nif", '') <> '502108150'   -- tráfico intragrupo, no es venta
GROUP BY c."nombre"
ORDER BY "Importe Neto" DESC
LIMIT 20;
```

```sql
-- Credit-note detail lines
SELECT l."fecha_albaran" AS "Fecha",
       l."codigo"        AS "Código",
       l."descripcion"   AS "Descripción",
       l."unidades"      AS "Unidades",
       l."total"         AS "Importe"
FROM "public"."ps_gc_lin_albarane" l
JOIN "public"."ps_gc_albaranes" a ON l."num_albaran" = a."reg_albaran"
WHERE a."abono" IS TRUE
  AND (CASE WHEN a."fecha_envio" >= DATE '2000-01-01'
            THEN a."fecha_envio" ELSE a."fecha_valor" END)
      BETWEEN :curr_from AND :curr_to
ORDER BY l."fecha_albaran" DESC
LIMIT 50;
```

Amounts: use `base1 + base2 + base3` (the VAT bases, i.e. sin IVA). There is no
`total_albaran` column in the mirror.

### Retail returns

```sql
SELECT v."tienda"        AS "Tienda",
       p."ccrefejofacm"  AS "Referencia",
       lv."descripcion"  AS "Descripción",
       lv."talla"        AS "Talla",
       lv."unidades"     AS "Unidades",
       lv."total_si"     AS "Importe",
       lv."fecha_creacion" AS "Fecha"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
LEFT JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."entrada" IS FALSE
  AND lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99'
ORDER BY lv."fecha_creacion" DESC
LIMIT 50;
```

`ps_lineas_ventas.entrada` is a line-level copy of the header flag (they agree
100%), so a returns filter does not need the `ps_ventas` join at all — that
missing join was the root cause of the "returns ignored for months" bug.

Return rate per store:

```sql
SELECT v."tienda" AS "Tienda",
       COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)     AS "Vendidas",
       COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Devueltas",
       ROUND(COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0)
             / NULLIF(COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0), 0) * 100, 1)
         AS "% Devolución"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99'
GROUP BY v."tienda"
ORDER BY "% Devolución" DESC;
```

---

## 8. Negative Stock

Negative values are present in both stock tables and are a known data-quality
issue, not a bug in the mirror.

### Why it happens

1. **Timing gaps** — a sale lands before the replenishing transfer.
2. **POS offline mode** — sales recorded locally, stock decremented later.
3. **Manual adjustments** with wrong values.
4. **Returns received physically but not keyed in.**
5. **Transfers** whose exit is recorded before the destination's entry.
6. **The unmirrored purchase leg** (§10) — goods arrive without any mirrored
   movement, so a store can sell into apparent negative stock.

### Finding it

```sql
-- Per store and size
SELECT s."tienda"       AS "Tienda",
       p."ccrefejofacm" AS "Referencia",
       s."talla"        AS "Talla",
       s."stock"        AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" < 0
ORDER BY s."stock" ASC
LIMIT 20;
```

```sql
-- Central warehouse
SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion"  AS "Descripción",
       sc."stock"       AS "Stock Central"
FROM "public"."ps_stock_central" sc
JOIN "public"."ps_articulos" p ON sc."num_articulo" = p."reg_articulo"
WHERE sc."stock" < 0
ORDER BY sc."stock" ASC
LIMIT 20;
```

### Impact on analytics

For **valuation**, clip at zero (`GREATEST(s."stock", 0)`) or filter
`WHERE stock > 0` — a negative multiplied by `precio_coste` subtracts value that
was never there. For **coverage / availability**, treat `<= 0` as out of stock.
For **data-quality reporting**, keep the sign: the negatives are the finding.

---

## 9. Common Stock Queries

### Stock per store, valued

```sql
SELECT s."tienda" AS "Tienda",
       COALESCE(NULLIF(t."identificador", ''), NULLIF(t."poblacion", ''),
                'Tienda ' || s."tienda") AS "Nombre",
       COUNT(DISTINCT s."codigo") AS "Referencias",
       SUM(s."stock")             AS "Unidades",
       ROUND(SUM(s."stock" * p."precio_coste"), 2) AS "Valor Coste"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_tiendas" t ON t."codigo" = s."tienda"
WHERE s."stock" > 0 AND s."tienda" <> '99'
GROUP BY s."tienda",
         COALESCE(NULLIF(t."identificador", ''), NULLIF(t."poblacion", ''),
                  'Tienda ' || s."tienda")
ORDER BY "Unidades" DESC;
```

`precio_coste` is already VAT-exclusive — it is the correct valuation basis.

### Stock by family

```sql
SELECT COALESCE(NULLIF(TRIM(fm."fami_grup_marc"), ''), 'Sin clasificar') AS "Familia",
       SUM(s."stock") AS "Unidades",
       ROUND(SUM(s."stock" * p."precio_coste"), 2) AS "Valor Coste"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0 AND s."tienda" <> '99' AND p."anulado" = false
GROUP BY 1
ORDER BY "Unidades" DESC;
```

### Stock by season

```sql
SELECT p."clave_temporada" AS "Temporada",
       COUNT(DISTINCT p."ccrefejofacm") AS "Referencias",
       SUM(s."stock") AS "Unidades",
       ROUND(SUM(s."stock" * p."precio_coste"), 2) AS "Valor Coste"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0 AND p."anulado" = false
GROUP BY p."clave_temporada"
ORDER BY "Unidades" DESC;
```

### Dead stock — stock on hand, no sales in the period

```sql
SELECT p."ccrefejofacm"   AS "Referencia",
       p."descripcion"    AS "Descripción",
       p."clave_temporada" AS "Temporada",
       SUM(s."stock")     AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 10
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND NOT EXISTS (SELECT 1
                  FROM "public"."ps_lineas_ventas" lv
                  WHERE lv."codigo" = p."codigo"
                    AND lv."fecha_creacion" BETWEEN :curr_from AND :curr_to)
GROUP BY p."ccrefejofacm", p."descripcion", p."clave_temporada"
ORDER BY "Stock" DESC
LIMIT 30;
```

### Lost sales — a size that sells but is out of stock

```sql
WITH vendido AS (
  SELECT p."ccrefejofacm" AS ref,
         UPPER(lv."talla") AS talla,
         COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
           - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS uds
  FROM "public"."ps_lineas_ventas" lv
  JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
  WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
    AND lv."tienda" <> '99'
    AND lv."talla" IS NOT NULL
  GROUP BY 1, 2
),
stock AS (
  SELECT p."ccrefejofacm" AS ref,
         UPPER(s."talla") AS talla,
         SUM(s."stock")   AS stock
  FROM "public"."ps_stock_tienda" s
  JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
  WHERE s."tienda" <> '99'
  GROUP BY 1, 2
)
SELECT v.ref   AS "Referencia",
       v.talla AS "Talla",
       v.uds   AS "Vendidas",
       COALESCE(st.stock, 0) AS "Stock"
FROM vendido v
LEFT JOIN stock st ON st.ref = v.ref AND st.talla = v.talla
WHERE v.uds > 0 AND COALESCE(st.stock, 0) <= 0
ORDER BY v.uds DESC
LIMIT 50;
```

Both sides `UPPER()` the size: the ETL normalises, but a join written without it
is one bad source row away from silently dropping matches.

---

## 10. What is NOT in the mirror

These questions cannot be answered from `ps_*`. Say so rather than writing a
query that looks right and returns a wrong or empty answer.

| Question | Why not | Nearest usable substitute |
|----------|---------|---------------------------|
| **Goods received from suppliers** (units per article per delivery) | Purchase *delivery-note lines* are not mirrored. `ps_albaranes` holds only headers (`reg_albaran`, `fecha_recibido`, `num_pedido`, `num_proveedor`, `proveedor`) — no article, no quantity. | `ps_albaranes` gives counts of receipts and which supplier/order they belong to, nothing about what was inside. |
| **Purchase quantities actually received** | `ps_lineas_compras` (4D `CCLineasCompr`) holds **purchase-order lines — what was ordered, not what arrived**. Treating it as receipts overstates incoming stock by every unmet or partial order. | `ps_lineas_compras` for *ordered* units/amounts, labelled as orders. |
| **Returns to supplier** | Same gap: they live in the unmirrored purchase-delivery lines. | none |
| **Full stock reconciliation / shrinkage** | Requires the receipts leg above (§5). | Net sales + transfers + wholesale movement only, stated as partial. |
| **Per-size stock at the central warehouse** | `ps_stock_central` carries only a per-article total; the 34 size slots are collapsed by the ETL. | Per-size stock for retail stores from `ps_stock_tienda`. |
| **Minimum / safety stock levels** | 4D `Minimo1..34` is not mirrored, and `ps_articulos` has no `stock_minimo`. | none — do not invent a threshold and present it as the system's. |
| **Historical stock snapshots** | The mirror holds only the current position; 4D `Inventarios` / `DetalleInventa` are empty and unmirrored. | Movement history from `ps_lineas_ventas` / `ps_traspasos` / `ps_gc_lin_albarane`. |
| **Real-time stock** | The mirror is refreshed by the nightly ETL. | `ps_stock_*.fecha_modifica` tells you how stale a row is. |

For the record: what *is* mirrored on the purchasing side is
`ps_compras` (~2,800 order headers), `ps_lineas_compras` (~46,200 **order**
lines), `ps_albaranes` (~3,800 receipt headers) and `ps_facturas_compra`
(~4,000 invoice dates). Ordered volume by supplier, for example, is fine:

```sql
SELECT pr."nombre" AS "Proveedor",
       COUNT(DISTINCT lc."num_pedido") AS "Pedidos",
       SUM(lc."unidades")              AS "Unidades Pedidas",
       ROUND(SUM(lc."total_si"), 2)    AS "Importe sin IVA"
FROM "public"."ps_lineas_compras" lc
LEFT JOIN "public"."ps_proveedores" pr ON lc."num_proveedor" = pr."reg_proveedor"
WHERE lc."fecha" BETWEEN :curr_from AND :curr_to
GROUP BY pr."nombre"
ORDER BY "Importe sin IVA" DESC
LIMIT 20;
```

Label such a result **"pedido"** (ordered), never "recibido" (received).
