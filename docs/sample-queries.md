# PowerShop Sample SQL Queries

> Ready-to-use SQL queries for common analytics tasks against the PowerShop 4D database.
> All queries use **placeholder values** -- replace with actual codes/dates as needed.

> **Two dialects live in this file. Do not mix them.**
>
> | Sections 1-10 (below) | `## LLM:sql-pairs` (end of file) |
> |---|---|
> | **4D SQL**, against the live ERP | **PostgreSQL**, against the `ps_*` mirror |
> | Table names like `Ventas`, `LineasVentas`, `Articulos` | Table names like `ps_ventas`, `ps_lineas_ventas`, `ps_articulos` |
> | Run via `ps sql query "..."` | Run via the dashboard / WrenAI |
> | No `UNION`, no `FILTER`, case-sensitive strings | Full PostgreSQL |
>
> The 4D sections are the **exploration cookbook** for humans working against the
> source ERP. The `LLM:` sections at the end are what actually reaches the dashboard
> LLM and WrenAI, and they are PostgreSQL translations validated against the real
> mirror schema. Copying a 4D query from sections 1-10 into a dashboard widget will
> fail -- the tables do not exist there, and the mirror does not carry every column.

## Connection

```python
import p4d

conn = p4d.connect(
    host='YOUR_4D_SERVER_IP',
    port=19812,
    user='YOUR_4D_USER',
    password=''
)
cur = conn.cursor()
```

## Table of Contents

