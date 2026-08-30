# Skill: Business Intelligence Report Generation

**Use when**: The user asks for a new snapshot/report, asks to regenerate `informe-coleccion.html`, or asks for a business analysis of the data.

## Overview

This skill produces a standalone, offline HTML business intelligence report in **Spanish (Spain)** for the the company / PowerShop fashion retail chain. The report targets three audiences: business owners (Dirección), stock/purchasing managers, and department heads.

**Output**: `/Users/alobato/git/powershop-analytics/docs/reports/informe-coleccion.html`

> **Dialect.** Every query below is **PostgreSQL against the mirror** (`ps_*`
> tables). The report is never built against the live 4D ERP: analytics paths do
> not touch it ([D-001](../decisions/D-001-postgres-mirror.md)), and the 4D table
> names (`Ventas`, `Articulos`, `CCStock`, `Exportaciones`…) do not exist here.
>
> Date placeholders `:curr_from` / `:curr_to` are the reporting period and
> `:comp_from` / `:comp_to` the comparison period (same range, previous year).
> Bind them from Python/JS; do not hardcode `CURRENT_DATE`.

---

## Wholesale vs Retail Split

The report MUST treat wholesale and retail as separate businesses. See [docs/wholesale-retail-split.md](../wholesale-retail-split.md) for full details.

### How to filter
- **Retail articles**: `p."ccrefejofacm" IS NULL OR p."ccrefejofacm" NOT LIKE 'M%'`
- **Wholesale articles**: `p."ccrefejofacm" LIKE 'M%'`
- **Wholesale channel**: `ps_gc_albaranes`, `ps_gc_lin_albarane`, `ps_gc_facturas`, `ps_gc_lin_facturas`, `ps_gc_pedidos` — 100% wholesale
- **Retail POS**: `ps_ventas`, `ps_lineas_ventas`, `ps_pagos_ventas`. Exclude store `'99'` (central warehouse) from every retail figure.

### Report structure
The report has three main blocks:
1. **Executive Summary** — combined group KPIs (retail + wholesale totals)
2. **Retail section** (cyan accent) — stores, products, stock, customers, payments, retail actions
3. **Wholesale section** (gold accent) — customers B2B, invoicing, GC articles, wholesale actions

