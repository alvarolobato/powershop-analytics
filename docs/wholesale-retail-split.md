# Wholesale vs Retail Split in PowerShop

> How to distinguish wholesale (B2B) from retail (B2C) data **in the PostgreSQL
> mirror** (`ps_*` tables). Covers the M-prefix convention, the POS vs GC
> channels, and what that implies for reporting.
>
> **Dialect.** Every SQL block here is PostgreSQL against the mirror. The 4D ERP
> names (`Ventas`, `GCAlbaranes`, `CCStock`, `Clientes`…) appear only as lineage
> — they are not queryable from the dashboard or WrenAI.
>
> `:curr_from` / `:curr_to` are the reporting period, bound by the caller.

## Table of Contents

1. [Overview](#1-overview)
2. [The M-Prefix Convention](#2-the-m-prefix-convention)
3. [POS Channel (Retail)](#3-pos-channel-retail)
4. [GC Channel (Wholesale)](#4-gc-channel-wholesale)
5. [Stock by Channel](#5-stock-by-channel)
6. [Customers by Channel](#6-customers-by-channel)
7. [Payments by Channel](#7-payments-by-channel)
8. [Report Implications](#8-report-implications)
9. [Common Pitfalls](#9-common-pitfalls)
10. [What is not mirrored](#10-what-is-not-mirrored)

---

## 1. Overview

Two sales channels share the same database and the same product/customer
masters:

| Aspect | Retail (B2C) | Wholesale (B2B) |
|--------|-------------|-----------------|
| **Mirror tables** | `ps_ventas`, `ps_lineas_ventas`, `ps_pagos_ventas` | `ps_gc_pedidos`, `ps_gc_lin_pedidos`, `ps_gc_albaranes`, `ps_gc_lin_albarane`, `ps_gc_facturas`, `ps_gc_lin_facturas` |
| **Document flow** | Ticket | Order → Delivery note → Invoice |
| **Return / credit flag** | `entrada = FALSE` (line and header) | `abono IS TRUE` (header only) |
| **Product codes** | Standard codes | Often `M`-prefixed referencias |
| **Customers** | `ps_clientes` rows with `ps_ventas` activity | `ps_clientes` rows with `ps_gc_*` activity |
| **Payments** | `ps_pagos_ventas` | **not mirrored** (§10) |
| **Amounts sin IVA** | `total_si` | `base1 + base2 + base3` (headers), `total` (invoice lines) |
| **Stock source** | `ps_stock_tienda` (retail stores) | `ps_stock_central` (central warehouse, store 99) |
| **Rows** | ~910K tickets, ~1.82M lines | ~52K delivery notes, ~1.05M lines, ~19K invoices |

The two channels use **different discriminators**, and that is the single
biggest source of wrong queries: `entrada` does not exist on GC tables, `abono`
does not exist on retail tables.

---

## 2. The M-Prefix Convention

Referencias starting with **`M`** (e.g. `M12345`) are wholesale/bulk products.
The prefix lives on **`ps_articulos.ccrefejofacm`**, the referencia — not on
`codigo`.

```sql
-- Retail products only  (ccrefejofacm is nullable — the IS NULL branch matters)
WHERE p."ccrefejofacm" IS NULL OR p."ccrefejofacm" NOT LIKE 'M%'

-- Wholesale products only
WHERE p."ccrefejofacm" LIKE 'M%'
```

```sql
-- Channel mix of the active catalogue
SELECT COUNT(*) AS "Total",
       COUNT(*) FILTER (WHERE p."ccrefejofacm" LIKE 'M%') AS "Mayorista",
       COUNT(*) FILTER (WHERE p."ccrefejofacm" IS NULL
                          OR p."ccrefejofacm" NOT LIKE 'M%') AS "Retail"
FROM "public"."ps_articulos" p
WHERE p."anulado" = false;
```

### Important notes

- Not all wholesale transactions use M-prefix products; some standard products
  are also sold wholesale.
- The M-prefix is a **convention**, not enforced by the system.
- For definitive channel separation, use the **table** (`ps_ventas` vs
  `ps_gc_*`), not the prefix.
- `NOT LIKE 'M%'` is `NULL` for a NULL referencia, so a bare `NOT LIKE` filter
  silently drops those articles. Always pair it with `IS NULL`.

---

## 3. POS Channel (Retail)

### Tables

| Table | Rows | Description |
|-------|------|-------------|
| `ps_ventas` | ~910K | Ticket headers (`reg_ventas` PK) |
| `ps_lineas_ventas` | ~1.82M | Ticket lines (`num_ventas` → `ps_ventas.reg_ventas`) |
| `ps_pagos_ventas` | ~964K | Payment records (`num_ventas` → `ps_ventas.reg_ventas`) |

### Characteristics

- Point-of-sale transactions from physical stores and the online store (`'97'`).
- Immediate payment: cash, card, voucher at the time of sale.
- `total` includes VAT; **`total_si` excludes it and is the analytics column**.
- Anonymous or identified: `num_cliente` is `0` for walk-ins.
- `entrada` marks sale (`TRUE`) vs return (`FALSE`), and is present on **both**
  the header and the line — they agree 100%. Prefer `ps_lineas_ventas.entrada`
  so a line-level query does not need the header join at all.
- Store `'99'` is the central warehouse, not a shop: exclude it from retail.

### Key queries

```sql
-- Net retail revenue for the period
SELECT COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0)
         - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_ventas" v
WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99';
```

```sql
-- Net revenue from non-M products only (pure retail)
SELECT COALESCE(SUM(lv."total_si") FILTER (WHERE lv."entrada"), 0)
         - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT lv."entrada"), 0)
         AS "Ventas Netas Retail Puro"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
WHERE lv."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND lv."tienda" <> '99'
  AND (p."ccrefejofacm" IS NULL OR p."ccrefejofacm" NOT LIKE 'M%');
```

Both `COALESCE`s are mandatory: without them a period with no returns yields
`NULL`, and `NULL` sorts first in a `DESC` ranking
([D-057](decisions/D-057-ventas-netas-de-devoluciones.md)).

---

## 4. GC Channel (Wholesale)

### Tables

| Table | Rows | PK | Line → header key |
|-------|------|----|-------------------|
| `ps_gc_pedidos` | ~101 | `reg_pedido` | `ps_gc_lin_pedidos.num_pedido` |
| `ps_gc_lin_pedidos` | ~2.6K | `reg_linea` | |
| `ps_gc_albaranes` | ~52K | `reg_albaran` | `ps_gc_lin_albarane.num_albaran` |
| `ps_gc_lin_albarane` | ~1.05M | `reg_linea` | |
| `ps_gc_facturas` | ~19K | `reg_factura` | `ps_gc_lin_facturas.num_factura` |
| `ps_gc_lin_facturas` | ~1.01M | `reg_linea` | |
| `ps_gc_comerciales` | 5 | `reg_comercial` | via `num_comercial` on headers |

**Join lines to headers by `num_albaran` → `reg_albaran` and
`num_factura` → `reg_factura`.** Despite the `num_` prefix these are 4D record
ids. The `n_albaran` / `n_factura` columns are the *visible document numbers* and
are **not unique** — joining on them fans the result set out and inflates every
total.

### Document flow

```
ps_gc_pedidos (order)
    -> ps_gc_albaranes (delivery note — goods shipped)
        -> ps_gc_facturas (invoice)
            -> [collection — NOT MIRRORED, see §10]
```

### Characteristics

- Deferred payment with 30/60/90-day terms (the payments themselves are not in
  the mirror).
- Amounts are net; `base1 + base2 + base3` are the VAT bases.
- Always an identified customer: `num_cliente` → `ps_clientes.reg_cliente`.
- One order can generate many delivery notes; one invoice can cover many notes.
- **Credit notes are `abono IS TRUE` on the header.** Lines carry no `abono`
  column — the flag must come from the joined header.
- `ps_gc_lin_albarane` has no per-size columns in the mirror; the 4D
  `Entregadas1..34` slots are not unpivoted.

### Effective date of a delivery note

```sql
CASE WHEN a."fecha_envio" >= DATE '2000-01-01'
     THEN a."fecha_envio" ELSE a."fecha_valor" END
```

`fecha_envio` can be NULL or a sentinel; the `CASE` falls back to `fecha_valor`.
Use it in the `WHERE` of every date-filtered albarán query.

### Key queries

```sql
-- Net invoicing for the period
SELECT COUNT(*) FILTER (WHERE f."abono" IS NOT TRUE) AS "Facturas",
       COALESCE(SUM(f."base1" + f."base2" + f."base3") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(f."base1" + f."base2" + f."base3") FILTER (WHERE f."abono" IS TRUE), 0)
         AS "Facturación Neta"
FROM "public"."ps_gc_facturas" f
WHERE f."fecha_factura" BETWEEN :curr_from AND :curr_to;
```

```sql
-- Net delivery-note volume, intragroup traffic excluded
SELECT COUNT(*) FILTER (WHERE a."abono" IS NOT TRUE) AS "Albaranes",
       COALESCE(SUM(a."entregadas") FILTER (WHERE a."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(a."entregadas") FILTER (WHERE a."abono" IS TRUE), 0) AS "Unidades Netas",
       COALESCE(SUM(a."base1" + a."base2" + a."base3") FILTER (WHERE a."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(a."base1" + a."base2" + a."base3") FILTER (WHERE a."abono" IS TRUE), 0)
         AS "Importe Neto"
FROM "public"."ps_gc_albaranes" a
WHERE (CASE WHEN a."fecha_envio" >= DATE '2000-01-01'
            THEN a."fecha_envio" ELSE a."fecha_valor" END)
      BETWEEN :curr_from AND :curr_to
  -- tráfico intragrupo, no es venta. NOT EXISTS y nunca un JOIN: el JOIN es
  -- INNER y descarta las filas sin cliente (70 albaranes de 52.148).
  AND NOT EXISTS (SELECT 1 FROM "public"."ps_clientes" ci
                 WHERE ci."reg_cliente" = a."num_cliente"
                   AND COALESCE(ci."nif", '') = '502108150');
```

```sql
-- Top wholesale references by net invoiced amount
SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion"  AS "Descripción",
       COALESCE(SUM(lf."unidades") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(lf."unidades") FILTER (WHERE f."abono" IS TRUE), 0) AS "Unidades Netas",
       COALESCE(SUM(lf."total") FILTER (WHERE f."abono" IS NOT TRUE), 0)
         - COALESCE(SUM(lf."total") FILTER (WHERE f."abono" IS TRUE), 0) AS "Importe Neto"
FROM "public"."ps_gc_lin_facturas" lf
JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."reg_factura"
JOIN "public"."ps_articulos" p ON lf."codigo" = p."codigo"
WHERE f."fecha_factura" BETWEEN :curr_from AND :curr_to
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Importe Neto" DESC
LIMIT 20;
```

---

## 5. Stock by Channel

| Location | Mirror table | Store | Channel served |
|----------|--------------|-------|----------------|
| Central warehouse | `ps_stock_central` | 99 | Primarily wholesale |
| Retail stores | `ps_stock_tienda` | all except 99 | Retail |

**Store `'99'` does not appear in `ps_stock_tienda`.** Looking for central stock
there returns zero rows — no error, just a silently wrong answer.

```
Supplier -> [purchase receipt — NOT MIRRORED, §10] -> ps_stock_central
                -> ps_traspasos -> ps_stock_tienda   (to the shops)
                -> ps_gc_albaranes -> customer        (wholesale shipment)
```

```sql
SELECT (SELECT COALESCE(SUM(sc."stock"), 0)
        FROM "public"."ps_stock_central" sc
        WHERE sc."stock" > 0) AS "Central (mayorista)",
       (SELECT COALESCE(SUM(s."stock"), 0)
        FROM "public"."ps_stock_tienda" s
        WHERE s."stock" > 0 AND s."tienda" <> '99') AS "Tiendas (retail)";
```

Note the two different join keys to the catalogue:
`ps_stock_central.num_articulo = ps_articulos.reg_articulo`, but
`ps_stock_tienda.codigo = ps_articulos.codigo`. Full stock cookbook in
[stock-analysis.md](stock-analysis.md).

---

## 6. Customers by Channel

**`ps_clientes` has no `mayorista` flag and no `anulado` flag.** Channel is
determined by *where the customer transacts*, not by an attribute on the
customer. Any query filtering `WHERE mayorista = TRUE` is written against the 4D
`Clientes` table and fails here.

```sql
SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "public"."ps_ventas" v
                                      WHERE v."num_cliente" = c."reg_cliente")) AS "Con Retail",
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "public"."ps_gc_albaranes" a
                                      WHERE a."num_cliente" = c."reg_cliente")) AS "Con Mayorista",
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "public"."ps_ventas" v
                                      WHERE v."num_cliente" = c."reg_cliente")
                          AND EXISTS (SELECT 1 FROM "public"."ps_gc_albaranes" a
                                      WHERE a."num_cliente" = c."reg_cliente")) AS "Ambos Canales"
FROM "public"."ps_clientes" c;
```

Available columns are `reg_cliente`, `num_cliente`, `nombre`, `nif`, `email`,
`codigo_postal`, `poblacion`, `pais`, `fecha_creacion`, `fecha_modifica`,
`ultima_compra_f`. Credit terms, discounts, credit limits, assigned sales rep and
VAT-regime flags are **not** mirrored — the sales rep is available on the
*documents* instead (`ps_gc_albaranes.num_comercial` /
`ps_gc_facturas.num_comercial` → `ps_gc_comerciales.reg_comercial`).

NIF `502108150` (19 rows) is intragroup traffic, not a customer — exclude it with `NOT EXISTS`, never a `JOIN` (INNER drops the 70 rows with no matching client), from
wholesale rankings.

---

## 7. Payments by Channel

### Retail payments — `ps_pagos_ventas`

| Column | Description |
|--------|-------------|
| `importe_cob` | Amount charged (**use this**; includes VAT, matches `ps_ventas.total`) |
| `forma` | Payment method name, already human-readable |
| `codigo_forma` | Method code (`'01'` = cash) |
| `entrada` | `FALSE` on refunds — net them out |
| `tienda`, `fecha_creacion` | |

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

`forma` values seen in production: `Metálico`, `American Express`, `Metalico`,
`Visa`, `Devolución Vale`, `Vale`, `Devolución Metálico`, `MasterCard`,
`Maestro`, `Transferencia`, `Pago PowerShop B2C`, `Cheque`. Note `Metálico` and
`Metalico` both occur — fold them before presenting a mix. There is no
`FormasPago` lookup table in the mirror and no code→name mapping is needed.

`importe_cob` includes VAT. Use it for payment-mix and cash-control questions;
use `ps_ventas.total_si` when the question is about revenue.

### Wholesale payments

**Not mirrored.** `CobrosFacturas` has no `ps_*` table, so wholesale
collections, ageing and outstanding receivables cannot be computed here — see
§10. Report the invoiced amount from `ps_gc_facturas` and state that collection
data is unavailable, rather than presenting invoiced as collected.

---

## 8. Report Implications

### Revenue

| Report | Source | Expression |
|--------|--------|------------|
| Retail revenue | `ps_ventas` / `ps_lineas_ventas` | net over `total_si` by `entrada`, `tienda <> '99'` |
| Wholesale revenue | `ps_gc_facturas` | net over `base1+base2+base3` by `abono` |
| Pure retail | `ps_lineas_ventas` + `ps_articulos` | as above, plus `ccrefejofacm` not `M%` (with the `IS NULL` branch) |
| Group total | both | sum the two nets; both are already sin IVA |

### Margin

| Channel | Revenue | Cost |
|---------|---------|------|
| Retail | `ps_lineas_ventas.total_si` | `ps_lineas_ventas.total_coste_si` |
| Wholesale | `ps_gc_lin_facturas.total` | `ps_gc_lin_facturas.total_coste` |

Both sides must be netted by the channel's own discriminator — netting revenue
but not cost inflates margin on any period with returns.

### Units

| Channel | Table | Field |
|---------|-------|-------|
| Retail | `ps_lineas_ventas` | `unidades`, netted by `entrada` |
| Wholesale | `ps_gc_lin_facturas` / `ps_gc_lin_albarane` | `unidades`, netted by the header's `abono` |

### Dates

| Channel | Date column |
|---------|-------------|
| Retail | `ps_ventas.fecha_creacion` / `ps_lineas_ventas.fecha_creacion` (both populated, no NULLs) |
| Wholesale — invoice | `ps_gc_facturas.fecha_factura` |
| Wholesale — delivery note | the `CASE` on `fecha_envio` / `fecha_valor` (§4) |

`ps_lineas_ventas.mes` (YYYYMM integer) and `ps_gc_lin_facturas.mes` exist as
fast filters, but prefer the real date columns — `DATE_TRUNC('month', ...)` is
indexed-friendly enough and does not need a second format to keep in sync.

---

## 9. Common Pitfalls

### 1. Forgetting the returns

Gross `SUM(total_si)` is not "ventas". Net it, with `COALESCE` on both sides.
This is the single most common wrong answer in this dataset.

### 2. Using the wrong discriminator

`entrada` is retail-only, `abono` is wholesale-only. Neither exists on the other
side's tables — the query errors rather than lying, which is the good case; the
bad case is `abono` on a *line* table, where the column simply is not there and
the author reaches for `n_albaran` instead.

### 3. Joining GC lines by the visible document number

`n_albaran` / `n_factura` are **not unique**. Join by `num_albaran` →
`reg_albaran` and `num_factura` → `reg_factura`.

### 4. Mixing VAT treatments

`ps_ventas.total` includes VAT, `ps_gc_facturas.base1+base2+base3` does not.
Comparing or summing them across channels overstates retail. Use `total_si` and
the bases.

### 5. Double-counting M-prefix products

An M-prefix product may appear in both `ps_lineas_ventas` (sold retail) and
`ps_gc_lin_facturas` (sold wholesale). Summing across both without separating the
channel double-counts.

### 6. `NOT LIKE 'M%'` on a NULL referencia

`NULL NOT LIKE 'M%'` is `NULL`, not `TRUE`, so those articles vanish from a
"retail" filter. Always `(p."ccrefejofacm" IS NULL OR p."ccrefejofacm" NOT LIKE 'M%')`.

### 7. Store 99 in retail reports

```sql
SELECT v."tienda" AS "Tienda",
       COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0)
         - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Ventas Netas"
FROM "public"."ps_ventas" v
WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to
  AND v."tienda" <> '99'
GROUP BY v."tienda"
ORDER BY "Ventas Netas" DESC;
```

Store `'97'` is the online shop — a real retail store, keep it.

### 8. Delivery notes vs invoices

Revenue can be measured when goods ship (`ps_gc_albaranes`) or when billed
(`ps_gc_facturas`). These differ by days or weeks. Use delivery notes for
operational/logistics metrics, invoices for financial metrics, and never mix the
two in one series.

### 9. Treating invoiced as collected

Wholesale is deferred payment and the collections are not mirrored (§10). An
invoiced total is not cash in.

### 10. Intragroup traffic

NIF `502108150` moves stock between group entities. It inflates wholesale volume
if left in a customer ranking.

---

## 10. What is not mirrored

| Wanted | Status | Substitute |
|--------|--------|------------|
| **Wholesale collections / receivables / ageing** | `CobrosFacturas` has no `ps_*` table. | Invoiced amount from `ps_gc_facturas`; state that collection data is unavailable. |
| **Customer channel flag, credit terms, discount, credit limit, VAT-regime flags** | Not mirrored on `ps_clientes`. | Channel by transaction table (§6); sales rep via `num_comercial` on the documents. |
| **Per-size wholesale quantities** | 4D `Entregadas1..34` is not unpivoted into `ps_gc_lin_albarane`. | Line-level `unidades` only. |
| **Purchase receipts (goods in)** | Purchase delivery-note *lines* are not mirrored; `ps_albaranes` is headers only. | `ps_lineas_compras` = **orders placed**, never receipts — label it "pedido". |
| **`Facturas` (retail formal invoices) detail** | `ps_facturas` holds dates only (`reg_factura`, `fecha_factura`, `fecha_modifica`). | Ticket-level data from `ps_ventas`. |
| **Register sessions (`Cajas`)** | Not mirrored. | `ps_pagos_ventas` by store and date. |

---

## Summary Decision Tree

```
Q: What channel is this data from?
|
+-- Table starts with "ps_gc_"? -> Wholesale
|   (discriminator: header abono; line->header by reg_* id)
|
+-- ps_ventas / ps_lineas_ventas / ps_pagos_ventas? -> Retail (POS)
|   (discriminator: entrada; exclude tienda '99')
|
+-- ps_articulos? -> Both channels
|   (split by ccrefejofacm LIKE / NOT LIKE 'M%', with the IS NULL branch)
|
+-- ps_clientes? -> Both channels
|   (no flag on the row — decide by which transaction table has activity)
|
+-- ps_stock_central? -> Central warehouse (store 99), serves wholesale
+-- ps_stock_tienda?  -> Retail stores only (never contains '99')
|
+-- ps_traspasos? -> Stock operations between stores (supports both)
```