1. [Schema Discovery](#1-schema-discovery)
2. [Retail Sales](#2-retail-sales)
3. [Wholesale (GC)](#3-wholesale-gc)
4. [Stock](#4-stock)
5. [Customers](#5-customers)
6. [Payments](#6-payments)
7. [Margins](#7-margins)
8. [Transfers](#8-transfers)
9. [M-Prefix Filtering](#9-m-prefix-filtering)
10. [Stock Movement Formula (VFP)](#10-stock-movement-formula)

---

## 1. Schema Discovery

### List All Tables

```sql
SELECT TABLE_NAME FROM _USER_TABLES ORDER BY TABLE_NAME
```

### Get Row Count for a Table

```sql
SELECT COUNT(*) FROM Articulos
```

### Describe Table Columns (Safe Types Only)

```sql
SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH
FROM _USER_COLUMNS
WHERE TABLE_NAME = 'Ventas'
  AND DATA_TYPE IN (1, 3, 4, 6, 8, 9, 10)
ORDER BY COLUMN_NAME
```

Type reference: 1=Boolean, 3=Integer, 4=Long Integer, 6=Real, 8=Date, 9=Time, 10=Alpha

### Find All Text Columns in a Table

```sql
SELECT COLUMN_NAME, DATA_LENGTH
FROM _USER_COLUMNS
WHERE TABLE_NAME = 'Articulos' AND DATA_TYPE = 10
ORDER BY COLUMN_NAME
```

### Find All Numeric Columns

```sql
SELECT COLUMN_NAME, DATA_TYPE
FROM _USER_COLUMNS
WHERE TABLE_NAME = 'LineasVentas' AND DATA_TYPE IN (3, 4, 6)
ORDER BY COLUMN_NAME
```

### Full Schema Dump (All Tables, All Columns)

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH
FROM _USER_COLUMNS
WHERE DATA_TYPE IN (1, 3, 4, 6, 8, 9, 10)
ORDER BY TABLE_NAME, COLUMN_NAME
```

### Check Indexes on a Table

```sql
SELECT INDEX_NAME, INDEX_TYPE, UNIQUENESS
FROM _USER_INDEXES
WHERE TABLE_NAME = 'Ventas'
```

### Check Foreign Key Relations

```sql
SELECT CONSTRAINT_NAME, TABLE_NAME, RELATED_TABLE_NAME, CONSTRAINT_TYPE
FROM _USER_CONSTRAINTS
WHERE TABLE_NAME = 'LineasVentas'
```

---

## 2. Retail Sales

### Daily Sales Summary for a Store

```sql
SELECT FechaCreacion, COUNT(*) AS tickets, SUM(Total) AS revenue
FROM Ventas
WHERE Tienda = '99'
  AND FechaCreacion >= '2025-01-01'
  AND FechaCreacion <= '2025-01-31'
GROUP BY FechaCreacion
ORDER BY FechaCreacion
```

### Monthly Sales by Store

```sql
SELECT lv.Tienda,
       lv.Mes,
       COUNT(DISTINCT lv.NumVentas) AS tickets,
       SUM(lv.Unidades) AS units,
       SUM(lv.Total) AS revenue
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
GROUP BY lv.Tienda, lv.Mes
ORDER BY lv.Tienda, lv.Mes
```

### Top 20 Products by Revenue

```sql
SELECT lv.Codigo, lv.Descripcion,
       SUM(lv.Unidades) AS units,
       SUM(lv.Total) AS revenue,
       COUNT(*) AS line_count
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202503
  AND lv.Entrada = TRUE
GROUP BY lv.Codigo, lv.Descripcion
ORDER BY revenue DESC
LIMIT 20
```

### Sales by Family

```sql
SELECT f.FamiGrupMarc AS familia,
       SUM(lv.Total) AS revenue,
       SUM(lv.Unidades) AS units,
       COUNT(*) AS lines
FROM LineasVentas lv
INNER JOIN FamiGrupMarc f ON lv.NumFamilia = f.RegFamilia
WHERE lv.Mes = 202501
  AND lv.Entrada = TRUE
GROUP BY f.FamiGrupMarc
ORDER BY revenue DESC
```

### Sales by Department

```sql
SELECT d.DepaSeccFabr AS departamento,
       SUM(lv.Total) AS revenue,
       SUM(lv.Unidades) AS units
FROM LineasVentas lv
INNER JOIN DepaSeccFabr d ON lv.NumDepartament = d.RegDepartament
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
GROUP BY d.DepaSeccFabr
ORDER BY revenue DESC
```

### Sales by Brand

```sql
SELECT m.Marca AS marca,
       SUM(lv.Total) AS revenue,
       SUM(lv.Unidades) AS units
FROM LineasVentas lv
INNER JOIN CCOPMarcTrat m ON lv.NumMarca = m.RegMarca
WHERE lv.Mes = 202501
  AND lv.Entrada = TRUE
GROUP BY m.Marca
ORDER BY revenue DESC
```

### Sales by Season

```sql
SELECT t.Temporada AS temporada,
       SUM(lv.Total) AS revenue,
       SUM(lv.Unidades) AS units
FROM LineasVentas lv
INNER JOIN CCOPTempTipo t ON lv.NumTemporada = t.RegTemporada
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
GROUP BY t.Temporada
ORDER BY revenue DESC
```

### Returns/Refunds

```sql
SELECT lv.Tienda,
       lv.Mes,
       COUNT(*) AS return_lines,
       SUM(lv.Unidades) AS returned_units,
       SUM(lv.Total) AS refund_amount
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = FALSE
GROUP BY lv.Tienda, lv.Mes
ORDER BY lv.Tienda, lv.Mes
```

### Day-of-Week Sales Pattern

```sql
SELECT DAYOFWEEK(FechaCreacion) AS dow,
       COUNT(*) AS tickets,
       SUM(Total) AS revenue
FROM Ventas
WHERE FechaCreacion >= '2025-01-01'
  AND FechaCreacion <= '2025-12-31'
  AND Entrada = TRUE
GROUP BY DAYOFWEEK(FechaCreacion)
ORDER BY dow
```

### Hourly Sales Distribution

```sql
SELECT HOUR(Hora) AS hour,
       COUNT(*) AS tickets,
       SUM(Total) AS revenue
FROM Ventas
WHERE FechaCreacion >= '2025-01-01'
  AND Entrada = TRUE
GROUP BY HOUR(Hora)
ORDER BY hour
```

### Average Ticket Value by Store

```sql
SELECT Tienda,
       COUNT(*) AS tickets,
       SUM(Total) AS revenue,
       SUM(Total) / COUNT(*) AS avg_ticket
FROM Ventas
WHERE FechaCreacion >= '2025-01-01'
  AND Total > 0
  AND Entrada = TRUE
GROUP BY Tienda
ORDER BY avg_ticket DESC
```

---

## 3. Wholesale (GC)

### Wholesale Delivery Notes by Customer

```sql
SELECT ga.Cliente,
       COUNT(*) AS num_albaranes,
       SUM(ga.Unidades) AS total_units,
       SUM(ga.TotalAlbaran) AS total_amount
FROM GCAlbaranes ga
WHERE ga.FechaEnvio >= '2025-01-01'
  AND ga.Abono = FALSE
GROUP BY ga.Cliente
ORDER BY total_amount DESC
LIMIT 20
```

### Wholesale Invoice Summary by Month

```sql
SELECT YEAR(gf.FechaFactura) AS yr,
       MONTH(gf.FechaFactura) AS mo,
       COUNT(*) AS invoices,
       SUM(gf.TotalFactura) AS total
FROM GCFacturas gf
WHERE gf.FechaFactura >= '2025-01-01'
  AND gf.Abono = FALSE
  AND gf.FacturaAnulada = FALSE
GROUP BY YEAR(gf.FechaFactura), MONTH(gf.FechaFactura)
ORDER BY yr, mo
```

### Top Wholesale Products

```sql
SELECT gl.Codigo, gl.Descripcion,
       SUM(gl.Unidades) AS units,
       SUM(gl.Total) AS revenue
FROM GCLinFacturas gl
WHERE gl.Mes BETWEEN 202501 AND 202512
  AND gl.Unidades > 0
GROUP BY gl.Codigo, gl.Descripcion
ORDER BY revenue DESC
LIMIT 20
```

### Wholesale by Sales Representative

```sql
SELECT gc.Comercial,
       COUNT(*) AS invoices,
       SUM(gf.TotalFactura) AS total
FROM GCFacturas gf
INNER JOIN GCComerciales gc ON gf.NumComercial = gc.RegComercial
WHERE gf.FechaFactura >= '2025-01-01'
  AND gf.Abono = FALSE
GROUP BY gc.Comercial
ORDER BY total DESC
```

### Wholesale Credit Notes (Returns)

```sql
SELECT ga.Cliente,
       COUNT(*) AS abonos,
       SUM(ga.TotalAlbaran) AS total_returned
FROM GCAlbaranes ga
WHERE ga.FechaEnvio >= '2025-01-01'
  AND ga.Abono = TRUE
GROUP BY ga.Cliente
ORDER BY total_returned DESC
```

### Wholesale Collections Status

```sql
SELECT gf.NFactura, gf.Cliente, gf.TotalFactura,
       SUM(cf.Importe) AS cobrado,
       gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) AS pendiente
FROM GCFacturas gf
LEFT OUTER JOIN CobrosFacturas cf ON gf.RegFactura = cf.NumFactura
WHERE gf.FechaFactura >= '2025-01-01'
GROUP BY gf.NFactura, gf.Cliente, gf.TotalFactura
HAVING gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) > 0
ORDER BY pendiente DESC
LIMIT 20
```

---

## 4. Stock

### Central Warehouse Stock (Store 99)

```sql
SELECT cs.NumArticulo, a.Codigo, a.Descripcion,
       cs.Stock AS total_central,
       cs.Stock1, cs.Stock2, cs.Stock3, cs.Stock4, cs.Stock5,
       cs.Talla1, cs.Talla2, cs.Talla3, cs.Talla4, cs.Talla5
FROM CCStock cs
INNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo
WHERE cs.Stock > 0
ORDER BY cs.Stock DESC
LIMIT 20
```

### Retail Store Stock

```sql
SELECT e.Tienda, e.Codigo, e.Descripcion,
       e.STStock AS total_store,
       e.Stock1, e.Stock2, e.Stock3, e.Stock4, e.Stock5,
       e.Talla1, e.Talla2, e.Talla3, e.Talla4, e.Talla5
FROM Exportaciones e
WHERE e.Tienda = '104'
  AND e.STStock > 0
ORDER BY e.STStock DESC
LIMIT 20
```

### Total Stock Across All Stores for a Product

```sql
-- Central stock
SELECT 'Central' AS location, cs.Stock AS total
FROM CCStock cs
INNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo
WHERE a.Codigo = '12345'

-- Per-store stock (run separately, 4D does not support UNION)
SELECT e.Tienda AS location, e.STStock AS total
FROM Exportaciones e
WHERE e.Codigo = '12345'
  AND e.STStock > 0
ORDER BY e.STStock DESC
```

### Products with Zero Stock

```sql
SELECT a.Codigo, a.Descripcion, a.Stock
FROM Articulos a
WHERE a.Anulado = FALSE
  AND a.Stock = 0
  AND a.Precio1 > 0
LIMIT 50
```

### Products with Negative Stock

```sql
SELECT a.Codigo, a.Descripcion, a.Stock
FROM Articulos a
WHERE a.Stock < 0
  AND a.Anulado = FALSE
ORDER BY a.Stock ASC
LIMIT 20
```

### Store Stock Summary

```sql
SELECT e.Tienda,
       COUNT(*) AS products_in_store,
       SUM(e.STStock) AS total_units
FROM Exportaciones e
WHERE e.STStock > 0
GROUP BY e.Tienda
ORDER BY total_units DESC
```

---

## 5. Customers

### Top Customers by Purchase Volume (Retail)

```sql
SELECT v.NumCliente, v.Cliente,
       COUNT(*) AS num_purchases,
       SUM(v.Total) AS total_spent
FROM Ventas v
WHERE v.NumCliente > 0
  AND v.FechaCreacion >= '2025-01-01'
  AND v.Entrada = TRUE
GROUP BY v.NumCliente, v.Cliente
HAVING SUM(v.Total) > 99.99
ORDER BY total_spent DESC
LIMIT 50
```

### Customer Purchase Frequency

```sql
SELECT v.NumCliente, v.Cliente,
       COUNT(*) AS visits,
       MIN(v.FechaCreacion) AS first_visit,
       MAX(v.FechaCreacion) AS last_visit,
       SUM(v.Total) AS total_spent
FROM Ventas v
WHERE v.NumCliente > 0
  AND v.Entrada = TRUE
  AND v.FechaCreacion >= '2025-01-01'
GROUP BY v.NumCliente, v.Cliente
HAVING COUNT(*) > 1
ORDER BY visits DESC
LIMIT 50
```

### Wholesale Customer Summary

```sql
SELECT c.Cliente, c.Poblacion, c.Provincia,
       c.FormaPago, c.PDescCom AS discount_pct,
       c.RiesgoConcedid AS credit_limit,
       c.BloqueoFinancials AS blocked
FROM Clientes c
WHERE c.Mayorista = TRUE
  AND c.Anulado = FALSE
ORDER BY c.Cliente
```

### Customers Created in a Period

```sql
SELECT Codigo, Cliente, Tienda, FechaCreacion
FROM Clientes
WHERE FechaCreacion >= '2025-01-01'
  AND FechaCreacion <= '2025-12-31'
ORDER BY FechaCreacion DESC
```

### Unique Customer Count per Store

```sql
SELECT v.Tienda,
       COUNT(DISTINCT v.NumCliente) AS unique_customers
FROM Ventas v
WHERE v.NumCliente > 0
  AND v.FechaCreacion >= '2025-01-01'
GROUP BY v.Tienda
ORDER BY unique_customers DESC
```

---

## 6. Payments

### Revenue by Payment Method (using ImporteCob)

```sql
SELECT pv.Forma,
       COUNT(*) AS payment_count,
       SUM(pv.ImporteCob) AS collected
FROM PagosVentas pv
WHERE pv.FechaCreacion >= '2025-01-01'
  AND pv.FechaCreacion <= '2025-01-31'
  AND pv.Entrada = TRUE
GROUP BY pv.Forma
ORDER BY collected DESC
```

**Important**: Use `ImporteCob` (amount collected), not `ImporteEnt` (amount tendered).

### Payment Method Mix by Store

```sql
SELECT pv.Tienda, pv.Forma,
       SUM(pv.ImporteCob) AS collected
FROM PagosVentas pv
WHERE pv.FechaCreacion >= '2025-01-01'
  AND pv.Entrada = TRUE
GROUP BY pv.Tienda, pv.Forma
ORDER BY pv.Tienda, collected DESC
```

### Daily Cash vs Card

```sql
SELECT pv.FechaCreacion,
       SUM(CASE WHEN pv.CodigoForma = '01' THEN pv.ImporteCob ELSE 0 END) AS cash,
       SUM(CASE WHEN pv.CodigoForma <> '01' THEN pv.ImporteCob ELSE 0 END) AS non_cash,
       SUM(pv.ImporteCob) AS total
FROM PagosVentas pv
WHERE pv.FechaCreacion >= '2025-01-01'
  AND pv.Entrada = TRUE
GROUP BY pv.FechaCreacion
ORDER BY pv.FechaCreacion
```

*Note: `CodigoForma = '01'` is typically cash/metalico -- verify with FormasPago table.*

### Voucher Redemptions

```sql
SELECT v.TiendaRec AS store,
       YEAR(v.Recepcion) AS yr,
       MONTH(v.Recepcion) AS mo,
       COUNT(*) AS vouchers_used,
       SUM(v.Importe) AS total_redeemed
FROM Vales v
WHERE v.Recepcion IS NOT NULL
  AND v.Recepcion >= '2025-01-01'
GROUP BY v.TiendaRec, YEAR(v.Recepcion), MONTH(v.Recepcion)
ORDER BY yr, mo, store
```

---

## 7. Margins

### Product Margin Analysis (Retail)

```sql
SELECT lv.Codigo, lv.Descripcion,
       SUM(lv.Unidades) AS units,
       SUM(lv.TotalSI) AS net_revenue,
       SUM(lv.TotalCosteSI) AS total_cost,
       SUM(lv.TotalSI) - SUM(lv.TotalCosteSI) AS gross_margin,
       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
  AND lv.TotalSI > 0
GROUP BY lv.Codigo, lv.Descripcion
HAVING SUM(lv.TotalSI) > 0
ORDER BY gross_margin DESC
LIMIT 20
```

### Margin by Family

```sql
SELECT f.FamiGrupMarc AS familia,
       SUM(lv.TotalSI) AS net_revenue,
       SUM(lv.TotalCosteSI) AS total_cost,
       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct
FROM LineasVentas lv
INNER JOIN FamiGrupMarc f ON lv.NumFamilia = f.RegFamilia
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
  AND lv.TotalSI > 0
GROUP BY f.FamiGrupMarc
ORDER BY margin_pct DESC
```

### Margin by Store

```sql
SELECT lv.Tienda,
       SUM(lv.TotalSI) AS net_revenue,
       SUM(lv.TotalCosteSI) AS total_cost,
       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Entrada = TRUE
  AND lv.TotalSI > 0
GROUP BY lv.Tienda
ORDER BY margin_pct DESC
```

### Wholesale Margin (from GCLinFacturas)

```sql
SELECT gl.Codigo, gl.Descripcion,
       SUM(gl.Unidades) AS units,
       SUM(gl.Total) AS revenue,
       SUM(gl.TotalCoste) AS cost,
       SUM(gl.Total) - SUM(gl.TotalCoste) AS margin,
       ROUND((SUM(gl.Total) - SUM(gl.TotalCoste)) / SUM(gl.Total) * 100, 1) AS margin_pct
FROM GCLinFacturas gl
WHERE gl.Mes BETWEEN 202501 AND 202512
  AND gl.Unidades > 0
  AND gl.Total > 0
GROUP BY gl.Codigo, gl.Descripcion
ORDER BY margin DESC
LIMIT 20
```

### Low-Margin Products (Below 30%)

```sql
SELECT a.Codigo, a.Descripcion,
       a.Precio1 AS pvp,
       a.PrecioCoste AS cost,
       ROUND((a.Precio1 - a.PrecioCoste) / a.Precio1 * 100, 1) AS margin_pct
FROM Articulos a
WHERE a.Precio1 > 0 AND a.PrecioCoste > 0
  AND a.Anulado = FALSE
  AND (a.Precio1 - a.PrecioCoste) / a.Precio1 < 0.3
ORDER BY margin_pct ASC
LIMIT 50
```

---

## 8. Transfers

### Transfer Volume by Route

```sql
SELECT TiendaSalida, TiendaEntrada,
       COUNT(*) AS transfers,
       SUM(UnidadesS) AS units_sent
FROM Traspasos
WHERE FechaS >= '2025-01-01'
  AND Entrada = FALSE
GROUP BY TiendaSalida, TiendaEntrada
ORDER BY units_sent DESC
LIMIT 20
```

### Transfer Volume by Type

```sql
SELECT Tipo,
       COUNT(*) AS count,
       SUM(UnidadesE) AS units
FROM Traspasos
WHERE FechaE >= '2025-01-01'
  AND Entrada = TRUE
GROUP BY Tipo
ORDER BY count DESC
```

### Daily Transfer Activity

```sql
SELECT FechaS AS fecha,
       COUNT(*) AS transfers,
       SUM(UnidadesS) AS units
FROM Traspasos
WHERE FechaS >= '2025-01-01'
  AND Entrada = FALSE
GROUP BY FechaS
ORDER BY FechaS
```

### Transfers for a Specific Product

```sql
SELECT FechaS, TiendaSalida, TiendaEntrada,
       Talla, UnidadesS, Tipo, Concepto
FROM Traspasos
WHERE Codigo = '12345'
  AND FechaS >= '2025-01-01'
  AND Entrada = FALSE
ORDER BY FechaS DESC
```

---

## 9. M-Prefix Filtering

Articles with **M-prefix** codes (e.g., `M12345`) are wholesale/bulk products.
Non-M codes are standard retail products.

### Retail-Only Products (exclude M-prefix)

```sql
SELECT Codigo, Descripcion, Precio1, Stock
FROM Articulos
WHERE Codigo NOT LIKE 'M%'
  AND Anulado = FALSE
  AND Stock > 0
ORDER BY Codigo
LIMIT 50
```

### Wholesale-Only Products (M-prefix)

```sql
SELECT Codigo, Descripcion, Precio1, Stock
FROM Articulos
WHERE Codigo LIKE 'M%'
  AND Anulado = FALSE
ORDER BY Codigo
LIMIT 50
```

### Retail Sales Excluding Wholesale Articles

```sql
SELECT lv.Tienda, lv.Mes,
       SUM(lv.Total) AS revenue,
       SUM(lv.Unidades) AS units
FROM LineasVentas lv
WHERE lv.Mes BETWEEN 202501 AND 202512
  AND lv.Codigo NOT LIKE 'M%'
  AND lv.Entrada = TRUE
GROUP BY lv.Tienda, lv.Mes
ORDER BY lv.Tienda, lv.Mes
```

### Wholesale Delivery Notes with M-Prefix Products

```sql
SELECT gl.NAlbaran, gl.Codigo, gl.Descripcion,
       gl.Unidades, gl.Total
FROM GCLinAlbarane gl
WHERE gl.Codigo LIKE 'M%'
  AND gl.FechaAlbaran >= '2025-01-01'
ORDER BY gl.FechaAlbaran DESC
LIMIT 50
```

---

## 10. Stock Movement Formula

The VFP (Verificacion Fisica de Producto) stock formula calculates net stock changes:

### Entries (Entradas)

```
Entradas = Devoluciones_recibidas
         + Albaranes_entrada
         + Envios_recibidos
         + Traspasos_entrada
```

### Exits (Salidas)

```
Salidas = Ventas
        + Albaranes_devolucion
        + Envios_salida
        + Traspasos_salida
```

### Net Stock Change

```
Neto = Entradas - Salidas
```

### SQL Implementation

```sql
-- Entries to a store (Traspasos where Entrada=True)
SELECT SUM(UnidadesE) AS traspasos_entrada
FROM Traspasos
WHERE TiendaEntrada = '104'
  AND FechaE >= '2025-01-01'
  AND FechaE <= '2025-01-31'
  AND Entrada = TRUE

-- Exits from a store (Traspasos where Entrada=False)
SELECT SUM(UnidadesS) AS traspasos_salida
FROM Traspasos
WHERE TiendaSalida = '104'
  AND FechaS >= '2025-01-01'
  AND FechaS <= '2025-01-31'
  AND Entrada = FALSE

-- Sales exits
SELECT SUM(lv.Unidades) AS ventas_salida
FROM LineasVentas lv
WHERE lv.Tienda = '104'
  AND lv.Mes = 202501
  AND lv.Entrada = TRUE

-- Returns entries
SELECT SUM(lv.Unidades) AS devoluciones_entrada
FROM LineasVentas lv
WHERE lv.Tienda = '104'
  AND lv.Mes = 202501
  AND lv.Entrada = FALSE

-- Wholesale delivery note entries (Albaranes de compra recibidos)
SELECT SUM(la.Recibidas) AS albaranes_entrada
FROM LinAlbaranes la
INNER JOIN Albaranes a ON la.NumAlbaran = a.RegAlbaran
WHERE a.TiendaEntrada = '104'
  AND a.FechaRecibido >= '2025-01-01'
  AND a.FechaRecibido <= '2025-01-31'
  AND a.Abono = FALSE

-- Wholesale return exits (Albaranes de devolucion)
SELECT SUM(la.Recibidas) AS albaranes_devolucion
FROM LinAlbaranes la
INNER JOIN Albaranes a ON la.NumAlbaran = a.RegAlbaran
WHERE a.TiendaSalida = '104'
  AND a.FechaRecibido >= '2025-01-01'
  AND a.FechaRecibido <= '2025-01-31'
  AND a.Abono = TRUE
```

### Python Implementation

```python
def calculate_stock_movement(cur, store, start_date, end_date):
    """Calculate net stock movement for a store in a date range."""

    # Entries: transfers in
    cur.execute(f"""
        SELECT COALESCE(SUM(UnidadesE), 0)
        FROM Traspasos
        WHERE TiendaEntrada = '{store}'
          AND FechaE >= '{start_date}' AND FechaE <= '{end_date}'
          AND Entrada = TRUE
    """)
    traspasos_in = cur.fetchone()[0] or 0

    # Exits: transfers out
    cur.execute(f"""
        SELECT COALESCE(SUM(UnidadesS), 0)
        FROM Traspasos
        WHERE TiendaSalida = '{store}'
          AND FechaS >= '{start_date}' AND FechaS <= '{end_date}'
          AND Entrada = FALSE
    """)
    traspasos_out = cur.fetchone()[0] or 0

    # Sales exits
    mes_start = int(start_date[:4] + start_date[5:7])
    mes_end = int(end_date[:4] + end_date[5:7])
    cur.execute(f"""
        SELECT COALESCE(SUM(Unidades), 0)
        FROM LineasVentas
        WHERE Tienda = '{store}'
          AND Mes BETWEEN {mes_start} AND {mes_end}
          AND Entrada = TRUE
    """)
    ventas = cur.fetchone()[0] or 0

    # Returns entries
    cur.execute(f"""
        SELECT COALESCE(SUM(Unidades), 0)
        FROM LineasVentas
        WHERE Tienda = '{store}'
          AND Mes BETWEEN {mes_start} AND {mes_end}
          AND Entrada = FALSE
    """)
    devoluciones = cur.fetchone()[0] or 0

    entradas = devoluciones + traspasos_in
    salidas = ventas + traspasos_out
    neto = entradas - salidas

    return {
        'entradas': entradas,
        'salidas': salidas,
        'neto': neto,
        'traspasos_in': traspasos_in,
        'traspasos_out': traspasos_out,
        'ventas': ventas,
        'devoluciones': devoluciones
    }
```

---

## Tips and Gotchas

1. **Always filter on `Entrada`** when summing sales/returns to avoid double-counting.
2. **Use `Mes` (YYYYMM integer)** on LineasVentas/GCLinFacturas for fast period filtering instead of date functions.
3. **Use `ImporteCob`** (not `ImporteEnt`) in PagosVentas for actual revenue.
4. **M-prefix articles** are wholesale -- exclude them with `Codigo NOT LIKE 'M%'` for retail-only analysis.
5. **Never `SELECT *`** on wide tables (CCStock: 582 cols, Articulos: 372 cols). Always list specific columns.
6. **String comparison is case-sensitive** in 4D SQL. Use `UPPER()` for case-insensitive searches.
7. **No UNION support** in 4D SQL v18. Run separate queries and combine in Python.
8. **Text fields may return bytes** in Python 3.13+. Always decode: `val.decode('utf-8', errors='replace') if isinstance(val, bytes) else val`.

---

## LLM:rules

Reglas que gobiernan la traduccion de este recetario al espejo PostgreSQL.

```json
[
  {
    "instruction": "El recetario docs/sample-queries.md secciones 1-10 esta escrito en SQL de 4D contra el ERP origen (tablas Ventas, LineasVentas, Articulos, CCStock, Exportaciones, Traspasos, GCLinFacturas). El dashboard y WrenAI consultan el ESPEJO PostgreSQL con tablas ps_*. Nunca copies una consulta 4D a un widget: esas tablas no existen en PostgreSQL. Usa siempre los pares SQL en ps_*.",
    "questions": [
      "puedo usar las consultas del recetario",
      "por que falla FROM Ventas",
      "que dialecto uso"
    ]
  },
  {
    "instruction": "El espejo PostgreSQL NO replica todas las columnas de 4D. Diferencias que rompen traducciones ingenuas: ps_lineas_ventas SI tiene 'entrada', 'movimiento_caja' y 'talla' desde 2026-08 (vacias en filas anteriores a la resincronizacion); el JOIN con ps_ventas sigue haciendo falta para atributos de cabecera como tienda o cliente; ps_lineas_ventas NO tiene num_familia/num_marca/num_temporada/num_departament (hay que unir con ps_articulos por 'codigo' y de ahi a la dimension); ps_articulos NO tiene columna 'stock'. Antes de usar una columna, comprueba que existe.",
    "questions": [
      "ps_lineas_ventas tiene entrada",
      "como agrupo ventas por familia",
      "por que no encuentro la columna"
    ]
  },
  {
    "instruction": "Ruta de JOIN canonica para ventas retail por dimension de producto: ps_lineas_ventas lv -> ps_ventas v ON v.reg_ventas = lv.num_ventas (para 'entrada' y la fecha) -> ps_articulos a ON a.codigo = lv.codigo (para la referencia y las FK de dimension) -> ps_familias f ON f.reg_familia = a.num_familia (o ps_marcas.reg_marca, ps_temporadas.reg_temporada, ps_departamentos.reg_departament). Para la tienda: ps_tiendas t ON t.codigo = v.tienda, y muestra t.identificador, no el codigo.",
    "questions": [
      "como uno lineas de venta con familia",
      "join de ventas y articulos",
      "como saco el nombre de la tienda"
    ]
  },
  {
    "instruction": "En el canal mayorista la linea de factura ps_gc_lin_facturas SI lleva sus propias FK de dimension (num_familia, num_marca, num_departament, num_color, num_comercial) y su propia fecha_factura, asi que no hace falta unir con la cabecera para agrupar. Une con ps_gc_facturas solo cuando necesites la bandera 'abono' para netear.",
    "questions": [
      "como agrupo facturacion mayorista por familia",
      "necesito la cabecera de factura"
    ]
  },
  {
    "instruction": "Cuidado con las claves del mayorista: ps_gc_lin_albarane.num_albaran es la FK real a ps_gc_albaranes.reg_albaran, mientras que n_albaran es el numero visible del albaran y NO es unico. Une siempre por num_albaran -> reg_albaran. Lo mismo en ps_gc_lin_facturas: num_factura -> ps_gc_facturas.reg_factura.",
    "questions": [
      "como uno lineas y cabeceras de albaran",
      "n_albaran o num_albaran"
    ]
  },
  {
    "instruction": "ps_lineas_ventas.mes es un entero AAAAMM (202501) heredado de 4D y sirve para filtros de periodo rapidos. En PostgreSQL es igual de valido y mas legible filtrar por v.fecha_creacion con DATE_TRUNC; usa mes solo si te interesa el rendimiento sobre rangos largos. No mezcles mes con fecha_creacion en el mismo filtro sin comprobar que concuerdan.",
    "questions": [
      "que es la columna mes",
      "como filtro por periodo"
    ]
  },
  {
    "instruction": "El stock vive en dos tablas distintas del espejo: ps_stock_tienda (grano codigo + tienda + talla, columna 'stock') para tiendas retail, y ps_stock_central (grano num_articulo, columna 'stock') para el almacen central. ps_stock_central.num_articulo une con ps_articulos.reg_articulo; ps_stock_tienda.codigo une con ps_articulos.codigo. Ojo: son claves distintas, no las intercambies.",
    "questions": [
      "donde esta el stock",
      "stock central o de tienda",
      "como uno stock con articulos"
    ]
  },
  {
    "instruction": "ps_traspasos usa doble anotacion: cada movimiento aparece como salida (entrada = false, con unidades_s y fecha_s) y como entrada (entrada = true, con unidades_e y fecha_e). Para no duplicar, filtra un solo lado: usa NOT entrada con unidades_s/fecha_s para medir envios, o entrada con unidades_e/fecha_e para medir recepciones. Nunca sumes ambos.",
    "questions": [
      "como cuento traspasos",
      "por que salen unidades duplicadas",
      "unidades_s o unidades_e"
    ]
  },
  {
    "instruction": "Nunca hagas SELECT * en este dominio. En 4D las tablas son muy anchas (Articulos 379 columnas, CCStock 582) y en el espejo sigue siendo mala practica porque infla el payload del widget. Enumera siempre las columnas y ponles alias en espanol para el usuario final.",
    "questions": [
      "puedo hacer select *",
      "buenas practicas de consulta"
    ]
  }
]
```

## LLM:sql-pairs

<!--
PostgreSQL contra el espejo ps_*, NO SQL de 4D.

Estos 30 pares son la traduccion validada de las 10 familias de consultas del
recetario de arriba. Cada uno se ha comprobado con EXPLAIN contra el esquema
real del espejo (2026-08-29): 30/30 planifican sin error, asi que ninguna
columna ni tabla referenciada es inventada.

Todo importe o unidad agregada va NETO de devoluciones:
  COALESCE(SUM(x) FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(x) FILTER (WHERE NOT v."entrada"), 0)
En el canal mayorista el neteo usa la bandera "abono" en vez de "entrada".
-->

### ¿Cuánto hemos vendido cada día en una tienda concreta? (neto de devoluciones)
```sql
SELECT v."fecha_creacion" AS "Fecha", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."tienda" = '99' AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY v."fecha_creacion" ORDER BY v."fecha_creacion"
```

### ¿Cuál es la venta neta mensual por tienda?
```sql
SELECT t."identificador" AS "Tienda", DATE_TRUNC('month', v."fecha_creacion")::date AS "Mes", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador", DATE_TRUNC('month', v."fecha_creacion") ORDER BY "Mes", "Venta Neta" DESC
```

### ¿Cuáles son los 20 productos con más facturación neta?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", COALESCE(SUM(lv."unidades") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT v."entrada"), 0) AS "Unidades", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY a."ccrefejofacm", a."descripcion" ORDER BY "Venta Neta" DESC LIMIT 20
```

### ¿Cuánto vendemos por familia de producto?
```sql
SELECT f."fami_grup_marc" AS "Familia", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", COALESCE(SUM(lv."unidades") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."unidades") FILTER (WHERE NOT v."entrada"), 0) AS "Unidades" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_familias" f ON f."reg_familia" = a."num_familia" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY f."fami_grup_marc" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por marca?
```sql
SELECT m."marca_tratamien" AS "Marca", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_marcas" m ON m."reg_marca" = a."num_marca" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY m."marca_tratamien" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por temporada?
```sql
SELECT te."temporada_tipo" AS "Temporada", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_temporadas" te ON te."reg_temporada" = a."num_temporada" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY te."temporada_tipo" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto vendemos por departamento?
```sql
SELECT d."depa_secc_fabr" AS "Departamento", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_departamentos" d ON d."reg_departament" = a."num_departament" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY d."depa_secc_fabr" ORDER BY "Venta Neta" DESC
```

### ¿Cuánto importan las devoluciones por tienda este mes?
```sql
SELECT t."identificador" AS "Tienda", COUNT(*) FILTER (WHERE NOT v."entrada") AS "Tickets Devolución", SUM(v."total_si") FILTER (WHERE NOT v."entrada") AS "Importe Devuelto", ROUND(100.0 * SUM(v."total_si") FILTER (WHERE NOT v."entrada") / NULLIF(SUM(v."total_si") FILTER (WHERE v."entrada"), 0), 2) AS "% sobre Bruto" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Importe Devuelto" DESC NULLS LAST
```

### ¿Qué día de la semana vendemos más?
```sql
SELECT TO_CHAR(v."fecha_creacion", 'ID') AS "Día ISO", TRIM(TO_CHAR(v."fecha_creacion", 'Day')) AS "Día", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1, 2 ORDER BY 1
```

### ¿Cómo se reparten las ventas por hora del día?
```sql
SELECT EXTRACT(HOUR FROM v."hora_creacion")::int AS "Hora", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta" FROM "public"."ps_ventas" v WHERE v."hora_creacion" IS NOT NULL AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```

### ¿Cuál es el ticket medio por tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(*) FILTER (WHERE v."entrada") AS "Tickets", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND((COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0)) / NULLIF(COUNT(*) FILTER (WHERE v."entrada"), 0), 2) AS "Ticket Medio" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Ticket Medio" DESC
```

### ¿Cuáles son los mejores clientes de retail por importe gastado?
```sql
SELECT c."nombre" AS "Cliente", COUNT(*) FILTER (WHERE v."entrada") AS "Compras", COALESCE(SUM(v."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(v."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Gasto Neto", MAX(v."fecha_creacion") AS "Última Compra" FROM "public"."ps_ventas" v JOIN "public"."ps_clientes" c ON c."reg_cliente" = v."num_cliente" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY c."nombre" ORDER BY "Gasto Neto" DESC LIMIT 50
```

### ¿Cuántos clientes únicos compran en cada tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(DISTINCT v."num_cliente") AS "Clientes Únicos" FROM "public"."ps_ventas" v JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."num_cliente" IS NOT NULL AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Clientes Únicos" DESC
```

### ¿Cuánto se cobra por cada forma de pago?
```sql
SELECT pv."forma" AS "Forma de Pago", COUNT(*) FILTER (WHERE pv."entrada") AS "Cobros", COALESCE(SUM(pv."importe_cob") FILTER (WHERE pv."entrada"), 0) - COALESCE(SUM(pv."importe_cob") FILTER (WHERE NOT pv."entrada"), 0) AS "Importe Neto" FROM "public"."ps_pagos_ventas" pv WHERE pv."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY pv."forma" ORDER BY "Importe Neto" DESC
```

### ¿Cuál es el mix de formas de pago por tienda?
```sql
SELECT t."identificador" AS "Tienda", pv."forma" AS "Forma de Pago", COALESCE(SUM(pv."importe_cob") FILTER (WHERE pv."entrada"), 0) - COALESCE(SUM(pv."importe_cob") FILTER (WHERE NOT pv."entrada"), 0) AS "Importe Neto" FROM "public"."ps_pagos_ventas" pv JOIN "public"."ps_tiendas" t ON t."codigo" = pv."tienda" WHERE pv."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador", pv."forma" ORDER BY t."identificador", "Importe Neto" DESC
```

### ¿Cuál es el margen bruto por producto en retail?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0) AS "Coste", (COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0)) AS "Margen" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY a."ccrefejofacm", a."descripcion" ORDER BY "Margen" DESC LIMIT 20
```

### ¿Cuál es el porcentaje de margen por familia?
```sql
SELECT f."fami_grup_marc" AS "Familia", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND(100.0 * ((COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0))) / NULLIF(COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0), 0), 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_articulos" a ON a."codigo" = lv."codigo" JOIN "public"."ps_familias" f ON f."reg_familia" = a."num_familia" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY f."fami_grup_marc" ORDER BY "Margen %" DESC
```

### ¿Cuál es el margen por tienda?
```sql
SELECT t."identificador" AS "Tienda", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta", ROUND(100.0 * ((COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0)) - (COALESCE(SUM(lv."total_coste_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_coste_si") FILTER (WHERE NOT v."entrada"), 0))) / NULLIF(COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0), 0), 1) AS "Margen %" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" JOIN "public"."ps_tiendas" t ON t."codigo" = v."tienda" WHERE v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY t."identificador" ORDER BY "Margen %" DESC
```

### ¿Cuánto stock hay en el almacén central por producto?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", sc."stock" AS "Stock Central" FROM "public"."ps_stock_central" sc JOIN "public"."ps_articulos" a ON a."reg_articulo" = sc."num_articulo" WHERE sc."stock" > 0 ORDER BY sc."stock" DESC LIMIT 50
```

### ¿Cuánto stock hay de una referencia en cada tienda y talla?
```sql
SELECT st."tienda" AS "Tienda", st."talla" AS "Talla", st."stock" AS "Stock" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_articulos" a ON a."codigo" = st."codigo" WHERE a."ccrefejofacm" = 'V26212484' AND st."stock" <> 0 ORDER BY st."tienda", st."talla"
```

### ¿Qué stock total tiene cada tienda?
```sql
SELECT t."identificador" AS "Tienda", COUNT(DISTINCT st."codigo") AS "Referencias", SUM(st."stock") AS "Unidades" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_tiendas" t ON t."codigo" = st."tienda" WHERE st."stock" > 0 GROUP BY t."identificador" ORDER BY "Unidades" DESC
```

### ¿Qué productos tienen stock negativo?
```sql
SELECT a."ccrefejofacm" AS "Referencia", a."descripcion" AS "Descripción", st."tienda" AS "Tienda", st."talla" AS "Talla", st."stock" AS "Stock" FROM "public"."ps_stock_tienda" st JOIN "public"."ps_articulos" a ON a."codigo" = st."codigo" WHERE st."stock" < 0 ORDER BY st."stock" ASC LIMIT 50
```

### ¿Cuánto facturamos a mayoristas por mes? (neto de abonos)
```sql
SELECT DATE_TRUNC('month', gf."fecha_factura")::date AS "Mes", COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS NOT TRUE), 0) - COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS TRUE), 0) AS "Facturación Neta" FROM "public"."ps_gc_facturas" gf WHERE gf."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```

### ¿Cuáles son los mejores clientes mayoristas?
```sql
SELECT c."nombre" AS "Cliente", COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS NOT TRUE), 0) - COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS TRUE), 0) AS "Facturación Neta" FROM "public"."ps_gc_facturas" gf JOIN "public"."ps_clientes" c ON c."reg_cliente" = gf."num_cliente" WHERE gf."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY c."nombre" ORDER BY "Facturación Neta" DESC LIMIT 30
```

### ¿Qué productos se venden más en el canal mayorista?
```sql
SELECT gl."codigo" AS "Código", gl."descripcion" AS "Descripción", SUM(gl."unidades") AS "Unidades", SUM(gl."total") AS "Importe" FROM "public"."ps_gc_lin_facturas" gl WHERE gl."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY gl."codigo", gl."descripcion" ORDER BY "Importe" DESC LIMIT 20
```

### ¿Cuánto vende cada comercial de mayorista?
```sql
SELECT co."comercial" AS "Comercial", co."zona_comercial" AS "Zona", COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS NOT TRUE), 0) - COALESCE(SUM(gf."total_factura") FILTER (WHERE gf."abono" IS TRUE), 0) AS "Facturación Neta" FROM "public"."ps_gc_facturas" gf JOIN "public"."ps_gc_comerciales" co ON co."reg_comercial" = gf."num_comercial" WHERE gf."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY co."comercial", co."zona_comercial" ORDER BY "Facturación Neta" DESC
```

### ¿Cuál es el margen del canal mayorista por producto?
```sql
SELECT gl."codigo" AS "Código", gl."descripcion" AS "Descripción", SUM(gl."total") AS "Importe", SUM(gl."total_coste") AS "Coste", SUM(gl."total") - SUM(gl."total_coste") AS "Margen", ROUND(100.0 * (SUM(gl."total") - SUM(gl."total_coste")) / NULLIF(SUM(gl."total"), 0), 1) AS "Margen %" FROM "public"."ps_gc_lin_facturas" gl WHERE gl."fecha_factura" BETWEEN :curr_from AND :curr_to GROUP BY gl."codigo", gl."descripcion" ORDER BY "Margen" DESC LIMIT 20
```

### ¿Cuántas unidades se traspasan entre tiendas y por qué ruta?
```sql
SELECT tr."tienda_salida" AS "Origen", tr."tienda_entrada" AS "Destino", COUNT(*) AS "Movimientos", SUM(tr."unidades_s") AS "Unidades Enviadas" FROM "public"."ps_traspasos" tr WHERE tr."fecha_s" BETWEEN :curr_from AND :curr_to AND NOT tr."entrada" AND COALESCE(tr."tipo", '') NOT IN ('Apertura', 'Inventario Parcial') GROUP BY tr."tienda_salida", tr."tienda_entrada" ORDER BY "Unidades Enviadas" DESC LIMIT 20
```

### ¿Qué tipos de traspaso se usan más?
```sql
SELECT tr."tipo" AS "Tipo", tr."concepto" AS "Concepto", COUNT(*) AS "Movimientos", SUM(tr."unidades_e") AS "Unidades" FROM "public"."ps_traspasos" tr WHERE tr."fecha_e" BETWEEN :curr_from AND :curr_to AND tr."entrada" GROUP BY tr."tipo", tr."concepto" ORDER BY "Movimientos" DESC
```

### ¿Cuánto vendemos en retail excluyendo los artículos de mayorista (prefijo M)?
```sql
SELECT DATE_TRUNC('month', v."fecha_creacion")::date AS "Mes", COALESCE(SUM(lv."total_si") FILTER (WHERE v."entrada"), 0) - COALESCE(SUM(lv."total_si") FILTER (WHERE NOT v."entrada"), 0) AS "Venta Neta Retail" FROM "public"."ps_lineas_ventas" lv JOIN "public"."ps_ventas" v ON v."reg_ventas" = lv."num_ventas" WHERE lv."codigo" NOT LIKE 'M%' AND v."fecha_creacion" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1
```