### What makes sense where
- **Store performance**: Retail only (wholesale doesn't use stores)
- **Stock per store**: Retail only (wholesale manufactures to order)
- **Product rankings**: Separate — retail top articles vs wholesale top GC articles
- **Customer analysis**: Retail = `ps_ventas` customers, Wholesale = customers with `ps_gc_albaranes` / `ps_gc_facturas` activity (same `ps_clientes` table, see §Customers)
- **Payments**: Retail only — wholesale collections are not mirrored (see [What is not available](#what-is-not-available))
- **Weekly trend**: Retail only

### SKU identifier
Always show `ps_articulos.ccrefejofacm` (Referencia) as the primary product identifier in tables and action items, not `codigo`. A referencia is **model + colour**; the model alone is `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)`.

---

## The one rule that breaks reports: "ventas" is always net

Every revenue and unit figure is **sales minus returns**:

```sql
COALESCE(SUM(x) FILTER (WHERE "entrada"), 0)
  - COALESCE(SUM(x) FILTER (WHERE NOT "entrada"), 0)
```

The `COALESCE` on **each** side is not optional. A period with no returns makes
the right-hand `SUM` `NULL`; `x - NULL` is `NULL`; and `NULL` sorts **first**
under `ORDER BY ... DESC`, so the top of every ranking becomes the rows with no
data. See [D-057](../decisions/D-057-ventas-netas-de-devoluciones.md).

In the wholesale channel the discriminator is **`abono`** on the header, not
`entrada`: `FILTER (WHERE f."abono" IS NOT TRUE)` minus
`FILTER (WHERE f."abono" IS TRUE)`.

---

## Data Access

Run queries against the mirror, read-only:

```bash
# local stack (from the repo root, never from a worktree)
docker compose exec -T postgres psql -U postgres -d powershop -c "SELECT 1"

# production, over SSH
set -a; source ~/.config/powershop-analytics/.env; set +a
ssh "$PROD_HOST" 'docker exec -i powershop-postgres-1 psql -U postgres -d powershop' <<'SQL'
SELECT 1;
SQL
```

From Python use `psycopg` against `POSTGRES_DSN`. Nothing in this skill needs the
4D SQL driver or the SOAP service.

---

## VAT Policy

**ALL reports must use VAT-exclusive (sin IVA) figures.** VAT rates differ across regions (23% Portugal mainland, 22% Madeira, 21% Spain), so including VAT distorts cross-store and cross-region comparisons.

### Field mapping in the mirror

| Table | WITH VAT — DO NOT USE | WITHOUT VAT — USE THIS |
|-------|------------------------|------------------------|
| `ps_ventas` | `total` | **`total_si`** |
| `ps_lineas_ventas` | — | **`total_si`** (line total), `precio_neto_si` (unit price) |
| `ps_gc_facturas` | `total_factura` | **`base1 + base2 + base3`** (sum of tax bases) |
| `ps_gc_albaranes` | — | **`base1 + base2 + base3`** |
| `ps_gc_lin_facturas` | — | `total` (already net), cost in `total_coste` |
| `ps_pagos_ventas` | `importe_cob` (con IVA, matches `ps_ventas.total`) | use `COUNT(*)` for method mix, or `ps_ventas.total_si` for revenue |
| `ps_articulos` | `precio1` (PVP tarifa 1, con IVA) | **`precio_coste`** (already net) |

Retail cost of goods is `ps_lineas_ventas.total_coste_si` — prefer it over
`unidades * precio_coste`, which re-prices history at today's cost.

### Rule

When computing revenue, average ticket, margin, or any monetary KPI, always use the sin-IVA column. The only acceptable use of VAT-inclusive fields is when reconciling against tax documents or payment totals.

---

## Query Cookbook

### Step 1: Determine date ranges

```python
from datetime import date
today = date.today()
curr_from, curr_to = date(today.year, 1, 1), today                 # YTD
comp_from, comp_to = date(today.year - 1, 1, 1), today.replace(year=today.year - 1)
```

Bind these as `:curr_from` / `:curr_to` / `:comp_from` / `:comp_to`.

### Step 2: Active season / collection

```sql
SELECT t."clave"          AS "Clave",
       t."temporada_tipo" AS "Temporada",
       t."inicio_ventas"  AS "Inicio Ventas",
       t."fin_ventas"     AS "Fin Ventas",
       t."inicio_rebajas" AS "Inicio Rebajas",
       t."fin_rebajas"    AS "Fin Rebajas"
FROM "public"."ps_temporadas" t
WHERE t."temporada_activ" IS TRUE
ORDER BY t."inicio_ventas" DESC;
```

Article counts per season:

```sql
SELECT p."clave_temporada" AS "Temporada",
       COUNT(*)            AS "Artículos",
       COUNT(*) FILTER (WHERE p."anulado" = false) AS "Activos"
FROM "public"."ps_articulos" p
GROUP BY p."clave_temporada"
ORDER BY "Artículos" DESC;
```

Stock per season: see [stock-analysis.md § Stock by season](../stock-analysis.md#9-common-stock-queries).

### Step 3: Sales overview (period + comparison)

```sql
-- Headline KPIs for one period
SELECT COUNT(*) FILTER (WHERE v."entrada") AS "Tickets",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0)
         - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Ventas Netas",
       ROUND((COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0)
              - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0))
             / NULLIF(COUNT(*) FILTER (WHERE v."entrada"), 0), 2) AS "Ticket Medio"
FROM "public"."ps_ventas" v
WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99';
```

```sql
-- Both periods in one pass (avoids two round trips and keeps the filters aligned)
SELECT COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"
            AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to), 0)
       - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"
            AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to), 0) AS "Periodo Actual",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"
            AND v."fecha_creacion" BETWEEN :comp_from AND :comp_to), 0)
       - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"
            AND v."fecha_creacion" BETWEEN :comp_from AND :comp_to), 0) AS "Periodo Comparado"
FROM "public"."ps_ventas" v
WHERE v."tienda" <> '99'
  AND (v."fecha_creacion" BETWEEN :comp_from AND :comp_to
       OR v."fecha_creacion" BETWEEN :curr_from AND :curr_to);
```

```sql
-- Net units
SELECT COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Unidades Netas"
FROM "public"."ps_lineas_ventas" lv
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99';
```

### Step 4: Weekly trend

One query, no Python loop over weeks:

```sql
SELECT DATE_TRUNC('week', v."fecha_creacion") AS "Semana",
       COUNT(*) FILTER (WHERE v."entrada")    AS "Tickets",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0)
         - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_ventas" v
WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99'
GROUP BY DATE_TRUNC('week', v."fecha_creacion")
ORDER BY "Semana";
```

### Step 5: Per-store performance with YoY

```sql
SELECT v."tienda" AS "Tienda",
       COALESCE(NULLIF(t."identificador", ''), NULLIF(t."poblacion", ''),
                'Tienda ' || v."tienda") AS "Nombre",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"
            AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to), 0)
       - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"
            AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to), 0) AS "Actual",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"
            AND v."fecha_creacion" BETWEEN :comp_from AND :comp_to), 0)
       - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"
            AND v."fecha_creacion" BETWEEN :comp_from AND :comp_to), 0) AS "Comparado"
FROM "public"."ps_ventas" v
LEFT JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda"
WHERE v."tienda" <> '99'
  AND (v."fecha_creacion" BETWEEN :comp_from AND :comp_to
       OR v."fecha_creacion" BETWEEN :curr_from AND :curr_to)
GROUP BY v."tienda",
         COALESCE(NULLIF(t."identificador", ''), NULLIF(t."poblacion", ''),
                  'Tienda ' || v."tienda")
ORDER BY "Actual" DESC;
```

Store names come from `ps_tiendas` (`identificador` → `poblacion` → fallback).
There is no `provincia` column in the mirror.

### Step 6: Product performance

`ps_lineas_ventas` has **no `num_articulo`** — the join to `ps_articulos` is by
**`codigo`**. Get `ccrefejofacm` from there.

**Top references by net revenue**:

```sql
SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion"  AS "Descripción",
       COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Unidades",
       COALESCE(SUM(lv."total_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT lv."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Ventas Netas" DESC
LIMIT 25;
```

**Top models** (colours collapsed — an article is model+colour, so a ranking by
referencia splits one successful model across its colourways):

```sql
SELECT LEFT(p."ccrefejofacm", LENGTH(p."ccrefejofacm") - 2) AS "Modelo",
       MIN(p."descripcion")             AS "Descripción",
       COUNT(DISTINCT p."ccrefejofacm") AS "Colores",
       COALESCE(SUM(lv."total_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT lv."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
  AND LENGTH(p."ccrefejofacm") > 2
GROUP BY 1
ORDER BY "Ventas Netas" DESC
LIMIT 25;
```

**By family / department / season** — same shape, swapping the grouping:

| Breakdown | Join | Group by |
|-----------|------|----------|
| Family | `JOIN ps_familias fm ON p."num_familia" = fm."reg_familia"` | `fm."fami_grup_marc"` |
| Department | `JOIN ps_departamentos d ON p."num_departament" = d."reg_departament"` | `d."depa_secc_fabr"` |
| Brand | `JOIN ps_marcas m ON p."num_marca" = m."reg_marca"` | `m."marca_tratamien"` |
| Season | — | `p."clave_temporada"` |

**By colour**:

```sql
SELECT COALESCE(NULLIF(TRIM(p."color"), ''), 'Sin color') AS "Color",
       COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Unidades",
       COALESCE(SUM(lv."total_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT lv."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
GROUP BY 1
ORDER BY "Ventas Netas" DESC
LIMIT 20;
```

**By size (talla)** — the size of a sale lives in `ps_lineas_ventas.talla`,
uppercased by the ETL. Do **not** try to derive it from a barcode /
`BarrasAsociado` join: 0% coverage
([D-048](../decisions/D-048-sales-by-size.md)).

```sql
-- ps_lineas_ventas.talla is the 4D CCOPTallaOjo field, uppercased by the ETL.
SELECT UPPER(lv."talla") AS "Talla",
       COALESCE(SUM(lv."unidades") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT lv."entrada"), 0) AS "Unidades"
FROM "public"."ps_lineas_ventas" lv
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
  AND lv."talla" IS NOT NULL
GROUP BY UPPER(lv."talla")
ORDER BY "Unidades" DESC;
```

### Step 7: Pricing and discount

There is no per-line discount percentage in the mirror. Derive it by comparing
the realised net price against the tariff PVP, de-VATed with the article's own
rate:

```sql
SELECT ROUND(AVG(lv."precio_neto_si"), 2) AS "Precio Neto Medio",
       ROUND(AVG(p."precio1" / NULLIF(1 + p."p_iva" / 100, 0)), 2) AS "PVP Tarifa Medio sin IVA",
       ROUND((1 - AVG(lv."precio_neto_si")
                  / NULLIF(AVG(p."precio1" / NULLIF(1 + p."p_iva" / 100, 0)), 0)) * 100, 1)
         AS "Descuento Medio %"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."entrada"
  AND lv."tienda" <> '99'
  AND p."precio1" > 0;
```

`precio1` is today's tariff, not the tariff at sale time — label the result as an
approximation.

### Step 8: Margin analysis

Cost comes from `ps_lineas_ventas.total_coste_si`, and it must be netted by
returns exactly like revenue:

```sql
SELECT lv."tienda" AS "Tienda",
       COALESCE(SUM(lv."total_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT lv."entrada"), 0) AS "Ventas Netas",
       COALESCE(SUM(lv."total_coste_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT lv."entrada"), 0) AS "Coste"
FROM "public"."ps_lineas_ventas" lv
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
GROUP BY lv."tienda"
ORDER BY "Ventas Netas" DESC;
```

Margin % = `(Ventas Netas - Coste) / NULLIF(Ventas Netas, 0) * 100`. Swap the
grouping for family (`fm."fami_grup_marc"`) or department (`d."depa_secc_fabr"`)
with the joins from Step 6.

### Step 9: Stock analysis

Full cookbook in [stock-analysis.md](../stock-analysis.md). The three facts that
matter for the report:

- Central warehouse (store 99) is **`ps_stock_central`** — per article, no sizes.
- Retail stores are **`ps_stock_tienda`** — per article + store + size, and store
  `'99'` never appears there.
- Total = central + stores; `ps_articulos` has no `stock` column.

```sql
-- Headline stock KPIs
SELECT (SELECT COALESCE(SUM(sc."stock"), 0)
        FROM "public"."ps_stock_central" sc WHERE sc."stock" > 0) AS "Unidades Central",
       (SELECT COALESCE(SUM(s."stock"), 0)
        FROM "public"."ps_stock_tienda" s
        WHERE s."stock" > 0 AND s."tienda" <> '99')               AS "Unidades Tiendas";
```

Stock per store, dead stock, lost sales and stock valuation queries are in
[stock-analysis.md § Common Stock Queries](../stock-analysis.md#9-common-stock-queries).

### Step 10: Customer analysis

`ps_clientes` has **no `mayorista` and no `anulado` column**. Channel is
determined by *which transaction table* a customer appears in, never by a flag on
the customer.

```sql
-- Identified customers in the period
SELECT COUNT(DISTINCT v."num_cliente") FILTER (WHERE v."num_cliente" > 0) AS "Clientes Identificados",
       COUNT(*) FILTER (WHERE v."entrada")                                AS "Tickets"
FROM "public"."ps_ventas" v
WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99';
```

```sql
-- Frequency segmentation
WITH frecuencia AS (
  SELECT v."num_cliente" AS cliente, COUNT(*) AS n
  FROM "public"."ps_ventas" v
  WHERE v."num_cliente" > 0
    AND v."entrada"
    AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to
    AND v."tienda" <> '99'
  GROUP BY v."num_cliente"
)
SELECT CASE WHEN n = 1 THEN '1 compra'
            WHEN n BETWEEN 2 AND 3 THEN '2-3 compras'
            ELSE '4+ compras' END AS "Segmento",
       COUNT(*) AS "Clientes"
FROM frecuencia
GROUP BY 1
ORDER BY 1;
```

For concentration (top-10% of customers = X% of revenue), rank customers by net
spend with the standard net expression over `ps_ventas.total_si` grouped by
`num_cliente`, then compute the share in Python.

### Step 11: Wholesale channel

```sql
-- Invoicing, net of credit notes
SELECT COUNT(*) FILTER (WHERE f."abono" IS NOT TRUE) AS "Facturas",
       COALESCE(SUM(f."base1" + f."base2" + f."base3") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(f."base1" + f."base2" + f."base3") FILTER (WHERE f."abono" IS TRUE), 0)
         AS "Facturación Neta"
FROM "public"."ps_gc_facturas" f
WHERE f."fecha_factura" BETWEEN :curr_from AND :curr_to;
```

```sql
-- Delivery notes, net of credit notes, on the effective date
SELECT COUNT(*) FILTER (WHERE a."abono" IS NOT TRUE) AS "Albaranes",
       COALESCE(SUM(a."entregadas") FILTER (WHERE a."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(a."entregadas") FILTER (WHERE a."abono" IS TRUE), 0) AS "Unidades Netas",
       COALESCE(SUM(a."base1" + a."base2" + a."base3") FILTER (WHERE a."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(a."base1" + a."base2" + a."base3") FILTER (WHERE a."abono" IS TRUE), 0)
         AS "Importe Neto"
FROM "public"."ps_gc_albaranes" a
LEFT JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente"
WHERE (CASE WHEN a."fecha_envio" >= DATE '2000-01-01'
            THEN a."fecha_envio" ELSE a."fecha_valor" END)
      BETWEEN :curr_from AND :curr_to
  AND COALESCE(c."nif", '') <> '502108150';   -- tráfico intragrupo, no es venta
```

```sql
-- Recent orders
SELECT pd."n_pedido"     AS "Pedido",
       pd."fecha_pedido" AS "Fecha",
       c."nombre"        AS "Cliente",
       pd."total_pedido" AS "Importe",
       pd."unidades"     AS "Unidades",
       pd."pendientes"   AS "Pendientes"
FROM "public"."ps_gc_pedidos" pd
LEFT JOIN "public"."ps_clientes" c ON pd."num_cliente" = c."reg_cliente"
WHERE pd."fecha_pedido" BETWEEN :curr_from AND :curr_to
ORDER BY pd."fecha_pedido" DESC
LIMIT 10;
```

Wholesale margin uses `ps_gc_lin_facturas.total` vs `total_coste`, joined to the
header by `num_factura = reg_factura` (**never** `n_factura`, which is the
visible number and is not unique):

```sql
SELECT COALESCE(SUM(lf."total") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(lf."total") FILTER (WHERE f."abono" IS TRUE), 0) AS "Ingreso",
       COALESCE(SUM(lf."total_coste") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(lf."total_coste") FILTER (WHERE f."abono" IS TRUE), 0) AS "Coste"
FROM "public"."ps_gc_lin_facturas" lf
JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."reg_factura"
WHERE f."fecha_factura" BETWEEN :curr_from AND :curr_to;
```

### Step 12: Payment methods

```sql
SELECT p."forma" AS "Forma de Pago",
       COUNT(*)  AS "Movimientos",
       COALESCE(SUM(p."importe_cob") FILTER (WHERE p."entrada"), 0)
         - COALESCE(SUM(p."importe_cob") FILTER (WHERE NOT p."entrada"), 0) AS "Importe Cobrado"
FROM "public"."ps_pagos_ventas" p
WHERE p."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND p."tienda" <> '99'
GROUP BY p."forma"
ORDER BY "Importe Cobrado" DESC;
```

`forma` is already the human-readable name (`Metálico`, `Visa`, `American
Express`, `Devolución Vale`…) — there is no `FormasPago` lookup table in the
mirror and no code mapping is needed. Note the source is not normalised:
`Metálico` and `Metalico` are both present, so fold them if you present a mix.
`codigo_forma = '01'` is cash.

Cash vs card by store: same query with `p."tienda"` added to the `SELECT` and
`GROUP BY`. `importe_cob` includes VAT — use it for payment-mix and cash-control
questions, and `ps_ventas.total_si` for revenue.

### Step 13: Transfers / logistics

```sql
SELECT COUNT(*)            AS "Movimientos",
       SUM(t."unidades_s") AS "Unidades"
FROM "public"."ps_traspasos" t
WHERE t."entrada" IS FALSE
  AND t."fecha_s" BETWEEN :curr_from AND :curr_to
  AND COALESCE(t."tipo", '') NOT IN ('Apertura', 'Inventario Parcial');
```

Route breakdown is in
[stock-analysis.md § Transfers](../stock-analysis.md#6-transfers-ps_traspasos).
Two traps: every transfer writes **two rows** (pick one side — here the exit
side, `entrada IS FALSE`), and `tipo` is nullable, so the exclusion needs
`COALESCE(t."tipo", '')` or NULL-typed rows vanish.

---

## What is not available

Do not write a query for these. State the gap in the report instead.

| Wanted | Status | Substitute |
|--------|--------|------------|
| **Wholesale collections / receivables** | `CobrosFacturas` is **not mirrored**. Nothing in `ps_*` records a wholesale payment. | Invoiced amount from `ps_gc_facturas`; flag ageing as unavailable. |
| **Goods received from suppliers** | Purchase delivery-note *lines* are not mirrored; `ps_albaranes` is headers only. | `ps_lineas_compras` = **orders placed**, never receipts. Label it "pedido". |
| **Stock minimum / safety levels** | Not mirrored. | none — do not invent a threshold. |
| **Per-size stock at the central warehouse** | `ps_stock_central` is per article only. | Retail per-size stock from `ps_stock_tienda`. |
| **Historical stock snapshots** | Mirror holds the current position only. | Movement history from sales/transfers. |
| **`Provincia` for a store** | Not mirrored. | `ps_tiendas.identificador` / `poblacion`. |
| **Per-line discount %** | Not mirrored. | Derived approximation, Step 7. |
| **Real-time figures** | Nightly ETL. | `fecha_modifica` per row shows staleness. |

---

## Report Structure

The HTML file has these sections in order:

1. **Header**: Brand name, report title, date range, generation timestamp
2. **Resumen Ejecutivo**: 8 KPI cards (net revenue, tickets, net units, avg ticket, active stores, active customers, wholesale net invoicing, margin) + 2-3 insight boxes (green=good, amber=warning, red=alert)
3. **Para la Dirección**: Monthly trends bar chart (CSS-based), department distribution bars, key business ratios table, sales by season table, business insights
4. **Análisis de Ventas por Tienda**: Full store table (store code, name, tickets, net revenue, YoY change%, avg ticket, margin%) with heatmap coloring. Closed stores note.
5. **Análisis de Producto**: Top 15 references + top models table, top families bar chart, top colors chart, margin by family table, size distribution
6. **Para el Responsable de Stock y Compras**: stock KPI cards, stock by store table, lost sales table (sold well but zero stock in that size), dead stock table
7. **Análisis de Clientes**: customer KPIs, frequency segmentation, concentration analysis
8. **Canal Mayorista**: wholesale KPIs (invoicing, delivery notes, margin), YoY insight, recent orders table — no collections section, that data is not mirrored
9. **Medios de Pago**: Payment method breakdown with bars, cash vs card by store
10. **Traspasos y Logística**: Transfer volume and top routes
11. **10 Acciones Inmediatas — Dirección**
12. **10 Acciones Inmediatas — Stock y Compras**
13. **Tendencia Semanal**: 12-week sparkline/bar chart
14. **Footer**: Generation timestamp, data source (`mirror ps_*`, ETL date), disclaimer

---

## HTML Design Specifications

### Color scheme (fashion brand aesthetic)

```css
--navy: #0a1628;
--navy-light: #132240;
--navy-mid: #1a3058;
--gold: #c9a84c;
--gold-light: #e8d48b;
--white: #f4f4f8;
--green: #27ae60;    /* positive metrics */
--red: #e74c3c;      /* alerts */
--amber: #f39c12;    /* warnings */
--blue: #3498db;     /* info */
```

### Design principles

- **Standalone**: No external dependencies (no CDN, no JS libraries). All CSS inline in `<style>`.
- **Charts**: CSS-based bars and progress bars. NO JavaScript charting libraries. SVG inline only if needed.
- **Tables**: Alternating row colors, right-aligned numbers, bold headers, colored cells for heatmap effect.
- **Cards**: White background, subtle shadow, border-left color-coded (gold=highlight, green=good, red=alert, blue=info, amber=warning).
- **Insights**: Colored left-border boxes with bold lead sentence + details.
- **Responsive**: Max-width 1400px, works on desktop and print.
- **Numbers**: Spanish formatting (decimal comma, period for thousands: `1.234,56 €`). Currency always EUR (€).

### KPI card HTML pattern

```html
<div class="kpi-card highlight">
  <div class="label">Facturación YTD</div>
  <div class="value">770.862 &euro;</div>
  <div class="change positive">+8,8% vs 2025</div>
</div>
```

### Insight box pattern

```html
<div class="insight alert">
  <strong>Lead sentence:</strong> Detail text with specific numbers.
</div>
```

Classes: `success` (green), `alert` (red), `warning` (amber), no class (neutral/blue).

### Table heatmap pattern

For store performance tables, apply background color based on YoY change:
- `> +10%`: green background
- `0% to +10%`: light green
- `-10% to 0%`: light amber
- `< -10%`: light red

---

## Generating the 10 Action Items

### For Dirección (business owners):

Think like a management consultant. Each action must have:
- **Specific store/product/number** (not generic)
- **Why** (data-backed observation)
- **Expected impact** (estimated EUR or %)

Typical actions:
1. Investigate critical underperforming stores (revenue drop > 50%)
2. Audit low-margin stores (< 35% margin)
3. Investigate wholesale channel decline
4. Address closed/inactive stores
5. Review pricing strategy for outlet-like stores
6. Expand top-performing stores/categories
7. Customer loyalty program for high-frequency buyers
8. Portugal vs Spain market strategy
9. Cash vs card policy review
10. Seasonal transition planning

### For Stock/Purchasing Manager:

Each action must reference specific referencias (`ccrefejofacm`) and store codes:
1. Emergency restock of top sellers with zero stock in a selling size
2. Rebalance stock from overstocked to understocked stores
3. Markdown dead stock (stock on hand + zero sales in the period)
4. Size curve adjustment (sizes that sell out first)
5. Transfer-out from stores with excessive stock
6. Replenishment plan for new season articles
7. Oldest unsold stock by `clave_temporada`
8. Inter-store transfer optimization from the route table
9. Bestseller availability watchlist
10. Inventory audit for stores with the most negative stock rows

---

## Gotchas and Data Quality Notes

1. **"Ventas" is always net of returns** — `COALESCE(...FILTER(entrada),0) - COALESCE(...FILTER(NOT entrada),0)`, with the `COALESCE` on both sides. Without it a period with no returns yields `NULL` and `NULL` sorts first in a `DESC` ranking. [D-057](../decisions/D-057-ventas-netas-de-devoluciones.md).
2. **Always use VAT-exclusive fields**: `ps_ventas.total_si`, `ps_lineas_ventas.total_si`, `ps_gc_*.base1+base2+base3`. `total` / `total_factura` / `importe_cob` include VAT; rates differ by region (23% PT mainland, 22% Madeira, 21% Spain).
3. **Store `'99'` is the central warehouse** — exclude it from every retail figure. It does not appear in `ps_stock_tienda` at all, so central stock must come from `ps_stock_central`.
4. **Store `'97'` is the online store.** It is a real retail store; do not exclude it, but expect different patterns.
5. **`ps_lineas_ventas` joins `ps_articulos` by `codigo`** — there is no `num_articulo` column on the line.
6. **An article is model + colour.** `ccrefejofacm` is the referencia; the model is `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)`. Ranking "top articles" without collapsing colours splits one model across its colourways.
7. **Size comes from `ps_lineas_ventas.talla`**, uppercased by the ETL. Never from a barcode join — `BarrasAsociado` has 0% coverage. [D-048](../decisions/D-048-sales-by-size.md).
8. **`ps_traspasos.tipo` is nullable** — exclusions need `COALESCE(tipo,'') NOT IN ('Apertura','Inventario Parcial')`, and `Apertura` alone is ~94% of the table.
9. **Every transfer is two rows** (exit + entry). Summing both double-counts.
10. **Wholesale returns are `abono`, not `entrada`.** `entrada` does not exist on GC tables.
11. **GC line → header joins by `num_albaran`/`num_factura` → `reg_albaran`/`reg_factura`.** `n_albaran` / `n_factura` are visible document numbers and are not unique.
12. **Wholesale delivery-note date** is `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE fecha_valor END`.
13. **NIF `502108150`** (19 `ps_clientes` rows) is intragroup traffic, not a sale — exclude it from wholesale customer rankings.
14. **`ps_clientes` has no `mayorista` / `anulado`.** Channel comes from the transaction table.
15. **Float PKs**: `reg_articulo`, `reg_ventas` etc. are `NUMERIC(20,3)` with a `.99` suffix — never compare them with `=` against a computed value.
16. **Bags (BOLSA)**: exclude or separate them from apparel analysis — high volume, near-zero revenue, they distort unit counts.
17. **Spanish number formatting**: `.` for thousands, `,` for decimals (`1.234,56 €`).
18. **All currency is EUR** — never `$` or USD.
19. **The mirror is refreshed nightly.** Check `ps_ventas` max `fecha_creacion` before claiming "today".

---

## Execution Checklist

When asked to regenerate the report:

- [ ] Determine the period and the comparison period; bind `:curr_*` / `:comp_*`
- [ ] Run the Step 2-13 queries against the mirror, collecting results into Python dicts/lists
- [ ] Confirm every revenue/unit figure uses the net expression with both `COALESCE`s
- [ ] Handle query failures gracefully — note assumptions, continue with available data
- [ ] Compute derived metrics (margins, YoY%, coverage, concentrations)
- [ ] For anything in [What is not available](#what-is-not-available), say so in the report — never approximate it silently
- [ ] Generate the full HTML with inline CSS
- [ ] Write to `docs/reports/informe-coleccion.html`
- [ ] Open in browser with `open` command
- [ ] Verify no `$` or `USD` anywhere -- all EUR
- [ ] Verify Spanish number formatting throughout
- [ ] Verify all sections are populated with real data
