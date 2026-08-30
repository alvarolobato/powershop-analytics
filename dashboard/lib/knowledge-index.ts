// GENERADO por dashboard/scripts/build-knowledge-index.mjs — NO editar a mano.
// Regenerar con `npm run build:knowledge` (lo ejecuta también el prebuild).
// Fuente: 20 ficheros. 298 secciones (225 con SQL,
// 149 en dialecto 4D del ERP origen, no ejecutables contra el espejo PostgreSQL).
// Se consulta con la tool `search_knowledge`; no va en el prompt del sistema.

export interface KnowledgeChunk {
  source: string;
  heading: string;
  body: string;
  hasSql: boolean;
  /**
   * "4d"       — SQL contra el ERP origen (tablas sin prefijo: Ventas, CCStock).
   *              NO ejecutable contra el espejo; sirve como semantica de negocio.
   * "postgres" — SQL contra el espejo (tablas ps_*). Ejecutable tal cual.
   * "n/a"      — prosa, glosario o decisiones sin SQL de ninguno de los dos.
   */
  dialect: "4d" | "postgres" | "n/a";
}

export const KNOWLEDGE_INDEX: KnowledgeChunk[] = [
  {
    "source": "docs/sample-queries.md",
    "heading": "PowerShop Sample SQL Queries",
    "body": "> Ready-to-use SQL queries for common analytics tasks against the PowerShop 4D database.\n> All queries use **placeholder values** -- replace with actual codes/dates as needed.\n\n> **Two dialects live in this file. Do not mix them.**\n>\n> | Sections 1-10 (below) | `## LLM:sql-pairs` (end of file) |\n> |---|---|\n> | **4D SQL**, against the live ERP | **PostgreSQL**, against the `ps_*` mirror |\n> | Table names like `Ventas`, `LineasVentas`, `Articulos` | Table names like `ps_ventas`, `ps_lineas_ventas`, `ps_articulos` |\n> | Run via `ps sql query \"...\"` | Run via the dashboard / WrenAI |\n> | No `UNION`, no `FILTER`, case-sensitive strings | Full PostgreSQL |\n>\n> The 4D sections are the **exploration cookbook** for humans working against the\n> source ERP. The `LLM:` sections at the end are what actually reaches the dashboard\n> LLM and WrenAI, and they are PostgreSQL translations validated against the real\n> mirror schema. Copying a 4D query from sections 1-10 into a dashboard widget will\n> fail -- the tables do not exist there, and the mirror does not carry every column.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "List All Tables",
    "body": "```sql\nSELECT TABLE_NAME FROM _USER_TABLES ORDER BY TABLE_NAME\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Get Row Count for a Table",
    "body": "```sql\nSELECT COUNT(*) FROM Articulos\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Describe Table Columns (Safe Types Only)",
    "body": "```sql\nSELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH\nFROM _USER_COLUMNS\nWHERE TABLE_NAME = 'Ventas'\n  AND DATA_TYPE IN (1, 3, 4, 6, 8, 9, 10)\nORDER BY COLUMN_NAME\n```\n\nType reference: 1=Boolean, 3=Integer, 4=Long Integer, 6=Real, 8=Date, 9=Time, 10=Alpha",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Find All Text Columns in a Table",
    "body": "```sql\nSELECT COLUMN_NAME, DATA_LENGTH\nFROM _USER_COLUMNS\nWHERE TABLE_NAME = 'Articulos' AND DATA_TYPE = 10\nORDER BY COLUMN_NAME\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Find All Numeric Columns",
    "body": "```sql\nSELECT COLUMN_NAME, DATA_TYPE\nFROM _USER_COLUMNS\nWHERE TABLE_NAME = 'LineasVentas' AND DATA_TYPE IN (3, 4, 6)\nORDER BY COLUMN_NAME\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Full Schema Dump (All Tables, All Columns)",
    "body": "```sql\nSELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH\nFROM _USER_COLUMNS\nWHERE DATA_TYPE IN (1, 3, 4, 6, 8, 9, 10)\nORDER BY TABLE_NAME, COLUMN_NAME\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Check Indexes on a Table",
    "body": "```sql\nSELECT INDEX_NAME, INDEX_TYPE, UNIQUENESS\nFROM _USER_INDEXES\nWHERE TABLE_NAME = 'Ventas'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Check Foreign Key Relations",
    "body": "```sql\nSELECT CONSTRAINT_NAME, TABLE_NAME, RELATED_TABLE_NAME, CONSTRAINT_TYPE\nFROM _USER_CONSTRAINTS\nWHERE TABLE_NAME = 'LineasVentas'\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Daily Sales Summary for a Store",
    "body": "```sql\nSELECT FechaCreacion, COUNT(*) AS tickets, SUM(Total) AS revenue\nFROM Ventas\nWHERE Tienda = '99'\n  AND FechaCreacion >= '2025-01-01'\n  AND FechaCreacion <= '2025-01-31'\nGROUP BY FechaCreacion\nORDER BY FechaCreacion\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Monthly Sales by Store",
    "body": "```sql\nSELECT lv.Tienda,\n       lv.Mes,\n       COUNT(DISTINCT lv.NumVentas) AS tickets,\n       SUM(lv.Unidades) AS units,\n       SUM(lv.Total) AS revenue\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\nGROUP BY lv.Tienda, lv.Mes\nORDER BY lv.Tienda, lv.Mes\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Top 20 Products by Revenue",
    "body": "```sql\nSELECT lv.Codigo, lv.Descripcion,\n       SUM(lv.Unidades) AS units,\n       SUM(lv.Total) AS revenue,\n       COUNT(*) AS line_count\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202503\n  AND lv.Entrada = TRUE\nGROUP BY lv.Codigo, lv.Descripcion\nORDER BY revenue DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Sales by Family",
    "body": "```sql\nSELECT f.FamiGrupMarc AS familia,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units,\n       COUNT(*) AS lines\nFROM LineasVentas lv\nINNER JOIN FamiGrupMarc f ON lv.NumFamilia = f.RegFamilia\nWHERE lv.Mes = 202501\n  AND lv.Entrada = TRUE\nGROUP BY f.FamiGrupMarc\nORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Sales by Department",
    "body": "```sql\nSELECT d.DepaSeccFabr AS departamento,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units\nFROM LineasVentas lv\nINNER JOIN DepaSeccFabr d ON lv.NumDepartament = d.RegDepartament\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\nGROUP BY d.DepaSeccFabr\nORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Sales by Brand",
    "body": "```sql\nSELECT m.Marca AS marca,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units\nFROM LineasVentas lv\nINNER JOIN CCOPMarcTrat m ON lv.NumMarca = m.RegMarca\nWHERE lv.Mes = 202501\n  AND lv.Entrada = TRUE\nGROUP BY m.Marca\nORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Sales by Season",
    "body": "```sql\nSELECT t.Temporada AS temporada,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units\nFROM LineasVentas lv\nINNER JOIN CCOPTempTipo t ON lv.NumTemporada = t.RegTemporada\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\nGROUP BY t.Temporada\nORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Returns/Refunds",
    "body": "```sql\nSELECT lv.Tienda,\n       lv.Mes,\n       COUNT(*) AS return_lines,\n       SUM(lv.Unidades) AS returned_units,\n       SUM(lv.Total) AS refund_amount\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = FALSE\nGROUP BY lv.Tienda, lv.Mes\nORDER BY lv.Tienda, lv.Mes\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Day-of-Week Sales Pattern",
    "body": "```sql\nSELECT DAYOFWEEK(FechaCreacion) AS dow,\n       COUNT(*) AS tickets,\n       SUM(Total) AS revenue\nFROM Ventas\nWHERE FechaCreacion >= '2025-01-01'\n  AND FechaCreacion <= '2025-12-31'\n  AND Entrada = TRUE\nGROUP BY DAYOFWEEK(FechaCreacion)\nORDER BY dow\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Hourly Sales Distribution",
    "body": "```sql\nSELECT HOUR(Hora) AS hour,\n       COUNT(*) AS tickets,\n       SUM(Total) AS revenue\nFROM Ventas\nWHERE FechaCreacion >= '2025-01-01'\n  AND Entrada = TRUE\nGROUP BY HOUR(Hora)\nORDER BY hour\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Average Ticket Value by Store",
    "body": "```sql\nSELECT Tienda,\n       COUNT(*) AS tickets,\n       SUM(Total) AS revenue,\n       SUM(Total) / COUNT(*) AS avg_ticket\nFROM Ventas\nWHERE FechaCreacion >= '2025-01-01'\n  AND Total > 0\n  AND Entrada = TRUE\nGROUP BY Tienda\nORDER BY avg_ticket DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Delivery Notes by Customer",
    "body": "```sql\nSELECT ga.Cliente,\n       COUNT(*) AS num_albaranes,\n       SUM(ga.Unidades) AS total_units,\n       SUM(ga.TotalAlbaran) AS total_amount\nFROM GCAlbaranes ga\nWHERE ga.FechaEnvio >= '2025-01-01'\n  AND ga.Abono = FALSE\nGROUP BY ga.Cliente\nORDER BY total_amount DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Invoice Summary by Month",
    "body": "```sql\nSELECT YEAR(gf.FechaFactura) AS yr,\n       MONTH(gf.FechaFactura) AS mo,\n       COUNT(*) AS invoices,\n       SUM(gf.TotalFactura) AS total\nFROM GCFacturas gf\nWHERE gf.FechaFactura >= '2025-01-01'\n  AND gf.Abono = FALSE\n  AND gf.FacturaAnulada = FALSE\nGROUP BY YEAR(gf.FechaFactura), MONTH(gf.FechaFactura)\nORDER BY yr, mo\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Top Wholesale Products",
    "body": "```sql\nSELECT gl.Codigo, gl.Descripcion,\n       SUM(gl.Unidades) AS units,\n       SUM(gl.Total) AS revenue\nFROM GCLinFacturas gl\nWHERE gl.Mes BETWEEN 202501 AND 202512\n  AND gl.Unidades > 0\nGROUP BY gl.Codigo, gl.Descripcion\nORDER BY revenue DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale by Sales Representative",
    "body": "```sql\nSELECT gc.Comercial,\n       COUNT(*) AS invoices,\n       SUM(gf.TotalFactura) AS total\nFROM GCFacturas gf\nINNER JOIN GCComerciales gc ON gf.NumComercial = gc.RegComercial\nWHERE gf.FechaFactura >= '2025-01-01'\n  AND gf.Abono = FALSE\nGROUP BY gc.Comercial\nORDER BY total DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Credit Notes (Returns)",
    "body": "```sql\nSELECT ga.Cliente,\n       COUNT(*) AS abonos,\n       SUM(ga.TotalAlbaran) AS total_returned\nFROM GCAlbaranes ga\nWHERE ga.FechaEnvio >= '2025-01-01'\n  AND ga.Abono = TRUE\nGROUP BY ga.Cliente\nORDER BY total_returned DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Collections Status",
    "body": "```sql\nSELECT gf.NFactura, gf.Cliente, gf.TotalFactura,\n       SUM(cf.Importe) AS cobrado,\n       gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) AS pendiente\nFROM GCFacturas gf\nLEFT OUTER JOIN CobrosFacturas cf ON gf.RegFactura = cf.NumFactura\nWHERE gf.FechaFactura >= '2025-01-01'\nGROUP BY gf.NFactura, gf.Cliente, gf.TotalFactura\nHAVING gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) > 0\nORDER BY pendiente DESC\nLIMIT 20\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Central Warehouse Stock (Store 99)",
    "body": "```sql\nSELECT cs.NumArticulo, a.Codigo, a.Descripcion,\n       cs.Stock AS total_central,\n       cs.Stock1, cs.Stock2, cs.Stock3, cs.Stock4, cs.Stock5,\n       cs.Talla1, cs.Talla2, cs.Talla3, cs.Talla4, cs.Talla5\nFROM CCStock cs\nINNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\nWHERE cs.Stock > 0\nORDER BY cs.Stock DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Retail Store Stock",
    "body": "```sql\nSELECT e.Tienda, e.Codigo, e.Descripcion,\n       e.STStock AS total_store,\n       e.Stock1, e.Stock2, e.Stock3, e.Stock4, e.Stock5,\n       e.Talla1, e.Talla2, e.Talla3, e.Talla4, e.Talla5\nFROM Exportaciones e\nWHERE e.Tienda = '104'\n  AND e.STStock > 0\nORDER BY e.STStock DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Total Stock Across All Stores for a Product",
    "body": "```sql\n-- Central stock\nSELECT 'Central' AS location, cs.Stock AS total\nFROM CCStock cs\nINNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\nWHERE a.Codigo = '12345'\n\n-- Per-store stock (run separately, 4D does not support UNION)\nSELECT e.Tienda AS location, e.STStock AS total\nFROM Exportaciones e\nWHERE e.Codigo = '12345'\n  AND e.STStock > 0\nORDER BY e.STStock DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Products with Zero Stock",
    "body": "```sql\nSELECT a.Codigo, a.Descripcion, a.Stock\nFROM Articulos a\nWHERE a.Anulado = FALSE\n  AND a.Stock = 0\n  AND a.Precio1 > 0\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Products with Negative Stock",
    "body": "```sql\nSELECT a.Codigo, a.Descripcion, a.Stock\nFROM Articulos a\nWHERE a.Stock < 0\n  AND a.Anulado = FALSE\nORDER BY a.Stock ASC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Store Stock Summary",
    "body": "```sql\nSELECT e.Tienda,\n       COUNT(*) AS products_in_store,\n       SUM(e.STStock) AS total_units\nFROM Exportaciones e\nWHERE e.STStock > 0\nGROUP BY e.Tienda\nORDER BY total_units DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Top Customers by Purchase Volume (Retail)",
    "body": "```sql\nSELECT v.NumCliente, v.Cliente,\n       COUNT(*) AS num_purchases,\n       SUM(v.Total) AS total_spent\nFROM Ventas v\nWHERE v.NumCliente > 0\n  AND v.FechaCreacion >= '2025-01-01'\n  AND v.Entrada = TRUE\nGROUP BY v.NumCliente, v.Cliente\nHAVING SUM(v.Total) > 99.99\nORDER BY total_spent DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Customer Purchase Frequency",
    "body": "```sql\nSELECT v.NumCliente, v.Cliente,\n       COUNT(*) AS visits,\n       MIN(v.FechaCreacion) AS first_visit,\n       MAX(v.FechaCreacion) AS last_visit,\n       SUM(v.Total) AS total_spent\nFROM Ventas v\nWHERE v.NumCliente > 0\n  AND v.Entrada = TRUE\n  AND v.FechaCreacion >= '2025-01-01'\nGROUP BY v.NumCliente, v.Cliente\nHAVING COUNT(*) > 1\nORDER BY visits DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Customer Summary",
    "body": "```sql\nSELECT c.Cliente, c.Poblacion, c.Provincia,\n       c.FormaPago, c.PDescCom AS discount_pct,\n       c.RiesgoConcedid AS credit_limit,\n       c.BloqueoFinancials AS blocked\nFROM Clientes c\nWHERE c.Mayorista = TRUE\n  AND c.Anulado = FALSE\nORDER BY c.Cliente\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Customers Created in a Period",
    "body": "```sql\nSELECT Codigo, Cliente, Tienda, FechaCreacion\nFROM Clientes\nWHERE FechaCreacion >= '2025-01-01'\n  AND FechaCreacion <= '2025-12-31'\nORDER BY FechaCreacion DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Unique Customer Count per Store",
    "body": "```sql\nSELECT v.Tienda,\n       COUNT(DISTINCT v.NumCliente) AS unique_customers\nFROM Ventas v\nWHERE v.NumCliente > 0\n  AND v.FechaCreacion >= '2025-01-01'\nGROUP BY v.Tienda\nORDER BY unique_customers DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Revenue by Payment Method (using ImporteCob)",
    "body": "```sql\nSELECT pv.Forma,\n       COUNT(*) AS payment_count,\n       SUM(pv.ImporteCob) AS collected\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '2025-01-01'\n  AND pv.FechaCreacion <= '2025-01-31'\n  AND pv.Entrada = TRUE\nGROUP BY pv.Forma\nORDER BY collected DESC\n```\n\n**Important**: Use `ImporteCob` (amount collected), not `ImporteEnt` (amount tendered).",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Payment Method Mix by Store",
    "body": "```sql\nSELECT pv.Tienda, pv.Forma,\n       SUM(pv.ImporteCob) AS collected\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '2025-01-01'\n  AND pv.Entrada = TRUE\nGROUP BY pv.Tienda, pv.Forma\nORDER BY pv.Tienda, collected DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Daily Cash vs Card",
    "body": "```sql\nSELECT pv.FechaCreacion,\n       SUM(CASE WHEN pv.CodigoForma = '01' THEN pv.ImporteCob ELSE 0 END) AS cash,\n       SUM(CASE WHEN pv.CodigoForma <> '01' THEN pv.ImporteCob ELSE 0 END) AS non_cash,\n       SUM(pv.ImporteCob) AS total\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '2025-01-01'\n  AND pv.Entrada = TRUE\nGROUP BY pv.FechaCreacion\nORDER BY pv.FechaCreacion\n```\n\n*Note: `CodigoForma = '01'` is typically cash/metalico -- verify with FormasPago table.*",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Voucher Redemptions",
    "body": "```sql\nSELECT v.TiendaRec AS store,\n       YEAR(v.Recepcion) AS yr,\n       MONTH(v.Recepcion) AS mo,\n       COUNT(*) AS vouchers_used,\n       SUM(v.Importe) AS total_redeemed\nFROM Vales v\nWHERE v.Recepcion IS NOT NULL\n  AND v.Recepcion >= '2025-01-01'\nGROUP BY v.TiendaRec, YEAR(v.Recepcion), MONTH(v.Recepcion)\nORDER BY yr, mo, store\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Product Margin Analysis (Retail)",
    "body": "```sql\nSELECT lv.Codigo, lv.Descripcion,\n       SUM(lv.Unidades) AS units,\n       SUM(lv.TotalSI) AS net_revenue,\n       SUM(lv.TotalCosteSI) AS total_cost,\n       SUM(lv.TotalSI) - SUM(lv.TotalCosteSI) AS gross_margin,\n       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\n  AND lv.TotalSI > 0\nGROUP BY lv.Codigo, lv.Descripcion\nHAVING SUM(lv.TotalSI) > 0\nORDER BY gross_margin DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Margin by Family",
    "body": "```sql\nSELECT f.FamiGrupMarc AS familia,\n       SUM(lv.TotalSI) AS net_revenue,\n       SUM(lv.TotalCosteSI) AS total_cost,\n       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct\nFROM LineasVentas lv\nINNER JOIN FamiGrupMarc f ON lv.NumFamilia = f.RegFamilia\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\n  AND lv.TotalSI > 0\nGROUP BY f.FamiGrupMarc\nORDER BY margin_pct DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Margin by Store",
    "body": "```sql\nSELECT lv.Tienda,\n       SUM(lv.TotalSI) AS net_revenue,\n       SUM(lv.TotalCosteSI) AS total_cost,\n       ROUND((SUM(lv.TotalSI) - SUM(lv.TotalCosteSI)) / SUM(lv.TotalSI) * 100, 1) AS margin_pct\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\n  AND lv.TotalSI > 0\nGROUP BY lv.Tienda\nORDER BY margin_pct DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Margin (from GCLinFacturas)",
    "body": "```sql\nSELECT gl.Codigo, gl.Descripcion,\n       SUM(gl.Unidades) AS units,\n       SUM(gl.Total) AS revenue,\n       SUM(gl.TotalCoste) AS cost,\n       SUM(gl.Total) - SUM(gl.TotalCoste) AS margin,\n       ROUND((SUM(gl.Total) - SUM(gl.TotalCoste)) / SUM(gl.Total) * 100, 1) AS margin_pct\nFROM GCLinFacturas gl\nWHERE gl.Mes BETWEEN 202501 AND 202512\n  AND gl.Unidades > 0\n  AND gl.Total > 0\nGROUP BY gl.Codigo, gl.Descripcion\nORDER BY margin DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Low-Margin Products (Below 30%)",
    "body": "```sql\nSELECT a.Codigo, a.Descripcion,\n       a.Precio1 AS pvp,\n       a.PrecioCoste AS cost,\n       ROUND((a.Precio1 - a.PrecioCoste) / a.Precio1 * 100, 1) AS margin_pct\nFROM Articulos a\nWHERE a.Precio1 > 0 AND a.PrecioCoste > 0\n  AND a.Anulado = FALSE\n  AND (a.Precio1 - a.PrecioCoste) / a.Precio1 < 0.3\nORDER BY margin_pct ASC\nLIMIT 50\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Transfer Volume by Route",
    "body": "```sql\nSELECT TiendaSalida, TiendaEntrada,\n       COUNT(*) AS transfers,\n       SUM(UnidadesS) AS units_sent\nFROM Traspasos\nWHERE FechaS >= '2025-01-01'\n  AND Entrada = FALSE\nGROUP BY TiendaSalida, TiendaEntrada\nORDER BY units_sent DESC\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Transfer Volume by Type",
    "body": "```sql\nSELECT Tipo,\n       COUNT(*) AS count,\n       SUM(UnidadesE) AS units\nFROM Traspasos\nWHERE FechaE >= '2025-01-01'\n  AND Entrada = TRUE\nGROUP BY Tipo\nORDER BY count DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Daily Transfer Activity",
    "body": "```sql\nSELECT FechaS AS fecha,\n       COUNT(*) AS transfers,\n       SUM(UnidadesS) AS units\nFROM Traspasos\nWHERE FechaS >= '2025-01-01'\n  AND Entrada = FALSE\nGROUP BY FechaS\nORDER BY FechaS\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Transfers for a Specific Product",
    "body": "```sql\nSELECT FechaS, TiendaSalida, TiendaEntrada,\n       Talla, UnidadesS, Tipo, Concepto\nFROM Traspasos\nWHERE Codigo = '12345'\n  AND FechaS >= '2025-01-01'\n  AND Entrada = FALSE\nORDER BY FechaS DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Retail-Only Products (exclude M-prefix)",
    "body": "```sql\nSELECT Codigo, Descripcion, Precio1, Stock\nFROM Articulos\nWHERE Codigo NOT LIKE 'M%'\n  AND Anulado = FALSE\n  AND Stock > 0\nORDER BY Codigo\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale-Only Products (M-prefix)",
    "body": "```sql\nSELECT Codigo, Descripcion, Precio1, Stock\nFROM Articulos\nWHERE Codigo LIKE 'M%'\n  AND Anulado = FALSE\nORDER BY Codigo\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Retail Sales Excluding Wholesale Articles",
    "body": "```sql\nSELECT lv.Tienda, lv.Mes,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Codigo NOT LIKE 'M%'\n  AND lv.Entrada = TRUE\nGROUP BY lv.Tienda, lv.Mes\nORDER BY lv.Tienda, lv.Mes\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Wholesale Delivery Notes with M-Prefix Products",
    "body": "```sql\nSELECT gl.NAlbaran, gl.Codigo, gl.Descripcion,\n       gl.Unidades, gl.Total\nFROM GCLinAlbarane gl\nWHERE gl.Codigo LIKE 'M%'\n  AND gl.FechaAlbaran >= '2025-01-01'\nORDER BY gl.FechaAlbaran DESC\nLIMIT 50\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "SQL Implementation",
    "body": "```sql\n-- Entries to a store (Traspasos where Entrada=True)\nSELECT SUM(UnidadesE) AS traspasos_entrada\nFROM Traspasos\nWHERE TiendaEntrada = '104'\n  AND FechaE >= '2025-01-01'\n  AND FechaE <= '2025-01-31'\n  AND Entrada = TRUE\n\n-- Exits from a store (Traspasos where Entrada=False)\nSELECT SUM(UnidadesS) AS traspasos_salida\nFROM Traspasos\nWHERE TiendaSalida = '104'\n  AND FechaS >= '2025-01-01'\n  AND FechaS <= '2025-01-31'\n  AND Entrada = FALSE\n\n-- Sales exits\nSELECT SUM(lv.Unidades) AS ventas_salida\nFROM LineasVentas lv\nWHERE lv.Tienda = '104'\n  AND lv.Mes = 202501\n  AND lv.Entrada = TRUE\n\n-- Returns entries\nSELECT SUM(lv.Unidades) AS devoluciones_entrada\nFROM LineasVentas lv\nWHERE lv.Tienda = '104'\n  AND lv.Mes = 202501\n  AND lv.Entrada = FALSE\n\n-- Wholesale delivery note entries (Albaranes de compra recibidos)\nSELECT SUM(la.Recibidas) AS albaranes_entrada\nFROM LinAlbaranes la\nINNER JOIN Albaranes a ON la.NumAlbaran = a.RegAlbaran\nWHERE a.TiendaEntrada = '104'\n  AND a.FechaRecibido >= '2025-01-01'\n  AND a.FechaRecibido <= '2025-01-31'\n  AND a.Abono = FALSE\n\n-- Wholesale return exits (Albaranes de devolucion)\nSELECT SUM(la.Recibidas) AS albaranes_devolucion\nFROM LinAlbaranes la\nINNER JOIN Albaranes a ON la.NumAlbaran = a.RegAlbaran\nWHERE a.TiendaSalida = '104'\n  AND a.FechaRecibido >= '2025-01-01'\n  AND a.FechaRecibido <= '2025-01-31'\n  AND a.Abono = TRUE\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Python Implementation",
    "body": "```python\ndef calculate_stock_movement(cur, store, start_date, end_date):\n    \"\"\"Calculate net stock movement for a store in a date range.\"\"\"\n\n    # Entries: transfers in\n    cur.execute(f\"\"\"\n        SELECT COALESCE(SUM(UnidadesE), 0)\n        FROM Traspasos\n        WHERE TiendaEntrada = '{store}'\n          AND FechaE >= '{start_date}' AND FechaE <= '{end_date}'\n          AND Entrada = TRUE\n    \"\"\")\n    traspasos_in = cur.fetchone()[0] or 0\n\n    # Exits: transfers out\n    cur.execute(f\"\"\"\n        SELECT COALESCE(SUM(UnidadesS), 0)\n        FROM Traspasos\n        WHERE TiendaSalida = '{store}'\n          AND FechaS >= '{start_date}' AND FechaS <= '{end_date}'\n          AND Entrada = FALSE\n    \"\"\")\n    traspasos_out = cur.fetchone()[0] or 0\n\n    # Sales exits\n    mes_start = int(start_date[:4] + start_date[5:7])\n    mes_end = int(end_date[:4] + end_date[5:7])\n    cur.execute(f\"\"\"\n        SELECT COALESCE(SUM(Unidades), 0)\n        FROM LineasVentas\n        WHERE Tienda = '{store}'\n          AND Mes BETWEEN {mes_start} AND {mes_end}\n          AND Entrada = TRUE\n    \"\"\")\n    ventas = cur.fetchone()[0] or 0\n\n    # Returns entries\n    cur.execute(f\"\"\"\n        SELECT COALESCE(SUM(Unidades), 0)\n        FROM LineasVentas\n        WHERE Tienda = '{store}'\n          AND Mes BETWEEN {mes_start} AND {mes_end}\n          AND Entrada = FALSE\n    \"\"\")\n    devoluciones = cur.fetchone()[0] or 0\n\n    entradas = devoluciones + traspasos_in\n    salidas = ventas + traspasos_out\n    neto = entradas - salidas\n\n    return {\n        'entradas': entradas,\n        'salidas': salidas,\n        'neto': neto,\n        'traspasos_in': traspasos_in,\n        'traspasos_out': traspasos_out,\n        'ventas': ventas,\n        'devoluciones': devoluciones\n    }\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "Tips and Gotchas",
    "body": "1. **Always filter on `Entrada`** when summing sales/returns to avoid double-counting.\n2. **Use `Mes` (YYYYMM integer)** on LineasVentas/GCLinFacturas for fast period filtering instead of date functions.\n3. **Use `ImporteCob`** (not `ImporteEnt`) in PagosVentas for actual revenue.\n4. **M-prefix articles** are wholesale -- exclude them with `Codigo NOT LIKE 'M%'` for retail-only analysis.\n5. **Never `SELECT *`** on wide tables (CCStock: 582 cols, Articulos: 372 cols). Always list specific columns.\n6. **String comparison is case-sensitive** in 4D SQL. Use `UPPER()` for case-insensitive searches.\n7. **No UNION support** in 4D SQL v18. Run separate queries and combine in Python.\n8. **Text fields may return bytes** in Python 3.13+. Always decode: `val.decode('utf-8', errors='replace') if isinstance(val, bytes) else val`.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "LLM:rules",
    "body": "Reglas que gobiernan la traduccion de este recetario al espejo PostgreSQL.\n\n```json\n[\n  {\n    \"instruction\": \"El recetario docs/sample-queries.md secciones 1-10 esta escrito en SQL de 4D contra el ERP origen (tablas Ventas, LineasVentas, Articulos, CCStock, Exportaciones, Traspasos, GCLinFacturas). El dashboard y WrenAI consultan el ESPEJO PostgreSQL con tablas ps_*. Nunca copies una consulta 4D a un widget: esas tablas no existen en PostgreSQL. Usa siempre los pares SQL en ps_*.\",\n    \"questions\": [\n      \"puedo usar las consultas del recetario\",\n      \"por que falla FROM Ventas\",\n      \"que dialecto uso\"\n    ]\n  },\n  {\n    \"instruction\": \"El espejo PostgreSQL NO replica todas las columnas de 4D. Diferencias que rompen traducciones ingenuas: ps_lineas_ventas SI tiene 'entrada', 'movimiento_caja' y 'talla' desde 2026-08 (vacias en filas anteriores a la resincronizacion); el JOIN con ps_ventas sigue haciendo falta para atributos de cabecera como tienda o cliente; ps_lineas_ventas NO tiene num_familia/num_marca/num_temporada/num_departament (hay que unir con ps_articulos por 'codigo' y de ahi a la dimension); ps_articulos NO tiene columna 'stock'. Antes de usar una columna, comprueba que existe.\",\n    \"questions\": [\n      \"ps_lineas_ventas tiene entrada\",\n      \"como agrupo ventas por familia\",\n      \"por que no encuentro la columna\"\n    ]\n  },\n  {\n    \"instruction\": \"Ruta de JOIN canonica para ventas retail por dimension de producto: ps_lineas_ventas lv -> ps_ventas v ON v.reg_ventas = lv.num_ventas (para 'entrada' y la fecha) -> ps_articulos a ON a.codigo = lv.codigo (para la referencia y las FK de dimension) -> ps_familias f ON f.reg_familia = a.num_familia (o ps_marcas.reg_marca, ps_temporadas.reg_temporada, ps_departamentos.reg_departament). Para la tienda: ps_tiendas t ON t.codigo = v.tienda, y muestra t.identificador, no el codigo.\",\n    \"questions\": [\n      \"como uno lineas de venta con familia\",\n      \"join de ventas y articulos\",\n      \"como saco el nombre de la tienda\"\n    ]\n  },\n  {\n    \"instruction\": \"En el canal mayorista la linea de factura ps_gc_lin_facturas SI lleva sus propias FK de dimension (num_familia, num_marca, num_departament, num_color, num_comercial) y su propia fecha_factura, asi que no hace falta unir con la cabecera para agrupar. Une con ps_gc_facturas solo cuando necesites la bandera 'abono' para netear.\",\n    \"questions\": [\n      \"como agrupo facturacion mayorista por familia\",\n      \"necesito la cabecera de factura\"\n    ]\n  },\n  {\n    \"instruction\": \"Cuidado con las claves del mayorista: ps_gc_lin_albarane.num_albaran es la FK real a ps_gc_albaranes.reg_albaran, mientras que n_albaran es el numero visible del albaran y NO es unico. Une siempre por num_albaran -> reg_albaran. Lo mismo en ps_gc_lin_facturas: num_factura -> ps_gc_facturas.reg_factura.\",\n    \"questions\": [\n      \"como uno lineas y cabeceras de albaran\",\n      \"n_albaran o num_albaran\"\n    ]\n  },\n  {\n    \"instruction\": \"ps_lineas_ventas.mes es un entero AAAAMM (202501) heredado de 4D y sirve para filtros de periodo rapidos. En PostgreSQL es igual de valido y mas legible filtrar por v.fecha_creacion con DATE_TRUNC; usa mes solo si te interesa el rendimiento sobre rangos largos. No mezcles mes con fecha_creacion en el mismo filtro sin comprobar que concuerdan.\",\n    \"questions\": [\n      \"que es la columna mes\",\n      \"como filtro por periodo\"\n    ]\n  },\n  {\n    \"instruction\": \"El stock vive en dos tablas distintas del espejo: ps_stock_tienda (grano codigo + tienda + talla, columna 'stock') para tiendas retail, y ps_stock_central (grano num_articulo, columna 'stock') para el almacen central. ps_stock_central.num_articulo une con ps_articulos.reg_articulo; ps_stock_tienda.codigo une con ps_articulos.codigo. Ojo: son claves distintas, no las intercambies.\",\n    \"questions\": [\n      \"donde esta el stock\",\n      \"stock central o de tienda\",\n      \"como uno stock con articulos\"\n    ]\n  },\n  {\n    \"instruction\": \"ps_traspasos usa doble anotaci",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto hemos vendido cada día en una tienda concreta? (neto de devoluciones)",
    "body": "```sql\nSELECT v.\"fecha_creacion\" AS \"Fecha\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" = '99' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY v.\"fecha_creacion\" ORDER BY v.\"fecha_creacion\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es la venta neta mensual por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", DATE_TRUNC('month', v.\"fecha_creacion\")::date AS \"Mes\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\", DATE_TRUNC('month', v.\"fecha_creacion\") ORDER BY \"Mes\", \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los 20 productos con más facturación neta?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY a.\"ccrefejofacm\", a.\"descripcion\" ORDER BY \"Venta Neta\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por familia de producto?",
    "body": "```sql\nSELECT f.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_familias\" f ON f.\"reg_familia\" = a.\"num_familia\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY f.\"fami_grup_marc\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por marca?",
    "body": "```sql\nSELECT m.\"marca_tratamien\" AS \"Marca\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_marcas\" m ON m.\"reg_marca\" = a.\"num_marca\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY m.\"marca_tratamien\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por temporada?",
    "body": "```sql\nSELECT te.\"temporada_tipo\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_temporadas\" te ON te.\"reg_temporada\" = a.\"num_temporada\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY te.\"temporada_tipo\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON d.\"reg_departament\" = a.\"num_departament\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY d.\"depa_secc_fabr\" ORDER BY \"Venta Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto importan las devoluciones por tienda este mes?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(*) FILTER (WHERE NOT v.\"entrada\") AS \"Tickets Devolución\", SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\") AS \"Importe Devuelto\", ROUND(100.0 * SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\") / NULLIF(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0), 2) AS \"% sobre Bruto\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Importe Devuelto\" DESC NULLS LAST\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué día de la semana vendemos más?",
    "body": "```sql\nSELECT TO_CHAR(v.\"fecha_creacion\", 'ID') AS \"Día ISO\", TRIM(TO_CHAR(v.\"fecha_creacion\", 'Day')) AS \"Día\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1, 2 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cómo se reparten las ventas por hora del día?",
    "body": "```sql\nSELECT EXTRACT(HOUR FROM v.\"hora_creacion\")::int AS \"Hora\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\" FROM \"public\".\"ps_ventas\" v WHERE v.\"hora_creacion\" IS NOT NULL AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el ticket medio por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Tickets\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND((COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) / NULLIF(COUNT(*) FILTER (WHERE v.\"entrada\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Ticket Medio\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los mejores clientes de retail por importe gastado?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(*) FILTER (WHERE v.\"entrada\") AS \"Compras\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Gasto Neto\", MAX(v.\"fecha_creacion\") AS \"Última Compra\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_clientes\" c ON c.\"reg_cliente\" = v.\"num_cliente\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Gasto Neto\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuántos clientes únicos compran en cada tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(DISTINCT v.\"num_cliente\") AS \"Clientes Únicos\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"num_cliente\" IS NOT NULL AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Clientes Únicos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto se cobra por cada forma de pago?",
    "body": "```sql\nSELECT pv.\"forma\" AS \"Forma de Pago\", COUNT(*) FILTER (WHERE pv.\"entrada\") AS \"Cobros\", COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE pv.\"entrada\"), 0) - COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE NOT pv.\"entrada\"), 0) AS \"Importe Neto\" FROM \"public\".\"ps_pagos_ventas\" pv WHERE pv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY pv.\"forma\" ORDER BY \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el mix de formas de pago por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", pv.\"forma\" AS \"Forma de Pago\", COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE pv.\"entrada\"), 0) - COALESCE(SUM(pv.\"importe_cob\") FILTER (WHERE NOT pv.\"entrada\"), 0) AS \"Importe Neto\" FROM \"public\".\"ps_pagos_ventas\" pv JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = pv.\"tienda\" WHERE pv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\", pv.\"forma\" ORDER BY t.\"identificador\", \"Importe Neto\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen bruto por producto en retail?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste\", (COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) AS \"Margen\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY a.\"ccrefejofacm\", a.\"descripcion\" ORDER BY \"Margen\" DESC LIMIT 20\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el porcentaje de margen por familia?",
    "body": "```sql\nSELECT f.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND(100.0 * ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = lv.\"codigo\" JOIN \"public\".\"ps_familias\" f ON f.\"reg_familia\" = a.\"num_familia\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY f.\"fami_grup_marc\" ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen por tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta\", ROUND(100.0 * ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = v.\"tienda\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"identificador\" ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto stock hay en el almacén central por producto?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", sc.\"stock\" AS \"Stock Central\" FROM \"public\".\"ps_stock_central\" sc JOIN \"public\".\"ps_articulos\" a ON a.\"reg_articulo\" = sc.\"num_articulo\" WHERE sc.\"stock\" > 0 ORDER BY sc.\"stock\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto stock hay de una referencia en cada tienda y talla?",
    "body": "```sql\nSELECT st.\"tienda\" AS \"Tienda\", st.\"talla\" AS \"Talla\", st.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = st.\"codigo\" WHERE a.\"ccrefejofacm\" = 'V26212484' AND st.\"stock\" <> 0 ORDER BY st.\"tienda\", st.\"talla\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué stock total tiene cada tienda?",
    "body": "```sql\nSELECT t.\"identificador\" AS \"Tienda\", COUNT(DISTINCT st.\"codigo\") AS \"Referencias\", SUM(st.\"stock\") AS \"Unidades\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_tiendas\" t ON t.\"codigo\" = st.\"tienda\" WHERE st.\"stock\" > 0 GROUP BY t.\"identificador\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué productos tienen stock negativo?",
    "body": "```sql\nSELECT a.\"ccrefejofacm\" AS \"Referencia\", a.\"descripcion\" AS \"Descripción\", st.\"tienda\" AS \"Tienda\", st.\"talla\" AS \"Talla\", st.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" st JOIN \"public\".\"ps_articulos\" a ON a.\"codigo\" = st.\"codigo\" WHERE st.\"stock\" < 0 ORDER BY st.\"stock\" ASC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto facturamos a mayoristas por mes? (neto de abonos)",
    "body": "```sql\nSELECT DATE_TRUNC('month', gf.\"fecha_factura\")::date AS \"Mes\", COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS TRUE), 0) AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" gf WHERE gf.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuáles son los mejores clientes mayoristas?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS TRUE), 0) AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" gf JOIN \"public\".\"ps_clientes\" c ON c.\"reg_cliente\" = gf.\"num_cliente\" WHERE gf.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Facturación Neta\" DESC LIMIT 30\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué productos se venden más en el canal mayorista?",
    "body": "```sql\nSELECT gl.\"codigo\" AS \"Código\", gl.\"descripcion\" AS \"Descripción\", SUM(gl.\"unidades\") AS \"Unidades\", SUM(gl.\"total\") AS \"Importe\" FROM \"public\".\"ps_gc_lin_facturas\" gl WHERE gl.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY gl.\"codigo\", gl.\"descripcion\" ORDER BY \"Importe\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vende cada comercial de mayorista?",
    "body": "```sql\nSELECT co.\"comercial\" AS \"Comercial\", co.\"zona_comercial\" AS \"Zona\", COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(gf.\"total_factura\") FILTER (WHERE gf.\"abono\" IS TRUE), 0) AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" gf JOIN \"public\".\"ps_gc_comerciales\" co ON co.\"reg_comercial\" = gf.\"num_comercial\" WHERE gf.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY co.\"comercial\", co.\"zona_comercial\" ORDER BY \"Facturación Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuál es el margen del canal mayorista por producto?",
    "body": "```sql\nSELECT gl.\"codigo\" AS \"Código\", gl.\"descripcion\" AS \"Descripción\", SUM(gl.\"total\") AS \"Importe\", SUM(gl.\"total_coste\") AS \"Coste\", SUM(gl.\"total\") - SUM(gl.\"total_coste\") AS \"Margen\", ROUND(100.0 * (SUM(gl.\"total\") - SUM(gl.\"total_coste\")) / NULLIF(SUM(gl.\"total\"), 0), 1) AS \"Margen %\" FROM \"public\".\"ps_gc_lin_facturas\" gl WHERE gl.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY gl.\"codigo\", gl.\"descripcion\" ORDER BY \"Margen\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuántas unidades se traspasan entre tiendas y por qué ruta?",
    "body": "```sql\nSELECT tr.\"tienda_salida\" AS \"Origen\", tr.\"tienda_entrada\" AS \"Destino\", COUNT(*) AS \"Movimientos\", SUM(tr.\"unidades_s\") AS \"Unidades Enviadas\" FROM \"public\".\"ps_traspasos\" tr WHERE tr.\"fecha_s\" BETWEEN :curr_from AND :curr_to AND NOT tr.\"entrada\" AND COALESCE(tr.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial') GROUP BY tr.\"tienda_salida\", tr.\"tienda_entrada\" ORDER BY \"Unidades Enviadas\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Qué tipos de traspaso se usan más?",
    "body": "```sql\nSELECT tr.\"tipo\" AS \"Tipo\", tr.\"concepto\" AS \"Concepto\", COUNT(*) AS \"Movimientos\", SUM(tr.\"unidades_e\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" tr WHERE tr.\"fecha_e\" BETWEEN :curr_from AND :curr_to AND tr.\"entrada\" GROUP BY tr.\"tipo\", tr.\"concepto\" ORDER BY \"Movimientos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/sample-queries.md",
    "heading": "¿Cuánto vendemos en retail excluyendo los artículos de mayorista (prefijo M)?",
    "body": "```sql\nSELECT DATE_TRUNC('month', v.\"fecha_creacion\")::date AS \"Mes\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Venta Neta Retail\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON v.\"reg_ventas\" = lv.\"num_ventas\" WHERE lv.\"codigo\" NOT LIKE 'M%' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY 1 ORDER BY 1\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "How to filter",
    "body": "- **Retail articles**: `a.CCRefeJOFACM NOT LIKE 'M%'` (in Articulos JOIN)\n- **Wholesale articles**: `a.CCRefeJOFACM LIKE 'M%'`\n- **Wholesale channel** (GC tables): GCAlbaranes, GCFacturas, GCLinAlbarane, GCLinFacturas, CobrosFacturas — these are 100% wholesale\n- **Retail POS** (Ventas/LineasVentas): Filter with `NOT LIKE 'M%'` for pure retail metrics",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "3. SQL Exportaciones table -- Per-store stock totals (faster for bulk)",
    "body": "```sql\nSELECT Tienda, SUM(CCStock) AS total_stock FROM Exportaciones GROUP BY Tienda ORDER BY total_stock DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Field Mapping: VAT-Exclusive Fields",
    "body": "| Table | WITH VAT (con IVA) -- DO NOT USE | WITHOUT VAT (sin IVA) -- USE THIS |\n|-------|----------------------------------|-----------------------------------|\n| **Ventas** | `Total` | **`TotalSI`** (\"Total Sin Impuestos\") |\n| **LineasVentas** | `Total` | **`PrecioNetoSI * Unidades`** (or `TotalSI` if available per line) |\n| **GCFacturas** | `TotalFactura` | **`Base1 + Base2 + Base3`** (sum of tax bases per VAT rate) |\n| **GCAlbaranes** | `TotalAlbaran` | **`Base1 + Base2 + Base3`** |\n| **PagosVentas** | `ImporteCob` | ImporteCob = con IVA (matches Ventas.Total). For VAT-exclusive payment analysis, JOIN with Ventas.TotalSI or use COUNT for method mix proportions. |\n| **Articulos** | `Precio2Neto` (PVP con IVA) | **`PrecioCoste`** (already without VAT). For net selling prices use `PrecioNetoSI` in LineasVentas. |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 2: Identify active season/collection",
    "body": "```sql\nSELECT RegTemporada, Clave, TemporadaTipo, TemporadaActiv, InicioVentas, FinVentas\nFROM CCOPTempTipo\nWHERE TemporadaActiv = TRUE\n```\n\nAlso get article counts per season:\n\n```sql\nSELECT ClaveTemporada, COUNT(RegArticulo) as cnt\nFROM Articulos\nGROUP BY ClaveTemporada\nORDER BY COUNT(RegArticulo) DESC\n```\n\nAnd stock per season:\n\n```sql\nSELECT a.ClaveTemporada, SUM(cs.Stock) AS stock_uds, COUNT(a.RegArticulo) AS n_arts\nFROM Articulos a\nINNER JOIN CCStock cs ON cs.NumArticulo = a.RegArticulo\nGROUP BY a.ClaveTemporada\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 3: Sales overview (YTD current year + comparison year)",
    "body": "**Total KPIs** (run for both current and previous year date ranges):\n\n```sql\n-- YTD current year (use TotalSI = sin IVA)\nSELECT COUNT(RegVentas), SUM(TotalSI)\nFROM Ventas\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}'\n\n-- Same period last year\nSELECT COUNT(RegVentas), SUM(TotalSI)\nFROM Ventas\nWHERE FechaCreacion >= '{last_year_start}' AND FechaCreacion <= '{last_year_end}'\n\n-- Total units (from LineasVentas, same date filter)\nSELECT SUM(Unidades)\nFROM LineasVentas\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}'\n\n-- Average ticket (sin IVA)\nSELECT AVG(TotalSI) FROM Ventas\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 4: Weekly sales trend (last 12 weeks)",
    "body": "Run a query per week or use a loop:\n\n```sql\nSELECT COUNT(RegVentas), SUM(TotalSI), SUM(Unidades)\nFROM Ventas\nWHERE FechaCreacion >= '{week_start}' AND FechaCreacion < '{week_end}'\n```\n\nIterate over 12 weeks backwards from today. Store results for the sparkline/chart.",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 5: Per-store performance",
    "body": "```sql\n-- YTD current year by store (sin IVA)\nSELECT Tienda, COUNT(RegVentas) AS cnt, SUM(TotalSI) AS tot\nFROM Ventas\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}'\nGROUP BY Tienda\nORDER BY SUM(TotalSI) DESC\n\n-- Same period last year by store (for YoY comparison, sin IVA)\nSELECT Tienda, COUNT(RegVentas) AS cnt, SUM(TotalSI) AS tot\nFROM Ventas\nWHERE FechaCreacion >= '{last_year_start}' AND FechaCreacion <= '{last_year_end}'\nGROUP BY Tienda\n```\n\nGet store names separately:\n\n```sql\nSELECT Codigo, Poblacion, Provincia FROM Tiendas ORDER BY Codigo\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 6: Product performance",
    "body": "**Important**: Product tables must show `CCRefeJOFACM` (Referencia) as the primary SKU identifier, displayed as \"Ref.\" column. This is what staff and business users recognise. `Codigo` may appear as a secondary column or be omitted. Since `LineasVentas` does not have `CCRefeJOFACM`, always JOIN with `Articulos` to get the Referencia.\n\n**Top articles by revenue and units**:\n\n```sql\nSELECT a.CCRefeJOFACM, lv.Codigo, lv.Descripcion, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.CCRefeJOFACM, lv.Codigo, lv.Descripcion\nORDER BY SUM(lv.PrecioNetoSI * lv.Unidades) DESC\nLIMIT 25\n```\n\n**By family (FamiGrupSeri)**:\n\n```sql\nSELECT a.FamiGrupSeri, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.FamiGrupSeri\nORDER BY SUM(lv.PrecioNetoSI * lv.Unidades) DESC\n```\n\n**By department (DepaSeccFabr)**:\n\n```sql\nSELECT a.DepaSeccFabr, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.DepaSeccFabr\nORDER BY SUM(lv.PrecioNetoSI * lv.Unidades) DESC\n```\n\n**By color**:\n\n```sql\nSELECT a.Color, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.Color\nORDER BY SUM(lv.PrecioNetoSI * lv.Unidades) DESC\n```\n\n**By size (talla)**:\n\n```sql\nSELECT lv.CCOPTallaOjo, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY lv.CCOPTallaOjo\nORDER BY SUM(lv.Unidades) DESC\n```\n\n**Sales by season of origin** (what season's products are actually selling):\n\n```sql\nSELECT a.ClaveTemporada, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.ClaveTemporada\nORDER BY SUM(lv.PrecioNetoSI * lv.Unidades) DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 7: Pricing and discount analysis",
    "body": "```sql\n-- Average selling price vs PVP\nSELECT AVG(lv.PrecioNetoSI) AS avg_sell, AVG(a.Precio2Neto) AS avg_pvp\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\n\n-- Average discount percentage (revenue sin IVA)\nSELECT AVG(lv.PDescG) AS avg_discount, SUM(lv.PrecioNetoSI * lv.Unidades) AS total_revenue, SUM(lv.Unidades) AS total_units\nFROM LineasVentas lv\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 8: Margin analysis",
    "body": "**By department**:\n\n```sql\nSELECT a.DepaSeccFabr, SUM(lv.PrecioNetoSI * lv.Unidades) AS revenue, SUM(lv.Unidades * a.PrecioCoste) AS cost\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.DepaSeccFabr\n```\n\nMargin = `(revenue - cost) / revenue * 100`\n\n**By family**:\n\n```sql\nSELECT a.FamiGrupSeri, SUM(lv.PrecioNetoSI * lv.Unidades) AS revenue, SUM(lv.Unidades * a.PrecioCoste) AS cost\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.FamiGrupSeri\n```\n\n**By store**:\n\n```sql\nSELECT lv.Tienda, SUM(lv.PrecioNetoSI * lv.Unidades) AS revenue, SUM(lv.Unidades * a.PrecioCoste) AS cost\nFROM LineasVentas lv\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{ytd_start}' AND lv.FechaCreacion <= '{today}'\nGROUP BY lv.Tienda\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 9: Stock analysis (CORRECTED)",
    "body": "**IMPORTANT**: CCStock = central warehouse (store 99) ONLY. Exportaciones = retail stores (store 99 is NOT included). True total = both.\n\nSee [docs/stock-analysis.md](../stock-analysis.md) for full details.\n\n**Central warehouse stock (CCStock = store 99)**:\n\n```sql\nSELECT SUM(Stock) FROM CCStock                    -- net total (includes negatives from returns)\nSELECT SUM(Stock) FROM CCStock WHERE Stock > 0    -- positive stock only\n```\n\n**Retail store stock (Exportaciones = all stores except central)**:\n\n```sql\nSELECT SUM(CCStock) FROM Exportaciones\n```\n\n**Stock value (central only — retail value needs SOAP or Exportaciones join)**:\n\n```sql\n-- PrecioCoste is already VAT-free; Precio2Neto includes VAT (use for PVP reference only)\nSELECT SUM(cs.Stock * a.PrecioCoste) AS stock_cost_value, SUM(cs.Stock * a.Precio2Neto) AS stock_retail_value_inc_vat\nFROM CCStock cs\nINNER JOIN Articulos a ON a.RegArticulo = cs.NumArticulo\n```\n\n> **Note**: `stock_cost_value` (PrecioCoste) is already VAT-exclusive and should be the primary stock valuation metric. `stock_retail_value_inc_vat` (Precio2Neto) includes VAT and is only useful as a PVP reference -- do not mix it with sin-IVA revenue figures.\n\n**Stock by family**:\n\n```sql\nSELECT a.FamiGrupSeri, SUM(cs.Stock) AS uds, SUM(cs.Stock * a.PrecioCoste) AS val_cost\nFROM CCStock cs\nINNER JOIN Articulos a ON a.RegArticulo = cs.NumArticulo\nGROUP BY a.FamiGrupSeri\nORDER BY SUM(cs.Stock) DESC\n```\n\n**Per-store stock (Exportaciones)**:\n\n```sql\nSELECT Tienda, SUM(CCStock) AS total_stock\nFROM Exportaciones\nGROUP BY Tienda\nORDER BY SUM(CCStock) DESC\n```\n\n**Dead stock / overstock** (high stock, zero or low sales):\n\n```sql\n-- Get articles with stock > 50 but low/no recent sales\nSELECT a.CCRefeJOFACM, a.Codigo, a.Descripcion, cs.Stock, a.FamiGrupSeri, a.ClaveTemporada, a.Precio2Neto, a.PrecioCoste\nFROM CCStock cs\nINNER JOIN Articulos a ON a.RegArticulo = cs.NumArticulo\nWHERE cs.Stock > 50\nORDER BY cs.Stock DESC\nLIMIT 30\n```\n\nThen cross-reference with sales data to find articles with stock but no recent sales.\n\n**Lost sales** (high sales velocity, zero stock):\n\nGet top sellers and their stock from CCStock. Articles with high sales and `Stock = 0` are lost sales.\n\n```sql\nSELECT a.CCRefeJOFACM, lv.Codigo, lv.Descripcion, SUM(lv.Unidades) AS uds, SUM(lv.PrecioNetoSI * lv.Unidades) AS tot, cs.Stock\nFROM LineasVentas lv\nINNER JOIN CCStock cs ON cs.NumArticulo = lv.NumArticulo\nINNER JOIN Articulos a ON a.RegArticulo = lv.NumArticulo\nWHERE lv.FechaCreacion >= '{last_30d}' AND lv.FechaCreacion <= '{today}'\nGROUP BY a.CCRefeJOFACM, lv.Codigo, lv.Descripcion, cs.Stock\nORDER BY SUM(lv.Unidades) DESC\nLIMIT 30\n```\n\n**Per-store stock for specific articles** (SOAP):\n\n```python\nfrom zeep import Client\nimport json\nclient = Client('http://YOUR_4D_SERVER_IP:8080/4DWSDL')\ncodes = ['144880', '144588', '144844']  # top seller Codigo values\nresult = client.service.WS_JS_StockTiendas(Entrada1=json.dumps(codes))\ndata = json.loads(result.Salida2)",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 10: Customer analysis",
    "body": "```sql\n-- Identified customers (with NumCliente > 0) in period\nSELECT COUNT(DISTINCT NumCliente)\nFROM Ventas\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}' AND NumCliente > 0\n\n-- Total customers in database\nSELECT COUNT(RegCliente) FROM Clientes\n\n-- New customers (by FechaCreacion in Clientes)\nSELECT COUNT(RegCliente)\nFROM Clientes\nWHERE FechaCreacion >= '{ytd_start}' AND FechaCreacion <= '{today}'\n\n-- Customer frequency and concentration\nSELECT v.NumCliente, SUM(v.TotalSI) AS tot, COUNT(v.RegVentas) AS txn\nFROM Ventas v\nWHERE v.FechaCreacion >= '{ytd_start}' AND v.FechaCreacion <= '{today}' AND v.NumCliente > 0\nGROUP BY v.NumCliente\nORDER BY SUM(v.TotalSI) DESC\n\n-- Frequency distribution\nSELECT v.NumCliente, COUNT(v.RegVentas) AS purchases\nFROM Ventas v\nWHERE v.FechaCreacion >= '{ytd_start}' AND v.FechaCreacion <= '{today}' AND v.NumCliente > 0\nGROUP BY v.NumCliente\n```\n\nFrom the frequency data, compute: 1-purchase, 2-3 purchases, 4+ purchases buckets. Also compute top-10% concentration (top 10% of customers = X% of revenue).",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 11: Wholesale channel",
    "body": "```sql\n-- Invoices YTD (sin IVA: sum of tax bases)\nSELECT COUNT(RegFactura), SUM(Base1 + Base2 + Base3) AS tot_si\nFROM GCFacturas\nWHERE FechaFactura >= '{ytd_start}' AND FechaFactura <= '{today}'\n\n-- Previous year comparison (sin IVA)\nSELECT COUNT(RegFactura), SUM(Base1 + Base2 + Base3) AS tot_si\nFROM GCFacturas\nWHERE FechaFactura >= '{last_year_start}' AND FechaFactura <= '{last_year_end}'\n\n-- Delivery notes\nSELECT COUNT(RegAlbaran), SUM(BaseImponible)\nFROM GCAlbaranes\nWHERE FechaEnvio >= '{ytd_start}' AND FechaEnvio <= '{today}'\n\n-- Collections\nSELECT COUNT(RegCobro), SUM(ImporteCobro)\nFROM CobrosFacturas\nWHERE Fecha >= '{ytd_start}' AND Fecha <= '{today}'\n\n-- Also get previous year collections\nSELECT SUM(ImporteCobro)\nFROM CobrosFacturas\nWHERE Fecha >= '{last_year_start}' AND Fecha <= '{last_year_end}'\n\n-- Recent orders\nSELECT RegPedido, NPedido, FechaPedido, Cliente, BaseE\nFROM GCPedidos\nORDER BY RegPedido DESC\nLIMIT 10\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 12: Payment methods",
    "body": "```sql\n-- NOTE: ImporteCob includes VAT (matches Ventas.Total). Use COUNT for method mix\n-- proportions, or JOIN with Ventas.TotalSI for VAT-exclusive revenue by payment method.\nSELECT pv.Forma, COUNT(pv.RegPagos) AS cnt, SUM(pv.ImporteCob) AS tot_inc_vat\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '{ytd_start}' AND pv.FechaCreacion <= '{today}'\nGROUP BY pv.Forma\nORDER BY COUNT(pv.RegPagos) DESC\n```\n\nMap `Forma` codes to names using FormasPago table or hardcoded: 1=Metalico(cash), 2=Tarjeta(card), 3=Vales, etc.\n\n**Cash vs card by store** (use COUNT for proportions -- ImporteCob includes VAT):\n\n```sql\nSELECT pv.Tienda, pv.Forma, COUNT(pv.RegPagos) AS cnt\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '{ytd_start}' AND pv.FechaCreacion <= '{today}'\nGROUP BY pv.Tienda, pv.Forma\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Step 13: Transfers/logistics",
    "body": "```sql\nSELECT COUNT(RegTraspaso), SUM(UnidadesS)\nFROM Traspasos\nWHERE FechaTraspaso >= '{ytd_start}' AND FechaTraspaso <= '{today}'\n\n-- Transfer routes\nSELECT TiendaSalida, TiendaEntrada, SUM(UnidadesS) AS uds\nFROM Traspasos\nWHERE FechaTraspaso >= '{ytd_start}' AND FechaTraspaso <= '{today}'\nGROUP BY TiendaSalida, TiendaEntrada\nORDER BY SUM(UnidadesS) DESC\nLIMIT 15\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Report Structure",
    "body": "The HTML file has these sections in order:\n\n1. **Header**: Brand name, report title, date range, generation timestamp\n2. **Resumen Ejecutivo**: 8 KPI cards (revenue, transactions, units, avg ticket, active stores, active customers, wholesale revenue, margin) + 2-3 insight boxes (green=good, amber=warning, red=alert)\n3. **Para la Dirección**: Monthly trends bar chart (CSS-based), department distribution bars, key business ratios table, sales by season table, business insights\n4. **Análisis de Ventas por Tienda**: Full store table (store code, city, transactions, revenue, YoY change%, avg ticket, margin%) with heatmap coloring. Closed stores note.\n5. **Análisis de Producto**: Top 15 articles table, top families bar chart, top colors chart, margin by family table, size distribution\n6. **Para el Responsable de Stock y Compras**: 6 stock KPI cards, stock by store table (Exportaciones), lost sales table (sold well but zero stock), dead stock table (high stock low sales)\n7. **Análisis de Clientes**: 4 customer KPIs, frequency segmentation, concentration analysis\n8. **Canal Mayorista**: 4 wholesale KPIs, insight on YoY trend, recent orders table\n9. **Medios de Pago**: Payment method breakdown with bars, cash vs card by store\n10. **Traspasos y Logística**: Transfer volume and top routes\n11. **10 Acciones Inmediatas -- Dirección**: Numbered action items, each with specific numbers and expected impact\n12. **10 Acciones Inmediatas -- Stock y Compras**: Same format, stock-focused\n13. **Tendencia Semanal**: 12-week sparkline/bar chart\n14. **Footer**: Generation timestamp, data source, disclaimer\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/skills/report-generation.md",
    "heading": "Gotchas and Data Quality Notes",
    "body": "1. **Always use VAT-exclusive (sin IVA) fields**: `Ventas.TotalSI` not `Total`, `LineasVentas.PrecioNetoSI * Unidades` not `Total`, `GCFacturas.(Base1+Base2+Base3)` not `TotalFactura`. VAT rates differ by region (23% PT mainland, 22% Madeira, 21% Spain) and including VAT distorts cross-store comparisons and inflates revenue.\n2. **FechaCreacion vs FechaDocumento**: Use `FechaCreacion` for date filtering -- `FechaDocumento` is often NULL in Ventas.\n3. **Bags (BOLSA)**: Exclude or separate bags from apparel analysis -- they distort unit counts (high volume, near-zero revenue).\n4. **Store 99**: Central warehouse, not a retail store. Exclude from retail store rankings.\n5. **Store 97**: Online store. May have different patterns.\n6. **Negative units**: Can appear in LineasVentas (returns). SUM handles this correctly.\n7. **Float PKs**: `RegArticulo`, `RegVentas` etc. are Real (float) with `.99` suffix -- don't compare with `=` on computed values.\n8. **Exportaciones for stock**: The table with 2M+ rows -- use `CAST(Tienda AS INT)` and `CCStock <> 0` for filtering.\n9. **SOAP stock**: `WS_JS_StockTiendas` input must be `Articulos.Codigo` (text codes like \"144880\"), NOT RegArticulo.\n10. **p4d type 0 columns**: Always specify columns explicitly. Never `SELECT *` on wide tables.\n11. **Bytes in results**: Text fields may return `bytes` -- always `.decode('utf-8', errors='replace')`.\n12. **Connection timeout**: The 4D SQL server may be slow on large JOINs. Use LIMIT and batch queries.\n13. **Spanish number formatting**: Use `.` for thousands, `,` for decimals (e.g., `1.234,56 €`).\n14. **All currency is EUR** -- never use `$` or USD.\n15. **PagosVentas.ImporteEnt vs ImporteCob**: `ImporteEnt` = \"Importe Entregado\" (physical amount handed over by customer, e.g., a 20 EUR bill). NOT useful for analytics. `ImporteCob` = \"Importe Cobrado\" (actual charge). Always use `ImporteCob` for payment analysis, or `Ventas.TotalSI` for VAT-exclusive revenue. ~33 \"Devolucion Vale\" records have a POS bug in ImporteEnt -- ignore it, no data needs fixing.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Table of Contents",
    "body": "1. [Stock Model Overview](#1-stock-model-overview)\n2. [CCStock -- Central Warehouse (Store 99)](#2-ccstock--central-warehouse)\n3. [Exportaciones -- Retail Store Stock](#3-exportaciones--retail-store-stock)\n4. [Total Stock Calculation](#4-total-stock-calculation)\n5. [Stock Movement Formula (VFP)](#5-stock-movement-formula-vfp)\n6. [Transfers (Traspasos)](#6-transfers-traspasos)\n7. [Returns via GCAlbaranes](#7-returns-via-gcalbaranes)\n8. [Negative Stock](#8-negative-stock)\n9. [SOAP Web Service: WS_JS_StockTiendas](#9-soap-web-service-ws_js_stocktiendas)\n10. [Inventory Snapshots](#10-inventory-snapshots)\n11. [Common Stock Queries](#11-common-stock-queries)\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "1. Stock Model Overview",
    "body": "PowerShop uses a **dual-table model** for stock:\n\n```\n                    +-------------------+\n                    |    Articulos      |\n                    | (product master)  |\n                    | Stock = aggregate |\n                    +--------+----------+\n                             |\n              +--------------+--------------+\n              |                             |\n    +---------v---------+     +-------------v-----------+\n    |     CCStock        |     |     Exportaciones        |\n    | (store 99/central) |     | (all retail stores)      |\n    | 1 row per product  |     | 1 row per product/store  |\n    | ~41,222 rows       |     | ~2,056,000 rows          |\n    +--------------------+     +--------------------------+\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Key Rules",
    "body": "1. **CCStock** holds stock for **store 99** (the central warehouse). One row per product.\n2. **Exportaciones** holds stock for **all retail stores**. One row per product per store.\n3. **Store 99 never appears in Exportaciones.**\n4. **Articulos.Stock** is a denormalized aggregate of CCStock + all Exportaciones rows for that product.\n5. Both tables use a **wide format**: up to 34 size slots per row (Stock1..Stock34, Talla1..Talla34).\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Central stock",
    "body": "cur.execute(\"\"\"\n    SELECT cs.Stock\n    FROM CCStock cs\n    INNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\n    WHERE a.Codigo = '12345'\n\"\"\")\ncentral = cur.fetchone()[0] or 0",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Store stock",
    "body": "cur.execute(\"\"\"\n    SELECT SUM(e.STStock)\n    FROM Exportaciones e\n    WHERE e.Codigo = '12345'\n\"\"\")\nstores = cur.fetchone()[0] or 0\n\ntotal = central + stores\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Central per-size",
    "body": "cur.execute(\"\"\"\n    SELECT cs.Talla1, cs.Stock1, cs.Talla2, cs.Stock2,\n           cs.Talla3, cs.Stock3, cs.Talla4, cs.Stock4,\n           cs.Talla5, cs.Stock5, cs.Talla6, cs.Stock6\n    FROM CCStock cs\n    INNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\n    WHERE a.Codigo = '12345'\n\"\"\")\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Querying Transfers",
    "body": "```sql\n-- All transfers INTO store 104 in January 2025\nSELECT Documento, Codigo, Descripcion, Talla,\n       UnidadesE, FechaE, Tipo, Concepto\nFROM Traspasos\nWHERE TiendaEntrada = '104'\n  AND FechaE >= '2025-01-01'\n  AND FechaE <= '2025-01-31'\n  AND Entrada = TRUE\nORDER BY FechaE\n\n-- All transfers OUT OF store 104\nSELECT Documento, Codigo, Descripcion, Talla,\n       UnidadesS, FechaS, TiendaEntrada, Tipo\nFROM Traspasos\nWHERE TiendaSalida = '104'\n  AND FechaS >= '2025-01-01'\n  AND Entrada = FALSE\nORDER BY FechaS\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Transfer Volume Analysis",
    "body": "```sql\n-- Monthly transfer volume by route\nSELECT TiendaSalida, TiendaEntrada,\n       YEAR(FechaS) AS yr, MONTH(FechaS) AS mo,\n       COUNT(*) AS num_transfers,\n       SUM(UnidadesS) AS total_units\nFROM Traspasos\nWHERE FechaS >= '2025-01-01'\n  AND Entrada = FALSE\nGROUP BY TiendaSalida, TiendaEntrada, YEAR(FechaS), MONTH(FechaS)\nORDER BY total_units DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Querying Returns",
    "body": "```sql\n-- Wholesale returns by customer\nSELECT ga.Cliente,\n       COUNT(*) AS num_returns,\n       SUM(ga.TotalAlbaran) AS total_returned,\n       SUM(ga.Unidades) AS units_returned\nFROM GCAlbaranes ga\nWHERE ga.Abono = TRUE\n  AND ga.FechaEnvio >= '2025-01-01'\nGROUP BY ga.Cliente\nORDER BY total_returned DESC\n\n-- Return detail lines\nSELECT gl.NAlbaran, gl.Codigo, gl.Descripcion,\n       gl.Unidades, gl.Total, gl.FechaAlbaran\nFROM GCLinAlbarane gl\nWHERE gl.Abono = TRUE\n  AND gl.FechaAlbaran >= '2025-01-01'\nORDER BY gl.FechaAlbaran DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Retail Returns",
    "body": "Retail returns are tracked in `LineasVentas` with `Entrada = False`:\n\n```sql\nSELECT lv.Tienda, lv.Codigo, lv.Descripcion,\n       lv.Unidades, lv.Total, lv.FechaCreacion,\n       lv.MotivoDevolucion\nFROM LineasVentas lv\nWHERE lv.Entrada = FALSE\n  AND lv.Mes = 202501\nORDER BY lv.FechaCreacion DESC\nLIMIT 50\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Finding Negative Stock",
    "body": "```sql\n-- Products with negative total stock\nSELECT a.Codigo, a.Descripcion, a.Stock\nFROM Articulos a\nWHERE a.Stock < 0\n  AND a.Anulado = FALSE\nORDER BY a.Stock ASC\nLIMIT 20\n\n-- Per-store negative stock\nSELECT e.Tienda, e.Codigo, e.STStock\nFROM Exportaciones e\nWHERE e.STStock < 0\nORDER BY e.STStock ASC\nLIMIT 20\n\n-- Central negative stock per size\nSELECT a.Codigo, cs.Talla1, cs.Stock1, cs.Talla2, cs.Stock2,\n       cs.Talla3, cs.Stock3\nFROM CCStock cs\nINNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\nWHERE cs.Stock1 < 0 OR cs.Stock2 < 0 OR cs.Stock3 < 0\nLIMIT 20\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "When to Use the Web Service vs SQL",
    "body": "| Approach | Use When |\n|----------|----------|\n| SQL (CCStock + Exportaciones) | Bulk stock analysis, reporting, data export |\n| SOAP WS_JS_StockTiendas | Real-time single-product stock check, integration |\n\nThe SOAP service returns the same data as querying CCStock + Exportaciones but in a single call with real-time values.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Building Your Own Snapshots",
    "body": "Since no historical stock snapshots exist in the database, you can build them by periodically querying current stock:\n\n```python\nimport datetime\n\ndef snapshot_stock(cur, snapshot_date=None):\n    \"\"\"Take a stock snapshot of all products across all stores.\"\"\"\n    if snapshot_date is None:\n        snapshot_date = datetime.date.today().isoformat()\n\n    # Central stock\n    cur.execute(\"\"\"\n        SELECT a.Codigo, cs.Stock\n        FROM CCStock cs\n        INNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\n        WHERE a.Anulado = FALSE\n    \"\"\")\n    central = {row[0]: row[1] for row in cur.fetchall()}\n\n    # Per-store stock\n    cur.execute(\"\"\"\n        SELECT e.Tienda, e.Codigo, e.STStock\n        FROM Exportaciones e\n        WHERE e.STStock <> 0\n    \"\"\")\n    store_stock = cur.fetchall()\n\n    return {\n        'date': snapshot_date,\n        'central': central,\n        'stores': store_stock\n    }\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock Value at Central Warehouse",
    "body": "```sql\nSELECT SUM(cs.Stock * a.PrecioCoste) AS stock_value_cost,\n       SUM(cs.Stock * a.Precio1) AS stock_value_pvp,\n       SUM(cs.Stock) AS total_units,\n       COUNT(*) AS product_count\nFROM CCStock cs\nINNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\nWHERE cs.Stock > 0\n  AND a.Anulado = FALSE\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock Value per Store",
    "body": "```sql\nSELECT e.Tienda,\n       COUNT(*) AS products,\n       SUM(e.STStock) AS total_units\nFROM Exportaciones e\nWHERE e.STStock > 0\nGROUP BY e.Tienda\nORDER BY total_units DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Products with Stock Below Minimum",
    "body": "```sql\nSELECT a.Codigo, a.Descripcion,\n       a.Stock, a.StockMinimo,\n       a.StockMinimo - a.Stock AS deficit\nFROM Articulos a\nWHERE a.Stock < a.StockMinimo\n  AND a.StockMinimo > 0\n  AND a.Anulado = FALSE\nORDER BY deficit DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Stock Turnover (Units Sold / Average Stock)",
    "body": "```sql\n-- Units sold per product in a period\nSELECT lv.Codigo,\n       SUM(lv.Unidades) AS units_sold\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\nGROUP BY lv.Codigo\nHAVING SUM(lv.Unidades) > 0\nORDER BY units_sold DESC\nLIMIT 50\n```\n\n*Note: Average stock requires historical snapshots (not available in the database). Use current stock as an approximation or build periodic snapshots.*",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/stock-analysis.md",
    "heading": "Dead Stock (No Sales in 12 Months)",
    "body": "```sql\nSELECT a.Codigo, a.Descripcion, a.Stock,\n       a.FechaModifica AS last_modified\nFROM Articulos a\nWHERE a.Stock > 0\n  AND a.Anulado = FALSE\n  AND a.RegArticulo NOT IN (\n      SELECT DISTINCT lv.NumArticulo\n      FROM LineasVentas lv\n      WHERE lv.Mes >= 202501\n  )\nORDER BY a.Stock DESC\nLIMIT 50\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "1. Overview",
    "body": "PowerShop supports two sales channels within the same database:\n\n| Aspect | Retail (B2C) | Wholesale (B2B) |\n|--------|-------------|-----------------|\n| **Tables** | Ventas, LineasVentas, PagosVentas | GCAlbaranes, GCLinAlbarane, GCFacturas, GCLinFacturas |\n| **Document flow** | Ticket -> (optional Invoice) | Order -> Delivery Note -> Invoice -> Collection |\n| **Product codes** | Standard codes (no prefix) | Often M-prefixed codes |\n| **Customers** | Clientes where Mayorista=False | Clientes where Mayorista=True |\n| **Payments** | PagosVentas (ImporteCob) | CobrosFacturas (Importe) |\n| **Pricing** | PVP (Precio1, with VAT) | Net prices (negotiated, often without VAT) |\n| **Stock source** | Exportaciones (retail stores) | CCStock (central warehouse) |\n| **Rows** | ~910K sales, ~1.69M lines | ~49K delivery notes, ~1.01M lines |\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Key Queries",
    "body": "```sql\n-- Total retail revenue (excluding returns)\nSELECT SUM(Total) AS retail_revenue\nFROM Ventas\nWHERE FechaCreacion >= '2025-01-01'\n  AND Entrada = TRUE\n\n-- Retail revenue from non-M products only\nSELECT SUM(lv.Total) AS pure_retail\nFROM LineasVentas lv\nWHERE lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\n  AND lv.Codigo NOT LIKE 'M%'\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Key Queries",
    "body": "```sql\n-- Total wholesale revenue (from invoices, excluding credit notes)\nSELECT SUM(TotalFactura) AS wholesale_revenue\nFROM GCFacturas\nWHERE FechaFactura >= '2025-01-01'\n  AND Abono = FALSE\n  AND FacturaAnulada = FALSE\n\n-- Wholesale revenue from delivery notes\nSELECT SUM(TotalAlbaran) AS ws_delivery_revenue\nFROM GCAlbaranes\nWHERE FechaEnvio >= '2025-01-01'\n  AND Abono = FALSE\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Flow of Stock",
    "body": "```\nSupplier\n  -> Albaranes (purchase receipt) -> CCStock (central)\n      -> Traspasos -> Exportaciones (retail stores)\n      -> GCAlbaranes -> Customer (wholesale shipment)\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Stock by Channel Query",
    "body": "```sql\n-- Central warehouse stock (serves wholesale)\nSELECT SUM(Stock) AS central_stock\nFROM CCStock\nWHERE Stock > 0\n\n-- Retail store stock\nSELECT SUM(STStock) AS retail_stock\nFROM Exportaciones\nWHERE STStock > 0\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Products Available per Channel",
    "body": "```sql\n-- Products with central stock (potential wholesale)\nSELECT COUNT(DISTINCT a.Codigo)\nFROM CCStock cs\nINNER JOIN Articulos a ON cs.NumArticulo = a.RegArticulo\nWHERE cs.Stock > 0\n\n-- Products with store stock (retail)\nSELECT COUNT(DISTINCT Codigo)\nFROM Exportaciones\nWHERE STStock > 0\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Identification",
    "body": "```sql\n-- Wholesale customers\nSELECT COUNT(*) FROM Clientes WHERE Mayorista = TRUE AND Anulado = FALSE\n\n-- Retail customers\nSELECT COUNT(*) FROM Clientes WHERE Mayorista = FALSE AND Anulado = FALSE\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Cross-Channel Customers",
    "body": "Some customers may appear in both channels:\n\n```sql\n-- Customers that appear in both retail and wholesale\nSELECT c.Codigo, c.Cliente\nFROM Clientes c\nWHERE c.RegCliente IN (\n    SELECT DISTINCT NumCliente FROM Ventas WHERE NumCliente > 0\n)\nAND c.RegCliente IN (\n    SELECT DISTINCT NumCliente FROM GCAlbaranes\n)\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Retail Payments",
    "body": "Tracked in `PagosVentas`:\n\n| Field | Description |\n|-------|-------------|\n| ImporteEnt | Amount tendered |\n| ImporteCob | Amount collected (**use this for revenue**) |\n| CodigoForma | Payment method code |\n| Forma | Payment method name |\n\n```sql\n-- Retail payment breakdown\nSELECT pv.Forma,\n       SUM(pv.ImporteCob) AS collected\nFROM PagosVentas pv\nWHERE pv.FechaCreacion >= '2025-01-01'\n  AND pv.Entrada = TRUE\nGROUP BY pv.Forma\nORDER BY collected DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Wholesale Payments",
    "body": "Tracked in `CobrosFacturas`:\n\n| Field | Description |\n|-------|-------------|\n| Importe | Payment amount |\n| Fecha | Payment date |\n| Forma | Payment method |\n| Pagado | Fully paid flag |\n| NumFactura | FK -> GCFacturas |\n\n```sql\n-- Wholesale collection summary\nSELECT cf.Forma,\n       COUNT(*) AS payments,\n       SUM(cf.Importe) AS collected\nFROM CobrosFacturas cf\nWHERE cf.Fecha >= '2025-01-01'\nGROUP BY cf.Forma\nORDER BY collected DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Outstanding Wholesale Receivables",
    "body": "```sql\n-- Unpaid wholesale invoices\nSELECT gf.NFactura, gf.Cliente, gf.FechaFactura,\n       gf.TotalFactura,\n       COALESCE(SUM(cf.Importe), 0) AS paid,\n       gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) AS outstanding\nFROM GCFacturas gf\nLEFT OUTER JOIN CobrosFacturas cf ON gf.RegFactura = cf.NumFactura\nWHERE gf.Abono = FALSE\n  AND gf.FacturaAnulada = FALSE\nGROUP BY gf.NFactura, gf.Cliente, gf.FechaFactura, gf.TotalFactura\nHAVING gf.TotalFactura - COALESCE(SUM(cf.Importe), 0) > 0\nORDER BY outstanding DESC\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Revenue Reports",
    "body": "When building revenue reports, be clear about which channel:\n\n| Report Type | Source | Filters |\n|------------|--------|---------|\n| Retail revenue | Ventas.Total or SUM(LineasVentas.Total) | Entrada=True |\n| Wholesale revenue | SUM(GCFacturas.TotalFactura) | Abono=False, FacturaAnulada=False |\n| Total revenue | Sum of both | Combine in Python |\n| Pure retail | LineasVentas | Entrada=True AND Codigo NOT LIKE 'M%' |\n| Pure wholesale | GCLinFacturas | Standard query |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "4. Customer Count",
    "body": "Some customers exist in Clientes but have never transacted. Always join to transaction tables for \"active customer\" counts:\n\n```sql\n-- Active retail customers (with purchases)\nSELECT COUNT(DISTINCT NumCliente)\nFROM Ventas\nWHERE NumCliente > 0\n  AND FechaCreacion >= '2025-01-01'\n  AND Entrada = TRUE\n\n-- Active wholesale customers\nSELECT COUNT(DISTINCT NumCliente)\nFROM GCAlbaranes\nWHERE FechaEnvio >= '2025-01-01'\n  AND Abono = FALSE\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "5. Store 99 in Reports",
    "body": "Store 99 is the central warehouse. It should typically be **excluded** from retail store performance reports:\n\n```sql\n-- Retail store performance (exclude central)\nSELECT lv.Tienda, SUM(lv.Total) AS revenue\nFROM LineasVentas lv\nWHERE lv.Tienda <> '99'\n  AND lv.Mes BETWEEN 202501 AND 202512\n  AND lv.Entrada = TRUE\nGROUP BY lv.Tienda\nORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/wholesale-retail-split.md",
    "heading": "Summary Decision Tree",
    "body": "```\nQ: What channel is this data from?\n|\n+-- Table starts with \"GC\"? -> Wholesale\n|   (GCAlbaranes, GCLinAlbarane, GCFacturas, GCLinFacturas)\n|\n+-- Table is Ventas/LineasVentas/PagosVentas? -> Retail (POS)\n|\n+-- Table is Articulos/CCStock/Exportaciones? -> Both channels\n|   (Filter by Codigo LIKE/NOT LIKE 'M%' if needed)\n|\n+-- Table is Clientes? -> Both channels\n|   (Filter by Mayorista = True/False)\n|\n+-- Table is CobrosFacturas? -> Wholesale payments\n|\n+-- Table is Traspasos? -> Stock operations (supports both)\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "Schema Sources",
    "body": "| Source | Method | Value |\n|--------|--------|-------|\n| `_USER_TABLES` / `_USER_COLUMNS` | SQL query via p4d | Table/column names, types, nullability |\n| `_USER_VIEWS` | SQL query via p4d | 100 SQL views (50+50 BI) — vendor's intended query patterns |\n| `_USER_IND_COLUMNS` | SQL query via p4d | Indexed columns per table — confirms access patterns |\n| `PowerShop.4DC` strings | `strings -n 5` on 360 MB compiled binary | 5.7M string lines — table/field/method names, form structures |\n| SQL views (`*_SQL`) | Direct `SELECT * FROM <view> LIMIT 1` | Exact column lists for all analytics-relevant views |\n| SOAP WSDL | zeep introspection | 130 WS_JS_* + 934 WS_* method signatures |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "Key Tables Summary",
    "body": "| Table | Rows | Cols | Domain | Description |\n|-------|------|------|--------|-------------|\n| Articulos | ~41,220 | 372 | Products | Product master catalog |\n| CCStock | ~41,222 | 582 | Stock | Central warehouse stock (store 99) per size |\n| Exportaciones | ~2,056,000 | 161 | Stock | Retail store stock per size per store |\n| Ventas | ~910,726 | 145 | Retail Sales | POS ticket headers |\n| LineasVentas | ~1,687,995 | 154 | Retail Sales | POS ticket line items |\n| PagosVentas | ~964,039 | 49 | Retail Sales | POS payment records |\n| GCAlbaranes | ~48,882 | 161 | Wholesale | Wholesale delivery notes |\n| GCLinAlbarane | ~1,014,995 | 138 | Wholesale | Wholesale delivery note lines |\n| GCFacturas | ~18,060 | 183 | Wholesale | Wholesale invoices |\n| GCLinFacturas | ~974,742 | 63 | Wholesale | Wholesale invoice lines |\n| Clientes | ~27,545 | 308 | Customers | Customer master (retail + wholesale) |\n| Traspasos | ~262,689 | 29 | Stock/Logistics | Inter-store stock transfers |\n| Compras | ~2,697 | 129 | Purchasing | Purchase orders |\n| Proveedores | ~518 | 114 | Purchasing | Supplier master |\n| Tiendas | ~51 | 207 | Stores | Store/warehouse master |\n| FamiGrupMarc | ~77 | 112 | Lookups | Family/group classification |\n| Cajas | ~42,504 | 270 | Retail Sales | Cash register sessions |\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "1. All tables and column metadata",
    "body": "cur.execute(\"SELECT TABLE_NAME, COLUMN_NAME, TYPE_NAME, IS_NULLABLE FROM _USER_COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION\")\nrows = cur.fetchall()\nby_table = {}\nfor r in rows:\n    by_table.setdefault(r[0], []).append(r[1])\njson.dump(by_table, open('/tmp/4d_all_columns.json', 'w'))",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "2. All SQL views",
    "body": "cur.execute(\"SELECT TABLE_NAME FROM _USER_VIEWS ORDER BY TABLE_NAME\")\nviews = [r[0] for r in cur.fetchall()]",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "3. All indexed columns",
    "body": "cur.execute(\"SELECT TABLE_NAME, COLUMN_NAME, INDEX_NAME FROM _USER_IND_COLUMNS ORDER BY TABLE_NAME\")\nrows = cur.fetchall()\njson.dump(rows, open('/tmp/4d_index_columns.json', 'w'))",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "4. FK/PK constraints",
    "body": "cur.execute(\"SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM _USER_CONS_COLUMNS ORDER BY TABLE_NAME\")\nrows = cur.fetchall()\njson.dump(rows, open('/tmp/4d_cons_columns.json', 'w'))\n```\n\n```python",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "What Was Discovered vs. What Was Already Known",
    "body": "| Finding | Was documented | Correction/addition |\n|---------|---------------|---------------------|\n| Exportaciones has 34 stock slots | Partially (17 slots) | **Corrected** to 34 (Stock1-34, Talla1-34) |\n| SQL views (_USER_VIEWS) exist | No | **New**: 100 views — 50 *_SQL + 50 *_BI |\n| FamiGrupMarc.SerieTallas | Expected to contain size series | **Confirmed blank** in all 78 production rows |\n| GCLinPedidos has 5-dim × 34-slot matrix | Partially | **Corrected**: Pedidas/Entregadas/Asignadas/Original all × 34 |\n| Ventas has TBAI, SAF-T, Aena, marketplace fields | Not documented | **New**: 30+ fiscal/channel fields added |\n| Tiendas has 208 columns | Not detailed | **New**: 11 field groups, AENA_*, CON*, groupings documented |\n| FormasPago has VP1-12 installment slots | Not detailed | **New**: full 30-column breakdown documented |\n| Clientes has Mayorista, B2B provisional, GDPR, optical measurement fields | Partially | **New**: confirmed + 15 field groups documented |\n| FamiGrupMarc has CATAdidas/CATNike brand integration fields | No | **New**: Adidas data feed and Nike catalog mapping |\n| 130 WS_JS_* SOAP methods exist | Partially (some known) | **New**: full WSDL enumeration of all signatures |\n| 88 FK relationships confirmed | Partial guess | **Confirmed** from _USER_CONS_COLUMNS |",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "2. Re-query live 4D server (needs network access to 10.0.1.35)",
    "body": "/Users/alobato/git/powershop-analytics/.venv/bin/python3 -c \"\nimport p4d, json\nconn = p4d.connect(host='10.0.1.35', port=19812, user='Administrador', password='')\ncur = conn.cursor()\ncur.execute('SELECT TABLE_NAME, COLUMN_NAME FROM _USER_COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION')\nrows = cur.fetchall()\nby_table = {}\nfor r in rows:\n    by_table.setdefault(r[0], []).append(r[1])\njson.dump(by_table, open('/tmp/4d_all_columns.json', 'w'))\nprint('Done:', len(by_table), 'tables')\n\"",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "Exportaciones -- Retail Store Stock (~2,056,001 rows, 161 columns)",
    "body": "One row per product per store. Same wide-format as CCStock but per retail location. Store 99 (central) does NOT appear here; it is in CCStock.\n\n| Column Pattern | Type | Description |\n|----------------|------|-------------|\n| Codigo | Alpha(60) | Product code |\n| Descripcion | Alpha(160) | Product description |\n| Tienda | Alpha(8) | Store code |\n| TiendaCodigo | Alpha(80) | Composite store+code key |\n| CCStock | Real | FK -> CCStock record |\n| STStock | Real | Aggregate stock for this store |\n| Stock1..Stock34 | Integer | Stock per size slot |\n| Talla1..Talla34 | Alpha(10) | Size labels |\n| Minimo1..Minimo34 | Integer | Minimum stock per size |\n| REPPorcentaje | Real | Replenishment percentage |\n| REPPorcentaje1..34 | Integer | Replenishment % per size |\n| Ubicacion1..3 | Alpha(160) | Store location (3 zones) |\n| PuntoPedido | Real | Reorder point |\n| UnidadesReposi | Real | Replenishment units |\n| FechaModifica | Date | Last modification |\n| HoraModifica | Time | Last modification time |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/schema-discovery.md",
    "heading": "LineasVentas -- POS Ticket Lines (~1,687,995 rows, 154 columns)",
    "body": "One row per product on a ticket. Primary source for retail sales analytics.\n\n| Column | Type | Description |\n|--------|------|-------------|\n| RegLineas | Real | PK |\n| NumVentas | Real | FK -> Ventas.RegVentas |\n| NumArticulo | Real | FK -> Articulos.RegArticulo |\n| Codigo | Alpha(60) | Product code (denormalized) |\n| Descripcion | Alpha(160) | Product description (denormalized) |\n| Unidades | Real | Quantity sold |\n| PrecioNeto | Real | Net unit price |\n| PrecioBruto | Real | Gross unit price |\n| PrecioNetoSI | Real | Net price without VAT |\n| PrecioBrutoSI | Real | Gross price without VAT |\n| PrecioOriginal | Real | Original price (before discounts) |\n| PVPTarifa | Real | Price list PVP |\n| Total | Real | Line total (with VAT) |\n| TotalSI | Real | Line total without VAT |\n| TotalBruto | Real | Gross line total |\n| TotalOriginal | Real | Original total |\n| ImporteDescuento | Real | Discount amount |\n| ImporteRebajas | Real | Markdown amount |\n| ImporteRebajasSI | Real | Markdown amount without VAT |\n| PrecioCosteSI | Real | Cost price without VAT |\n| PrecioCosteCI | Real | Cost price with import costs |\n| TotalCosteSI | Real | Total cost without VAT |\n| TotalCosteCI | Real | Total cost with import costs |\n| PIva | Real | VAT percentage |\n| PRE | Real | Surcharge percentage |\n| PDescG | Real | General discount percentage |\n| **Period** | | |\n| FechaCreacion | Date | Sale date |\n| Hora | Time | Sale time |\n| Mes | Long Integer | Period as YYYYMM (e.g., 202501) |\n| NMes | Integer | Month number (1-12) |\n| NDia | Integer | Day number |\n| NSemana | Integer | Week number |\n| DiaSemana | Long Integer | Day of week |\n| **Classification FKs** | | |\n| NumFamilia | Real | FK -> FamiGrupMarc |\n| NumDepartament | Real | FK -> DepaSeccFabr |\n| NumMarca | Real | FK -> CCOPMarcTrat |\n| NumColor | Real | FK -> CCOPColores |\n| NumTemporada | Real | FK -> CCOPTempTipo |\n| NumProveedor | Real | FK -> Proveedores |\n| NumSubfamilia | Real | FK -> SubfamModelo |\n| NumCliente | Real | FK -> Clientes |\n| NFactura | Real | Invoice number |\n| **Location** | | |\n| Tienda | Alpha(8) | Store code |\n| Caja | Alpha(8) | Register code |\n| CodigoCajero | Alpha(20) | Cashier code |\n| CodigoEmpleado | Alpha(40) | Employee code |\n| **Flags** | | |\n| Entrada | Boolean | Is entry (sale=true, return=false) |\n| TipoDocumento | Alpha(20) | Document type |\n| Defectuoso | Boolean | Defective item |\n| ArticuloPropio | Boolean | Own-brand |\n| **Promotions** | | |\n| TipoPromocion | Alpha(10) | Promotion type |\n| NivelPromocion | Alpha(30) | Promotion level |\n| DesPromocion | Alpha(160) | Promotion description |\n| PromocionPorcentaje | Real | Promotion discount % |\n| PromocionImporte | Real | Promotion amount |\n| MotivoDescuento | Alpha(160) | Discount reason |\n| MotivoDevolucion | Alpha(160) | Return reason |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/sql-views.md",
    "heading": "PowerShop 4D SQL Views Reference",
    "body": "> Discovered 2026-04-05 by querying `_USER_VIEWS` on the live 4D server.\n> Views are accessible via the 4D SQL port (19812) using the p4d driver.\n> All view names can be used directly in SQL: `SELECT * FROM Ventas_SQL LIMIT 100`",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sql-views.md",
    "heading": "`*_SQL` Views (Analytics-Recommended)",
    "body": "> Column counts validated 2026-04-05 by querying `SELECT * FROM <view> LIMIT 1` on live server.\n> Views marked **CRASH** cause the p4d driver to abort (contain Picture/Blob type fields).\n\n| View | Columns | Domain | Notes |\n|------|---------|--------|-------|\n| `Ventas_SQL` | **145** | Sales | Full POS ticket headers — TBAI, marketplace, tax-free, Aena fields |\n| `LineasVentas_SQL` | **157** | Sales | POS line items with cost prices |\n| `PagosVentas_SQL` | **49** | Sales | Payment records — PSCARD1-10 card slots |\n| `Cajas_SQL` | CRASH | Sales | Cash register sessions — contains Blob type fields |\n| `Clientes_SQL` | CRASH | Customers | Full customer master — contains Blob type fields |\n| `Exportaciones_SQL` | **161** | Stock | Retail store stock — 34-slot matrix (Stock1-34, Talla1-34, Minimo1-34) |\n| `Articulos_SQL` | CRASH | Products | Full product catalog — contains Picture/Blob fields |\n| `Albaranes_SQL` | **68** | Purchasing | Delivery notes received from suppliers |\n| `LinAlbaranes_SQL` | **108** | Purchasing | Delivery note lines |\n| `Compras_SQL` | **129** | Purchasing | Purchase orders |\n| `LineasCompras_SQL` | **56** | Purchasing | Purchase order lines |\n| `GCAlbaranes_SQL` | **162** | Wholesale | Wholesale delivery notes — tracking, SAFT, maritime expedition fields |\n| `GCLinAlbarane_SQL` | **138** | Wholesale | Wholesale delivery lines — 34 Talla/Entregadas slots |\n| `GCPedidos_SQL` | **123** | Wholesale | Wholesale orders |\n| `GCLinPedidos_SQL` | **239** | Wholesale | Wholesale order lines — 34-slot × 5 qty dimensions (widest view) |\n| `GCFacturas_SQL` | **183** | Wholesale | Wholesale invoices |\n| `GCLinFacturas_SQL` | **63** | Wholesale | Wholesale invoice lines — COSTEUNITARIO, TOTALCOSTE |\n| `GCComerciales_SQL` | **49** | Wholesale | Sales representatives |\n| `GCTransporte_SQL` | **3** | Wholesale | Wholesale transport/carriers (minimal) |\n| `Tiendas_SQL` | **208** | Stores | Full store config — accounting codes, Aena, groupings |\n| `Proveedores_SQL` | **114** | Purchasing | Supplier master |\n| `FamiGrupMarc_SQL` | **112** | Lookups | Product families — SERIETALLAS field (blank in production) |\n| `CCLineasCompr_SQL` | **234** | Stock | Central warehouse purchase reception lines (very wide) |\n| `CCMedTarReg_SQL` | **10** | Customers | Loyalty card registration |\n| `CCOPColores_SQL` | **35** | Lookups | Color master |\n| `CCOPMarcTrat_SQL` | **63** | Lookups | Brand/treatment master |\n| `CCOPTempTipo_SQL` | **75** | Lookups | Season type master |\n| `CCSexos_SQL` | **56** | Lookups | Gender classification |\n| `CCStock_SQL` | ERROR | Stock | Causes p4d error \"Unrecognized 4D type\" — skip entirely |\n| `Traspasos_SQL` | **29** | Logistics | Stock transfers — one row per article/size/store pair |\n| `Paises_SQL` | **10** | Lookups | Country master |\n| `Provincias_SQL` | **3** | Lookups | Province master (minimal) |\n| `RRHHEmpleados_SQL` | **104** | HR | Employee master |\n| `RRHHControlPresencia_SQL` | **30** | HR | Time & attendance |\n| `RRHHBajas_SQL` | **20** | HR | Sick leave |\n| `RRHHAusencias_SQL` | **15** | HR | Absences |\n| `ServicioSO_SQL` | **52** | Service | Service orders (after-sales / repairs) |\n| `SubfamModelo_SQL` | **47** | Lookups | Subfamily/model master |\n| `DepaSeccFabr_SQL` | **76** | Lookups | Department/section/fabrication master |\n| `BalanceoStock_SQL` | **13** | Stock | Stock balancing operations |\n| `BarrasAsociado_SQL` | **10** | Products | Associated barcodes |\n| `AutoReposicion_SQL` | **10** | Stock | Auto-replenishment rules |\n| `InformeReposicion_SQL` | **8** | Stock | Replenishment reports |\n| `LineasInformeReposicion_SQL` | **47** | Stock | Replenishment report lines |\n| `PackQueue_SQL` | **15** | Promotions | Pack promotion queue |\n| `PackStreet_SQL` | **19** | Promotions | Street/in-store packs |\n| `PackVisitors_SQL` | **15** | Promotions | Visitor packs |\n| `ComentariosTickets_SQL` | **34** | Sales | Ticket comments |\n| `CRMDetalleCue_SQL` | **17** | CRM | CRM survey details |\n| `Deta",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/sql-views.md",
    "heading": "Query a view with specific columns (recommended — avoids crash on Picture/Blob types)",
    "body": "cur.execute(\"\"\"\n    SELECT REGVENTAS, FECHACREACION, TIENDA, TOTALSI, NUMCLIENTE, MARKETPLACE\n    FROM Ventas_SQL\n    WHERE FECHACREACION >= '2025-01-01' AND ENTRADA = TRUE\n    LIMIT 100\n\"\"\")\nrows = cur.fetchall()\n```\n\n**Important notes:**\n- `CCStock_SQL` crashes the p4d driver — never query it. Use individual columns from `CCStock` directly.\n- Very wide tables (Articulos_SQL, Exportaciones_SQL, Clientes_SQL) may crash if fetching ALL columns.\n  Always specify the columns you need.\n- `BORRAR*` columns in Exportaciones are legacy/deprecated — ignore them.\n- `LIBRE*` columns are generic free-text fields with variable business use per installation.\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Table of Contents",
    "body": "1. [Naming Conventions](#naming-conventions)\n2. [Primary Key Pattern (.99 Suffix)](#primary-key-pattern)\n3. [Articulos -- Product Master](#articulos)\n4. [Ventas -- POS Ticket Headers](#ventas)\n5. [LineasVentas -- POS Ticket Lines](#lineasventas)\n6. [PagosVentas -- POS Payments](#pagosventas)\n7. [Clientes -- Customer Master](#clientes)\n8. [Tiendas -- Store Master](#tiendas)\n9. [GCAlbaranes -- Wholesale Delivery Notes](#gcalbaranes)\n10. [GCLinAlbarane -- Wholesale Delivery Note Lines](#gclinalbarane)\n11. [GCFacturas -- Wholesale Invoices](#gcfacturas)\n12. [Traspasos -- Stock Transfers](#traspasos)\n13. [CCStock -- Central Warehouse Stock](#ccstock)\n14. [Exportaciones -- Retail Store Stock](#exportaciones)\n15. [FamiGrupMarc -- Family/Group Classification](#famigrupmarc)\n16. [FormasPago -- Payment Methods](#formaspago)\n17. [Proveedores -- Supplier Master](#proveedores)\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Primary Key Pattern",
    "body": "PowerShop uses **Real (float)** fields as primary keys with a special `.99` suffix convention:\n\n- `Articulos.RegArticulo` = `534.99` -- the `.99` encodes store affiliation\n- `Ventas.RegVentas` = `12345.155` -- the `.155` encodes store code\n- `Clientes.RegCliente` = `678.99` -- `.99` = central record\n\nThis encoding allows implicit store-level filtering without a separate store column in some queries. Foreign keys reference these same float values:\n\n```\nLineasVentas.NumVentas -> Ventas.RegVentas\nLineasVentas.NumArticulo -> Articulos.RegArticulo\nVentas.NumCliente -> Clientes.RegCliente\nGCAlbaranes.NumCliente -> Clientes.RegCliente\n```\n\n**Important**: Do not perform arithmetic on PK values. They should be treated as opaque identifiers that happen to be stored as floats.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Grain: a row is model + colour, not a SKU",
    "body": "One `Articulos` row is **a model in one colour**, not a sellable SKU. The last two\ncharacters of `CCRefeJOFACM` encode the colour (`V26212484` -> colour `84`).\n\nSize is **not** a column of `Articulos`. Size lives:\n\n- on the sale line, in 4D, as `LineasVentas.CCOPTallaOjo` (100 % populated);\n- in the PostgreSQL mirror, in `ps_lineas_ventas.talla`, `ps_stock_tienda.talla`\n  and `ps_traspasos.talla`.\n\n`ps_lineas_ventas.talla` mirrors `CCOPTallaOjo` desde 2026-08, **normalizada a\nMAYÚSCULAS en el ETL**. No es una rareza aislada: medido contra el 4D vivo sobre\n60.000 líneas, **9 de los 29 valores distintos** de `CCOPTallaOjo` llevan\nminúsculas (`'m'` ×330, `'l'` ×282, `'u'` ×270, `'xl'` ×241, `'xxl'` ×164,\n`'s'` ×133). Sin normalizar, cada talla se parte en dos y el ranking cambia:\nen el artículo `I26101833` la más vendida sale **M (9 uds)** porque L queda\ndividida en `'L'` (8) y `'l'` (3); normalizando gana **L con 11**. Las filas anteriores a la\nresincronización tienen la columna vacía, así que conviene filtrar\n`talla IS NOT NULL` en análisis históricos.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Stock",
    "body": "| Field | Type | Description |\n|-------|------|-------------|\n| Stock | Real | Total stock across all stores (aggregate) |\n| StockInicial | Real | Initial stock at start of period |\n| StockMinimo | Real | Reorder threshold |\n| StockMaximo | Real | Maximum stock level |\n\n**Note**: Articulos.Stock is a denormalized aggregate. For per-store stock, use CCStock (store 99/central) and Exportaciones (retail stores).\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Key Relationships",
    "body": "```\nVentas.RegVentas -> LineasVentas.NumVentas (1:N)\nVentas.RegVentas -> PagosVentas.NumVentas (1:N)\nVentas.NumCliente -> Clientes.RegCliente\n```\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "Relationship to CCStock",
    "body": "| Table | Store | Description |\n|-------|-------|-------------|\n| CCStock | 99 (central) | One row per product |\n| Exportaciones | All others | One row per product per store |\n\n**Store 99 never appears in Exportaciones.** To get total stock for a product:\n```\nTotal Stock = CCStock.Stock (central) + SUM(Exportaciones.STStock) per store\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/data-dictionary.md",
    "heading": "LLM:rules",
    "body": "Reglas de negocio derivadas de este diccionario, compiladas al bundle de\nconocimiento (`dashboard/lib/knowledge.ts`) y a WrenAI. Editar aqui, no alli.\n\n```json\n[\n  {\n    \"instruction\": \"Los nombres de tablas y columnas de PowerShop estan en espanol. Equivalencias basicas: Ventas=tickets de venta, LineasVentas=lineas de ticket, PagosVentas=cobros, Compras=pedidos de compra, Albaranes=albaranes, Facturas=facturas, Traspasos=movimientos entre tiendas, Tienda=tienda, Cajero=cajero, Proveedor=proveedor, Articulo=producto, Unidades=cantidad, Importe=importe monetario, Abono=nota de credito o devolucion.\",\n    \"questions\": [\n      \"que significa LineasVentas\",\n      \"que quiere decir abono\",\n      \"glosario de nombres de tablas\"\n    ]\n  },\n  {\n    \"instruction\": \"Prefijos de columna en PowerShop: 'Reg' = clave primaria del registro (RegVentas, RegArticulo); 'Num' = clave ajena a otra tabla (NumCliente -> Clientes.RegCliente); 'N' = numero de documento visible y NO unico (NDocumento, NAlbaran); 'P' = porcentaje (PIva); 'I' = importe (IIva1); 'Clave' = codigo corto; 'Libre' = campo libre configurable por el cliente. En el espejo PostgreSQL estos nombres van en snake_case: RegVentas -> reg_ventas, NumCliente -> num_cliente.\",\n    \"questions\": [\n      \"que significa el prefijo Num\",\n      \"diferencia entre Reg y Num\",\n      \"como se traducen los nombres al espejo\"\n    ]\n  },\n  {\n    \"instruction\": \"Sufijos de importe: 'SI' = Sin Impuestos (sin IVA) y es SIEMPRE la medida de analisis; 'CI' = con costes de importacion; 'Bruto' = antes de descuentos; 'Neto' = despues de descuentos; 'Cob' = cobrado; 'Ent' = entregado o entregado en efectivo. Para facturacion e ingresos usa total_si, nunca total. En ps_pagos_ventas usa importe_cob (lo realmente cobrado), nunca importe_ent (lo entregado por el cliente, que incluye el cambio).\",\n    \"questions\": [\n      \"total o total_si\",\n      \"que significa SI en TotalSI\",\n      \"importe_cob o importe_ent\"\n    ]\n  },\n  {\n    \"instruction\": \"Las claves primarias de PowerShop son numeros Real con sufijo decimal (RegArticulo=534.99, RegVentas=12345.155) donde los decimales codifican la tienda. En el espejo se guardan como NUMERIC, nunca como FLOAT8. Son identificadores OPACOS: no hagas aritmetica, ni sumas, ni comparaciones de rango, ni CAST a entero sobre ellos. Usalos solo para igualdad en JOINs.\",\n    \"questions\": [\n      \"por que las claves tienen .99\",\n      \"puedo sumar reg_articulo\",\n      \"patron de clave primaria\"\n    ]\n  },\n  {\n    \"instruction\": \"En ps_articulos, 'codigo' NO es la referencia de negocio: contiene un codigo interno corto ('169', '168'). La referencia que usa el negocio es 'ccrefejofacm' (ej. 'V26212484'). Usa 'codigo' solo como clave de JOIN (ps_lineas_ventas.codigo, ps_stock_tienda.codigo) y muestra SIEMPRE 'ccrefejofacm' como etiqueta del producto al usuario.\",\n    \"questions\": [\n      \"cual es la referencia de un articulo\",\n      \"que es ccrefejofacm\",\n      \"como identifico un producto\"\n    ]\n  },\n  {\n    \"instruction\": \"Una fila de ps_articulos es un modelo EN UN COLOR, no un SKU vendible. Los dos ultimos caracteres de ccrefejofacm codifican el color. La talla NO esta en ps_articulos ni en ps_lineas_ventas: en 4D vive en LineasVentas.CCOPTallaOjo (poblada al 100%) pero NO esta replicada en el espejo. En PostgreSQL solo hay talla en ps_stock_tienda.talla y ps_traspasos.talla. Nunca inventes una columna talla en ps_lineas_ventas.\",\n    \"questions\": [\n      \"ventas por talla\",\n      \"que granularidad tiene ps_articulos\",\n      \"donde esta la talla\"\n    ]\n  },\n  {\n    \"instruction\": \"Semantica de 'entrada': entrada = true es una venta (dinero que entra), entrada = false es una devolucion (dinero que sale, con el importe guardado en POSITIVO). En ps_ventas y ps_pagos_ventas existe la columna 'entrada'; en ps_lineas_ventas NO existe, hay que unir con ps_ventas por lv.num_ventas = v.reg_ventas para obtenerla.\",\n    \"questions\": [\n      \"que es entrada\",\n      \"como distingo una devolucio",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Key findings",
    "body": "- **Ventas/LineasVentas/PagosVentas are NOT append-only.** 19–21% of historical records have `FechaModifica > FechaCreacion`, caused by returns, TBAI fiscal corrections, and payment flag updates. All three tables require **UPSERT by `FechaModifica`**.\n- **`FechaDocumento` is NULL for all records in Ventas.** Never use it as a delta field. Use `FechaModifica` or `FechaCreacion`.\n- **`LineasCompras` exists but is empty (0 rows, 57 columns).** The populated purchase-order line table is `CCLineasCompr` (44K rows), linked to `Compras` via `NumPedido`. Earlier revisions claimed `LineasCompras` \"does not exist\" — it does; querying it just returns nothing.\n- **`Exportaciones.TiendaCodigo`** has the format `\"tienda/articulo\"` (e.g. `\"104/169\"`), not just a store code. The compound PK is `(Codigo, TiendaCodigo)`.\n- **PKs are REAL (float) with `.99` suffix** (e.g. `RegVentas = 10028816.641`). Store as `NUMERIC` in PostgreSQL, not `FLOAT8`, to avoid precision loss.\n- **Referencia prefix `MA` = material (no inventory).** Articles whose `CCRefeJOFACM` starts with `MA` are materials (bolsas, perchas, etc.) — no stock tracking, no inventory management. Exclude from stock analysis and sales KPIs. `M` (non-MA) = wholesale. No prefix = retail.\n- **MA articles (materials) excluded at ETL level.** Articles whose `CCRefeJOFACM` starts with `'MA'` are filtered from the 4D extraction query in `sync_articulos` (`WHERE LEFT(CCRefeJOFACM, 2) <> 'MA'`). After each full sync, a cascade cleanup step also removes MA-linked rows from line-item tables (`ps_lineas_ventas`, `ps_stock_tienda`, `ps_gc_lin_albarane`, `ps_gc_lin_facturas`) using `get_ma_article_codes()` in `etl/sync/articulos.py`. This eliminates the need for `MA%` filtering in all downstream queries and WrenAI instructions.\n- **All 41K Articulos have `FechaModifica >= 2025-03-26`** due to a batch update. Delta sync is ineffective; use full refresh.\n- **GCLinAlbarane and GCLinFacturas have no modification timestamp.** Delta is derived from the parent header's `Modifica` field via a parent-join strategy.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Learnings from first production sync (2026-03-31)",
    "body": "- **NUMERIC(20,3) not (20,2)** for PKs. Some 4D PKs have 3 decimal places (e.g. `RegCliente = 4.152, 4.153`). Scale 2 rounded them and caused duplicate-key violations.\n- **4D SQL `!=` not supported** — use `<>`. This broke `get_queryable_columns()` and all tables using it (Compras, Facturas, Albaranes, FacturasCompra).\n- **Exportaciones needs progressive sync by store** — single 2M-row fetch OOMs. Fetch per-store (`WHERE Tienda = 'X'`): 50 stores × ~41K rows × ~80s = ~67 min total. Each store normalizes to ~247K rows (6 tallas avg).\n- **Single-query is still correct for tables <2M rows** — Ventas (911K, 16 min), LineasVentas (1.7M, 30 min), PagosVentas (965K, 14 min) all completed with single-fetch. LIMIT/OFFSET is never correct for 4D (re-scans from row 0 at each offset).\n- **GCLinAlbarane missing columns**: `NumComercial` and `Mes` don't exist in GCLinAlbarane (they do in GCLinFacturas). Column lists must be verified per table.\n- **GCAlbaranes has `Unidades` not `Entregadas`** — column name mismatch from the architecture docs.\n- **n_albaran/n_factura are NOT unique** — multiple documents can share the same number (different series). UNIQUE indexes and FK constraints on these fail.\n- **NUL byte padding** in 4D text fields — fixed-length fields come with `\\x00` padding.\n- **p4d cursor.description returns bytes** — column names are `b'REGARTICULO'`, not str.\n- **TRUNCATE CASCADE needed** when FK constraints exist between full-refresh tables.\n- **Full initial load time**: ~2.5 hours total (Ventas chain ~60 min, GC chain ~50 min, Stock ~67 min, rest ~15 min).\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Ventas domain (retail POS)",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| Ventas | 911,619 | `RegVentas` | `FechaModifica` (max = today) | UPSERT delta |\n| LineasVentas | 1,689,796 | `RegLineas` | `FechaModifica` (max = today) | UPSERT delta |\n| PagosVentas | 964,971 | `RegPagos` | `FechaModifica` (max = today) | UPSERT delta |\n\n**Daily volume:** ~454 Ventas + ~897 LineasVentas new/modified per day.\n\n```sql\n-- Delta pattern for all three tables\nSELECT ... FROM Ventas WHERE FechaModifica > :last_sync\n-- → UPSERT INTO ps_ventas ON CONFLICT (reg_ventas) DO UPDATE SET ...\n```\n\n**Why UPSERT and not INSERT?**\n- 177,530 Ventas records modified since 2025-01-01 (19% of total)\n- 356,505 LineasVentas records modified since 2025-01-01 (21% of total)\n- 188,859 PagosVentas records modified since 2025-01-01 (20% of total)\n\n**FK chain:** `LineasVentas.NumVentas` → `Ventas.RegVentas`, `PagosVentas.NumVentas` → `Ventas.RegVentas`\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Stock domain",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| Exportaciones | 2,058,201 | `(Codigo, TiendaCodigo)` compound | `FechaModifica` (some NULLs for zero-stock articles) | UPSERT delta + normalize |\n| Traspasos | 262,689 | `RegTraspaso` | `FechaS` (send date) | Append-only by `FechaS` |\n| CCStock | 41,478 | `NumArticulo` (Real) | None | Full refresh nightly → `ps_stock_central` |\n\n**Exportaciones normalization:** The source table is wide-format (Talla1..Talla34 + Stock1..Stock34 per row). `_USER_COLUMNS` shows every **`Stock1`…`Stock34`** as **`DATA_TYPE = 3`**, **`DATA_LENGTH = 2`** (16-bit integer). Through **4D SQL / p4d**, slot values can arrive as **unsigned** (`65535` for `−1`); ETL applies **`decode_signed_int16_word()`** (`etl/db/fourd.py`) before `int` cast so `ps_stock_tienda.stock` matches native/POS signed semantics. **`CCStock`** on the same row (the `Exportaciones.CCStock` column) is **Real** and already carries the signed row total.\n\n`TiendaCodigo` format: `\"104/169\"` = store 104 / article 169. The compound `(Codigo, TiendaCodigo)` is the natural PK — verified by row count.\n\n**Traspasos:** Only 153 rows since 2025-01-01 (mostly historical log). No `FechaModifica`. Records appear immutable once created. Append-only by `FechaS`. Initial load covers all 262K rows.\n\n**CCStock (central warehouse, confirmed 2026-05-01):** One row per article (41 478 rows). `NumArticulo` is the PK (Real, .99 suffix). `Stock1..Stock34` are **`DATA_TYPE=3, DATA_LENGTH=2`** (16-bit WORD) — same type as `Exportaciones.StockN`. `decode_signed_int16_word()` is applied before summing. The root-level `Stock` column (Real, type 6) is the 4D-maintained total but we recompute from slots for accuracy. No delta field: full refresh is fast at 41K rows. Mirror: `ps_stock_central(num_articulo, stock, fecha_modifica)`.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Wholesale domain (Gestión Comercial)",
    "body": "| Table | Rows | PK | Delta field | Strategy |\n|-------|------|----|-------------|---------|\n| GCAlbaranes | 48,948 | `RegAlbaran` | `Modifica` (max = today, ~19/day) | UPSERT delta |\n| GCLinAlbarane | 1,016,290 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |\n| GCFacturas | 18,060 | `RegFactura` | `Modifica` (all 18K populated) | UPSERT delta |\n| GCLinFacturas | 974,742 | `RegLinea` | **None** — derive from parent | Delete+reinsert via parent |\n| GCPedidos | 101 | `RegPedido` | `Modifica` (available) | Full refresh (trivially small) |\n| GCLinPedidos | 2,645 | `RegLinea` | None | Full refresh (trivially small) |\n\n**Parent-join delta pattern for lines:**\n```sql\n-- Fetch lines for recently modified delivery notes.\n-- The parent key is the 4D record ID (RegAlbaran), never the visible NAlbaran.\nSELECT * FROM GCLinAlbarane\nWHERE NumAlbaran IN (\n    SELECT RegAlbaran FROM GCAlbaranes WHERE Modifica >= :last_sync\n)\n-- → DELETE FROM ps_gc_lin_albarane WHERE num_albaran = ANY(:changed_reg_albaran)\n-- → INSERT INTO ps_gc_lin_albarane ...\n```\n\n**Line → header join key (corrected 2026-08-29):**\nDespite the `Num` prefix, the line tables carry the parent's **4D record ID**:\n- `GCLinAlbarane.NumAlbaran` → `GCAlbaranes.RegAlbaran` (4000/4000 on a production sample)\n- `GCLinFacturas.NumFactura` → `GCFacturas.RegFactura` (4000/4000)\n\nThe *visible* document numbers are the wrong key on both counts:\n`GCLinFacturas.NumFactura` matches `GCFacturas.NFactura` **0/4000**, and neither\nvisible number is unique (52,148 GCAlbaranes rows carry 40,727 distinct\n`NAlbaran` values; 19,351 GCFacturas rows carry 14,515 distinct `NFactura`\nvalues), so joining on them mixes lines from unrelated documents.  The ETL used\nthe visible numbers until 2026-08-29: the invoice-line delta re-inserted 0 rows\non every nightly run, and the mirror had drifted 1,873 invoice lines and 3,826\ndelivery-note lines behind 4D.\n\n**GCAlbaranes daily volume:** ~19 modified/day, ~833/month. Lines delta is lightweight.\n\n---",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "Nightly execution order",
    "body": "Tables must be synced in topological order (dimensions before facts):\n\n1. Catalog: Articulos, FamiGrupMarc, CCOPColores, CCOPTempTipo, DepaSeccFabr\n2. Masters: Tiendas, Clientes, Proveedores, GCComerciales\n3. Stock: Exportaciones\n4. Retail: Ventas → LineasVentas → PagosVentas\n5. Wholesale: GCAlbaranes → GCLinAlbarane | GCFacturas → GCLinFacturas | GCPedidos → GCLinPedidos\n6. Purchasing: Compras → CCLineasCompr → Facturas → Albaranes → FacturasCompra\n7. Movements: Traspasos",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/etl-sync-strategy.md",
    "heading": "LLM:rules",
    "body": "Business rules and field conventions the dashboard LLM must follow when generating SQL against the `ps_*` mirror tables.\n\n```json\n[\n  {\n    \"instruction\": \"Siempre usar el campo total_si (sin IVA) para análisis económico de ventas retail. NUNCA usar el campo total que incluye IVA. El IVA varía por región (23% Portugal continental, 22% Madeira, 21% España) y distorsiona las comparaciones entre tiendas.\",\n    \"questions\": [\"¿Cuánto vendimos?\", \"¿Cuáles son las ventas netas?\", \"¿Cuál es la facturación?\", \"¿Cuántos ingresos tuvimos este mes?\"]\n  },\n  {\n    \"instruction\": \"El campo fecha_creacion en Venta y LineaVenta es la fecha de la venta (tipo DATE, formato YYYY-MM-DD). Para filtrar por fecha usar comparaciones simples: fecha_creacion >= '2026-03-24' AND fecha_creacion < '2026-03-31'. NUNCA hacer CAST a TIMESTAMP WITH TIME ZONE — el campo ya es DATE. El campo fecha_documento está vacío (NULL) en todos los registros de Ventas — NUNCA usarlo para filtrar.\",\n    \"questions\": [\"¿Ventas de la semana pasada?\", \"¿Ventas de hoy?\", \"¿Ventas de este mes?\", \"¿Cuánto vendimos en marzo?\"]\n  },\n  {\n    \"instruction\": \"El campo mes en LineaVenta es un entero con formato YYYYMM (ej: 202603 = marzo 2026). Usar para filtrado rápido por período en vez de funciones de fecha: WHERE mes BETWEEN 202601 AND 202612. Es el filtro más eficiente para consultas de ventas por período.\",\n    \"questions\": [\"¿Ventas del primer trimestre?\", \"¿Ventas de enero a marzo?\", \"¿Rendimiento del año 2025?\"]\n  },\n  {\n    \"instruction\": \"VENTAS = NETO DE DEVOLUCIONES. En Venta, entrada=true es venta y entrada=false es devolución, y PowerShop presenta tres cifras distintas: 01VEN (ventas brutas), 02DEV (devoluciones) y NETO (01VEN - 02DEV). Cuando el usuario pide 'ventas' SIN más matices se refiere al NETO: filtrar entrada=true a secas descarta las devoluciones en vez de restarlas y sobrestima las ventas entre un 7 y un 10 por ciento (medido en produccion 2026-08). El patron obligatorio es: COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0) AS ventas_netas. Usar entrada=true a secas SOLO si el usuario pide explicitamente ventas brutas o excluir devoluciones. Para ver las tres cifras como en el ERP: COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) AS ventas_brutas, COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0) AS devoluciones, y la resta como ventas_netas. Los importes de devolucion se guardan en POSITIVO, por eso hay que restarlos explicitamente. El campo tipo_documento contiene 'Ticket' para ventas POS normales. NO filtrar por tipo_documento='V' que no existe en el mirror.\",\n    \"questions\": [\"¿Cuántas devoluciones hubo?\", \"¿Ventas netas sin devoluciones?\", \"¿Cuánto se devolvió este mes?\", \"¿Tasa de devolución?\"]\n  },\n  {\n    \"instruction\": \"Para excluir la tienda 99 (almacén central) del análisis retail, añadir WHERE tienda <> '99' en consultas de ventas por tienda. El almacén central no es una tienda física de venta al público. La tienda 97 es la tienda online con patrones diferentes.\",\n    \"questions\": [\"¿Ventas por tienda?\", \"¿Qué tiendas venden más?\", \"¿Rendimiento de tiendas retail?\", \"¿Ranking de tiendas?\"]\n  },\n  {\n    \"instruction\": \"El ticket medio es ventas NETAS entre numero de tickets de VENTA: (COALESCE(SUM(total_si) FILTER (WHERE entrada), 0) - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0)) / NULLIF(COUNT(DISTINCT reg_ventas) FILTER (WHERE entrada), 0). Usar siempre total_si (sin IVA). El numerador es neto porque una devolucion reduce lo vendido; el denominador cuenta solo tickets de venta, que es lo que hace PowerShop. No filtrar entrada=true en el numerador: eso ignora las devoluciones en vez de restarlas.\",\n    \"questions\": [\"¿Cuál es el ticket medio?\", \"¿Cuánto gasta cada cliente de media?\", \"¿Valor medio por transacción?\"]\n  },\n  {\n    \"instruction\": \"Las ventas YTD (año hasta la fecha) se calculan con: WHERE fecha_creacion >= DATE_TRUNC('year', CURRENT_DATE) AND fecha_creacion <= ",
    "hasSql": true,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/overview.md",
    "heading": "Dashboard JSON spec example",
    "body": "The LLM generates a JSON specification that the frontend renders:\n\n```json\n{\n  \"title\": \"Cuadro de Mandos — Ventas Marzo 2026\",\n  \"description\": \"Panel para el responsable de ventas\",\n  \"widgets\": [\n    {\n      \"id\": \"w1\",\n      \"type\": \"kpi_row\",\n      \"items\": [\n        {\"label\": \"Ventas Netas\", \"sql\": \"SELECT SUM(total_si) ...\", \"format\": \"currency\", \"prefix\": \"€\"},\n        {\"label\": \"Tickets\", \"sql\": \"SELECT COUNT(DISTINCT reg_ventas) FILTER (WHERE entrada) ...\", \"format\": \"number\"},\n        {\"label\": \"Ticket Medio\", \"sql\": \"SELECT SUM(total_si)/COUNT(...) ...\", \"format\": \"currency\", \"prefix\": \"€\"}\n      ]\n    },\n    {\n      \"type\": \"bar_chart\",\n      \"title\": \"Ventas por Tienda\",\n      \"sql\": \"SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas ...\",\n      \"x\": \"label\", \"y\": \"value\"\n    },\n    {\n      \"type\": \"line_chart\",\n      \"title\": \"Tendencia Semanal\",\n      \"sql\": \"SELECT DATE_TRUNC('week', fecha_creacion) AS x, SUM(total_si) AS y FROM ps_ventas ...\"\n    },\n    {\n      \"type\": \"table\",\n      \"title\": \"Top 10 Artículos\",\n      \"sql\": \"SELECT p.ccrefejofacm AS \\\"Referencia\\\", p.descripcion AS \\\"Descripción\\\", ...\"\n    }\n  ]\n}\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Ventas {\n        float RegVentas PK \"Internal record ID (encodes store)\"\n        date FechaCreacion \"Sale date\"\n        date FechaModifica \"Last modified date (delta field)\"\n        time Hora \"Sale time\"\n        float Total \"Total amount\"\n        float TotalSI \"Total without VAT\"\n        float TotalBruto \"Gross total\"\n        float Metalico \"Cash amount\"\n        float Credito \"Credit amount\"\n        float Vale \"Voucher amount\"\n        float Descuento \"Discount amount\"\n        float Cambio \"Change given\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        text CodigoCajero \"Cashier code\"\n        text CajeroNombre \"Cashier name\"\n        text Caja \"Cash register code\"\n        text Tienda \"Store code\"\n        text CodigoForma \"Payment method code\"\n        text TipoDocumento \"Document type\"\n        text TipoVenta \"Sale type\"\n        boolean FacturadoVenta \"Invoice generated\"\n        boolean Pendiente \"Pending flag\"\n        boolean Entrada \"Is entry (vs return)\"\n        float NDocumento \"Document number\"\n        text PedidoWeb \"Web order ID\"\n        text NumPedido \"Online order number\"\n        text MarketPlace \"Marketplace source\"\n        text IntegradorMK \"Marketplace integrator code\"\n        boolean EnviadoCentral \"Sent to HQ\"\n        text EnvCliente \"Delivery customer name\"\n        text EnvDireccion \"Delivery address\"\n        text EnvPoblacion \"Delivery city\"\n        text EnvProvincia \"Delivery province\"\n        text EnvPostal \"Delivery postcode\"\n        text EnvTelefono \"Delivery phone\"\n        text EnvPais \"Delivery country\"\n        text TaxFreeID \"Tax-free certificate ID\"\n        boolean TaxFreeRefund \"Tax-free refund flag\"\n        text AenaNacionalidad \"Aena passenger nationality\"\n        text AenaOrigen \"Aena origin airport code\"\n        text AenaDestino \"Aena destination airport code\"\n        text AenaVuelo \"Aena flight number\"\n        text SaftFecha \"SAF-T fiscal date\"\n        text SaftHora \"SAF-T fiscal time\"\n        text SaftHashNcf \"SAF-T hash/NCF\"\n        text SaftMotivoExenta \"SAF-T exemption reason\"\n        text SaftSeriecodVal \"SAF-T series/validation code\"\n        text TbaiHaciendaId \"TicketBAI Hacienda ID\"\n        boolean TbaiFirmado \"TicketBAI signed flag\"\n        text TbaiFirma13 \"TicketBAI signature (13-char)\"\n        text TbaiErrorFirma \"TicketBAI signing error\"\n        boolean TbaiEnviado \"TicketBAI sent to Hacienda\"\n        text TbaiErrorEnvio \"TicketBAI send error\"\n        date TbaiAnuladoFecha \"TicketBAI annulment date\"\n        boolean TbaiAnuladoFirmado \"TicketBAI annulment signed\"\n        boolean TbaiAnuladoEnviado \"TicketBAI annulment sent\"\n        text WappingId \"Wapping loyalty/CRM transaction ID\"\n        text WappingPromo \"Wapping promotion code\"\n        float WappingPuntosMas \"Wapping loyalty points earned\"\n        float WappingPuntosMenos \"Wapping loyalty points spent\"\n        float ValeRegaloImp \"Gift voucher amount\"\n        date ValeRegaloFec \"Gift voucher date\"\n        text ValeRegaloTie \"Gift voucher store\"\n        text FactExtNDoc \"External invoice number\"\n        date FactExtFecha \"External invoice date\"\n        text FactExtSerie \"External invoice series\"\n    }\n\n    LineasVentas {\n        float RegLineas PK \"Line record ID\"\n        float NumVentas FK \"-> Ventas.RegVentas\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Codigo \"Product code (denorm)\"\n        text Descripcion \"Product description (denorm)\"\n        float Unidades \"Quantity sold\"\n        float PrecioNeto \"Net unit price\"\n        float PrecioBruto \"Gross unit price\"\n        float Total \"Line total\"\n        float TotalSI \"Line total w/o VAT\"\n        float ImporteDescuento \"Discount amount\"\n        float ImporteRebajas \"Markdown amount\"\n        date FechaCreacion \"Sale date\"\n        time Hora \"Sale time\"\n        int Mes \"YYYYMM period (int)\"\n        float NumCliente FK \"-> Clientes\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n     ",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Table Descriptions",
    "body": "| Table | Rows | Columns | Description |\n|-------|------|---------|-------------|\n| **Ventas** | 910,253 | 148 (Ventas table) / 150 (Ventas_SQL view) | Sales header/ticket. One row per POS transaction with totals, payment breakdown, customer, store, cashier, and fiscal data (TBAI/SAFT). Has a corresponding SQL view `Ventas_SQL` with all 150 columns queryable via the 4D SQL port. |\n| **LineasVentas** | 1,687,094 | 159 | Sales line items. One row per product on a ticket. Contains article ref, units, price, discounts, and full product classification for analytics. Queryable as `LineasVentas_SQL` view. |\n| **PagosVentas** | 963,541 | 49 (PagosVentas_SQL view) | Payment details per sale. Multiple rows per ticket if split payment (cash + card, etc.). Queryable as `PagosVentas_SQL` view (49 columns including PSCARD1-10 payment card slots). |\n| **Cajas** | 42,484 | 272 | Cash register sessions/closings. Daily summaries with payment type breakdowns, drawer counts, and VAT summaries. |\n| **LCajas** | 50 | 40 | Cash register configuration/definitions. One per physical register. |\n| **Cajeros** | 20 | 13 | Cashier master. Login credentials and commission rates. |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "SQL Views",
    "body": "> Discovered 2026-04-05\n\nThe 4D SQL port (19812) exposes dedicated SQL views for the core sales tables. These views expose all columns and are the recommended access path for ETL and ad-hoc queries:\n\n| View | Underlying table | Columns | Notes |\n|------|-----------------|---------|-------|\n| `Ventas_SQL` | Ventas | 150 | Full header/ticket data including TBAI, SAF-T, marketplace, delivery, Aena fields |\n| `LineasVentas_SQL` | LineasVentas | ~159 | Full line-item data |\n| `PagosVentas_SQL` | PagosVentas | 49 | Payment data including PSCARD1-10 card slots |\n| `Cajas_SQL` | Cajas | ~272 | Register session/closing data |\n\nQuery example: `SELECT REGVENTAS, FECHACREACION, TOTALSI FROM Ventas_SQL WHERE FECHACREACION >= '2026-01-01'`",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "Notes",
    "body": "- **Ventas.RegVentas** encodes the store in its decimal part (e.g., `.153`, `.155`), enabling implicit store filtering.\n- **LineasVentas.Mes** stores YYYYMM as Long Integer (e.g., `201410`) for fast period-based queries.\n- **PagosVentas.Mes** stores the same YYYYMM but as Text type.\n- **Cajas** has 272 columns due to repeating groups: L1-L20 (line totals), A1-A20 (article counts), C1-C20 (category counts), plus morning/afternoon splits and multi-currency fields.\n- Sales support fiscal compliance: TBAI (Basque Country tax) and SAFT (Portugal audit file) fields on Ventas.\n- **Denormalization**: LineasVentas carries copies of Codigo, Descripcion, NumFamilia, NumDepartament, etc., from Articulos for reporting efficiency.\n- **TBAI annulment fields** share the same lifecycle pattern as the primary TBAI fields; use `TBAI_ANULADOFECHA` to detect annulled tickets.\n- **LIBRE fields**: `Ventas` has `LIBRE03` and `LIBRE06..LIBRE15` (free/custom fields, typically NULL). `PagosVentas` has `LIBRE01..LIBRE12`.\n- **`LineasVentas.Entrada` exists in the source; the mirror is only now catching up.** Earlier revisions of this file said the field \"does not exist\", which contradicted the ER diagram above. Verified against 4D `_USER_COLUMNS` (`LineasVentas`, 159 columns): the table **does** have `Entrada` (boolean) and `MovimientoCaja` (text, `'Venta'` / `'Devolucion'`), and the two agree 100% of the time. What was missing was the **mirror** column. As of commit `e4491b5` the ETL selects `entrada`, `movimiento_caja` and `talla` into `ps_lineas_ventas`, but **production has not been re-synced yet** — the deployed mirror still has only the original 14 columns. Until that sync runs, every line-level query must `JOIN ps_ventas` and use the net pattern:\n  `COALESCE(SUM(lv.total_si) FILTER (WHERE v.entrada), 0) - COALESCE(SUM(lv.total_si) FILTER (WHERE NOT v.entrada), 0)`.\n  The `COALESCE` wrappers are not optional: `SUM(...) FILTER (...)` is NULL when a group has no row on one side, and `NULL - x` is NULL, which silently blanks 30.6% of article-level groups.\n- **`LineasVentas.PDescG` / `ImporteDescuento` are the same story**: present in 4D, absent from `ps_lineas_ventas`. Discount metrics cannot be computed from the mirror today — see the discount rule in [etl-sync-strategy.md](../etl-sync-strategy.md).",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30.\n\n**These tables are NOT append-only.** Historical records are modified retroactively for returns, TBAI fiscal corrections, payment flag updates, and export markers.\n\n| Table | Rows | Modifications since 2025-01-01 | Delta field | Strategy |\n|-------|------|-------------------------------|-------------|---------|\n| Ventas | 911,619 | 177,530 (19%) | `FechaModifica` | UPSERT delta |\n| LineasVentas | 1,689,796 | 356,505 (21%) | `FechaModifica` | UPSERT delta |\n| PagosVentas | 964,971 | 188,859 (20%) | `FechaModifica` | UPSERT delta |\n\nDaily volume: ~454 Ventas + ~897 LineasVentas new/modified per day.\n\n**Critical gotchas:**\n- `FechaDocumento` is **NULL for all records** in Ventas — never use as a delta field.\n- `FechaModifica` is the correct delta field (max = today, always updated on any change).\n- PKs (`RegVentas`, `RegLineas`, `RegPagos`) are REAL floats — store as `NUMERIC` in PostgreSQL to avoid precision loss.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_ventas\",\n    \"alias\": \"Venta\",\n    \"description\": \"Tickets de venta retail. total_si=sin IVA (usar siempre). entrada=true para ventas, false para devoluciones.\",\n    \"keyColumns\": [\"reg_ventas (PK)\", \"n_documento\", \"tienda\", \"fecha_creacion\", \"total_si (SIN IVA - usar siempre)\", \"total (CON IVA - NO usar)\", \"num_cliente (0=anónimo)\", \"entrada (true=venta, false=devolución)\", \"tipo_documento\", \"cajero_nombre\"]\n  },\n  {\n    \"table\": \"ps_lineas_ventas\",\n    \"alias\": \"LineaVenta\",\n    \"description\": \"Líneas de venta (detalle por artículo). El espejo NO tiene entrada — el ETL no la selecciona todavía; en 4D LineasVentas SÍ la tiene. Usar JOIN con ps_ventas y el patrón neto FILTER.\",\n    \"keyColumns\": [\"reg_lineas (PK)\", \"num_ventas (FK -> ps_ventas.reg_ventas)\", \"mes (YYYYMM)\", \"tienda\", \"codigo (FK -> ps_articulos.codigo)\", \"descripcion\", \"unidades\", \"precio_neto_si\", \"total_si\", \"total_coste_si\", \"fecha_creacion\"]\n  },\n  {\n    \"table\": \"ps_pagos_ventas\",\n    \"alias\": \"PagoVenta\",\n    \"description\": \"Pagos por ticket. importe_cob=importe cobrado.\",\n    \"keyColumns\": [\"reg_pagos (PK)\", \"num_ventas (FK)\", \"forma\", \"codigo_forma\", \"importe_cob\", \"tienda\", \"entrada\", \"fecha_creacion\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/sales.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_lineas_ventas\", \"fromColumn\": \"num_ventas\", \"to\": \"ps_ventas\", \"toColumn\": \"reg_ventas\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_pagos_ventas\", \"fromColumn\": \"num_ventas\", \"to\": \"ps_ventas\", \"toColumn\": \"reg_ventas\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_ventas\", \"fromColumn\": \"tienda\", \"to\": \"ps_tiendas\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_ventas\", \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\", \"toColumn\": \"reg_cliente\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_lineas_ventas\", \"fromColumn\": \"codigo\", \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "Notes",
    "body": "- **Two purchase line tables exist**: `LineasCompras` (exists, 57 cols, 0 rows) and `CCLineasCompr` (44,395 rows). The CC-prefixed version is the active one. `LineasCompras` **is a real table** — do not repeat the claim that it \"does not exist\"; it is simply empty.\n- **Purchase flow**: Compras (order) -> Albaranes (receipt) -> FacturasCompra (supplier invoice) -> PagosCompras (payment).\n- **Retail invoicing**: `Facturas` are formal invoices generated from POS sales (Ventas), separate from wholesale invoices (GCFacturas).\n- **LinAlbaranes has 34 size slots, not 17.** Verified against 4D `_USER_COLUMNS` (109 columns total): `Talla1..Talla34` (size labels) **and** `Recibidas1..Recibidas34` (units received per size) — 68 of the 109 columns. The \"Talla1-17\" that used to appear here was the loop bound of a legacy Visual FoxPro report, copied into this doc as if it were the schema. Anything iterating sizes must go to 34 or it silently drops the tail of the size run.\n- **LinAlbaranes money/quantity columns** (verified, not guessed): `PrecioCoste`, `PrecioNetoSI`, `TotalSI`, `TotalImport`, `IvaUnitario`, `PDescCompra`, `PIva`, `Recibidas`. There is **no** `PrecioBruto`, `PrecioNeto`, `Unidades` or `Total` on this table — those names were invented in an earlier revision of this file.\n- **Purchases are `Albaranes` + `LinAlbaranes`, not `Compras` + `LineasCompras`.** `Compras`/`CCLineasCompr` are *orders* (what was asked for); `Albaranes`/`LinAlbaranes` are *goods actually received*. Any \"what did we buy\" analysis must use the delivery-note pair — the order pair overstates, because orders get cancelled and partially served. `LineasCompras` itself is empty in production.\n- **DivisionCompra** (10,981 rows) tracks how purchase orders are allocated across multiple stores.\n- Proveedores links to Articulos via `Articulos.NumProveedor -> Proveedores.RegProveedor`.",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_compras\",\n    \"alias\": \"PedidoCompra\",\n    \"description\": \"Pedidos de compra a proveedores. La fecha del pedido es fecha_pedido (NO fecha_creacion). fecha_recibido es NULL mientras el pedido está pendiente de recibir.\",\n    \"keyColumns\": [\"reg_pedido (PK)\", \"num_proveedor (FK)\", \"fecha_pedido\", \"fecha_recibido\", \"modificada\"]\n  },\n  {\n    \"table\": \"ps_lineas_compras\",\n    \"alias\": \"LineaPedidoCompra\",\n    \"description\": \"Líneas de pedido de compra. NOTA: la tabla NO tiene columnas codigo ni unidades; el artículo se referencia por num_articulo (FK NUMERIC) y la tienda por num_tienda.\",\n    \"keyColumns\": [\"reg_linea_compra (PK)\", \"num_pedido (FK → ps_compras.reg_pedido)\", \"num_tienda (FK)\", \"num_articulo (FK)\", \"fecha\"]\n  },\n  {\n    \"table\": \"ps_albaranes\",\n    \"alias\": \"AlbaranRecepcion\",\n    \"description\": \"Albaranes de recepción de mercancía. La fecha de recepción es fecha_recibido (NO fecha_creacion).\",\n    \"keyColumns\": [\"reg_albaran (PK)\", \"fecha_recibido\", \"modificada\"]\n  },\n  {\n    \"table\": \"ps_facturas_compra\",\n    \"alias\": \"FacturaCompra\",\n    \"description\": \"Facturas de compra a proveedores.\",\n    \"keyColumns\": [\"reg_factura (PK)\"]\n  },\n  {\n    \"table\": \"ps_proveedores\",\n    \"alias\": \"Proveedor\",\n    \"description\": \"Proveedores de mercancía.\",\n    \"keyColumns\": [\"reg_proveedor (PK)\", \"nombre\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/purchasing.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_lineas_compras\", \"fromColumn\": \"num_pedido\",    \"to\": \"ps_compras\",      \"toColumn\": \"reg_pedido\",     \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_compras\",        \"fromColumn\": \"num_proveedor\", \"to\": \"ps_proveedores\",  \"toColumn\": \"reg_proveedor\",  \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Traspasos {\n        float RegTraspaso PK \"Transfer record ID\"\n        float Documento \"Document number\"\n        text Codigo \"Article code\"\n        text Descripcion \"Article description\"\n        text Talla \"Size\"\n        float UnidadesS \"Units sent\"\n        float UnidadesE \"Units received\"\n        text TiendaSalida FK \"Origin store code\"\n        text TiendaEntrada FK \"Destination store code\"\n        text CajaSalida \"Origin register\"\n        text CajaEntrada \"Destination register\"\n        date FechaS \"Send date\"\n        time HoraS \"Send time\"\n        date FechaE \"Receipt date\"\n        time HoraE \"Receipt time\"\n        text Tipo \"Transfer type\"\n        text Concepto \"Reason/concept\"\n        boolean Entrada \"Is entry record\"\n        text EmpleadoS \"Sending employee\"\n        text EmpleadoE \"Receiving employee\"\n        text CajeroS \"Sending cashier\"\n        text CajeroE \"Receiving cashier\"\n        text Transportista \"Carrier\"\n        int NExpedicion \"Expedition number\"\n        int Bultos \"Number of packages\"\n        text ZonaTienda \"Store zone\"\n    }\n\n    Movimientos {\n        text Tipo \"Movement type\"\n        text Codigo \"Code\"\n        boolean Entrada \"Is entry\"\n        boolean Almacen \"Is warehouse\"\n    }\n\n    Inventarios {\n        float RegInventario PK \"Inventory record ID\"\n        date FechaInventa \"Inventory date\"\n        text Tienda FK \"Store code\"\n        float Real \"Actual count\"\n        float Grabado \"System count\"\n        float DeMenos \"Shortage\"\n        float DeMas \"Surplus\"\n        text Responsable \"Person responsible\"\n        text Concepto \"Inventory type\"\n        text ZonaTienda \"Store zone\"\n    }\n\n    BarrasAsociado {\n        text CodigoBarra \"Barcode (EAN)\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Talla \"Size\"\n    }\n\n    SemiCodigo {\n        text Codigo \"Short/partial code\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n    }\n\n    CCPorcentajeTemp {\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float Porcentaje \"Percentage\"\n    }\n\n    CCOPSeriCali {\n        text Clave \"Series code\"\n        text Serie \"Series name\"\n    }\n\n    CCOPCriXDiam {\n        text Clave \"Criterion X code\"\n    }\n\n    CCOPLotePuEj {\n        text Lote \"Lot code\"\n    }\n\n    Traspasos }o--|| Tiendas : \"TiendaSalida -> Codigo\"\n    Traspasos }o--|| Tiendas : \"TiendaEntrada -> Codigo\"\n    BarrasAsociado }o--|| Articulos : \"NumArticulo -> RegArticulo\"\n    SemiCodigo }o--|| Articulos : \"NumArticulo -> RegArticulo\"\n\n    Tiendas {\n        text Codigo PK \"Store code\"\n        text Tienda \"Store name\"\n    }\n\n    Articulos {\n        float RegArticulo PK \"Article record ID\"\n        text Codigo \"Article code\"\n    }\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Table Descriptions",
    "body": "| Table | Rows | Columns | Description |\n|-------|------|---------|-------------|\n| **Traspasos** | 262,689 | 30 | Stock transfers between stores and regularizations. Contains origin/destination, article, size, quantities, timestamps, and reason codes (e.g., \"Traspaso\", \"Regularizacion\", \"S-Robo\" for theft). |\n| **Movimientos** | 4 | 4 | Stock movement type definitions. Minimal reference table. |\n| **BarrasAsociado** | 63,756 | -- | Associated barcodes. Maps additional EAN codes to articles (beyond the primary CodigoBarra on Articulos). |\n| **SemiCodigo** | 110,536 | -- | Short/partial codes. Lookup for partial barcode scanning or internal short codes. |\n| **CCPorcentajeTemp** | 406 | -- | Season percentage allocations. |\n| **CCOPSeriCali** | 47 | -- | Size series/caliber definitions (e.g., S/M/L, 36-46, etc.). |\n| **CCOPCriXDiam** | 3 | -- | Criterion X (diamond/special) definitions. |\n| **CCOPLotePuEj** | 3 | -- | Lot/batch definitions. |",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Notes",
    "body": "- **Traspasos** is the primary stock movement table (263K rows), used for both inter-store transfers and stock regularizations (adjustments for theft, damage, etc.).\n- Each transfer appears twice: once as an exit from origin store (Entrada=false) and once as an entry at destination (Entrada=true), matched by `Documento` number.\n- **BarrasAsociado** (64K rows) supplements `Articulos.CodigoBarra` by mapping multiple EAN barcodes to a single article (e.g., different size barcodes).\n- **SemiCodigo** (111K rows) is a large lookup for partial code resolution during scanning.\n- The **RFID** module (RFIDMovimientos, RFIDNumerosSerie, RFIDSinMovimiento) exists in the schema but is completely empty.\n- The **Logistics** module (Logistica, PackingList, LOGNivel1-3, LOGZonas) is defined but unused.\n- **Inventarios is empty, but that does NOT mean there are no inventories.** The annual physical count is recorded in `Traspasos` with `Tipo='Apertura'` dated 1 January: one row per store, article and **size**, carrying the counted units. It is valued at `Articulos.PrecioCoste`. This is the real inventory source for the business — 247,502 `Apertura` rows in the mirror (measured 2026-08). Do not conclude \"no inventory data exists\" from the empty `Inventarios` table.\n- **`Traspasos.Tipo` must be filtered in every stock-movement analysis.** `'Apertura'` (247,502 rows) and `'Inventario Parcial'` (739 rows) are inventory entries, not transfers, and together they are ~94% of the 262,724-row table. Without `WHERE tipo NOT IN ('Apertura', 'Inventario Parcial')` a \"transfer volume\" or \"busiest route\" query returns almost nothing but openings. The types that are genuine movement are `'Autoreposicion'` and `'Regularización'`.\n- **`Articulos.NoInventariabl = FALSE` is the mandatory filter for any inventory calculation.** Articles flagged `NoInventariabl` (bags, carriage, services, charges) are not merchandise and inflate both unit counts and valuation. The field exists in 4D `Articulos` but is **not mirrored** into `ps_articulos`, so it cannot be applied from PostgreSQL today — say so when reporting a valuation rather than silently omitting it. `ps_articulos.anulado = false` is the nearest available filter and is **not** equivalent.\n- Stock positions are primarily tracked in the **CCStock** table (Products domain), which uses a wide-format layout with stock quantities per size per store.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "Stock via Exportaciones (preferred for ETL)",
    "body": "The `Exportaciones` table (2,058,201 rows) is the preferred source for per-store, per-size stock in ETL and analytics. It was the export table used by the legacy VFP application and is actively maintained.\n\n**Structure (confirmed from `Exportaciones_SQL` view, 2026-04-05):** One row per (article, store) pair with a **34-slot size matrix**:\n- `Talla1..Talla34` — size label per slot (e.g. \"XS\", \"S\", \"M\", \"L\", \"XL\", \"40\", \"42\"...)\n- `Stock1..Stock34` — current stock quantity per size (**`_USER_COLUMNS`:** `DATA_TYPE = 3`, `DATA_LENGTH = 2` — **16-bit integer** in the 4D structure). Via **4D SQL / p4d**, negatives are often returned as **unsigned** (`65535` = `−1`); the ETL reinterprets before `ps_stock_tienda.stock`. Compare with the POS grid: per-size cells show signed values natively.\n- `Minimo1..Minimo34` — minimum stock quantity per size\n- `REPPorcentaje1..REPPorcentaje34` — replenishment percentage per size\n- `STStock` — **Real** (`DATA_TYPE = 6`) — secondary numeric field on the export row (legacy naming; not a substitute for slot-level analysis).\n- `CCStock` — **Real** (`DATA_TYPE = 6`) — **row-level net stock** for that `(Codigo, TiendaCodigo)` (matches the “TS” style total in POS when slots are signed). This is **not** the wide **`CCStock` table** in the Products domain (582 columns); same name, different object.\n- `Tienda` (store name), `TiendaCodigo` (composite key), `Codigo` (article code)\n- `FechaModifica`, `HoraModifica` — delta sync fields\n- `Ubicacion1`, `Ubicacion2`, `Ubicacion3` — warehouse location codes\n- `PuntoPedido`, `Recomendado`, `UnidadesReposi` — replenishment config\n- `REPPrioridadWeb` — web replenishment priority\n- `BORRAR5`, `BORRAR6`, `BORRAR7`, `BORRAR8`, `BORRAR9`, `BORRAR10`, `BORRAR12` — **deprecated columns, always ignore**\n\n> **Note on slot count:** Not all 34 slots are populated for every article. The number of active\n> slots is determined by the article's product family (`FamiGrupMarc.SerieTallas` field).\n> Clothing typically uses slots 1-17 (S/M/L/XL...), footwear and optics use all 34.\n> Empty slots have `Talla=''` and `Stock=0`.\n\n**Key gotcha — TiendaCodigo format:** The `TiendaCodigo` field is `\"tienda/articulo\"` (e.g. `\"104/169\"`), NOT just a store code. The compound `(Codigo, TiendaCodigo)` is the natural PK.\n\n**ETL normalization:** The wide format must be unpivoted to `(codigo, tienda_codigo, talla, stock)` rows for PostgreSQL. Filter out empty talla slots (`WHERE talla != ''`). Each `StockN` is decoded with `decode_signed_int16_word()` so SQL-layer unsigned values become signed integers. See [etl-sync-strategy.md](../etl-sync-strategy.md).",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30; CCStock added 2026-05-01.\n\n| Table | Rows | Delta field | Strategy |\n|-------|------|-------------|---------|\n| Exportaciones | 2,058,201 | `FechaModifica` (NULLs exist for zero-stock articles) | UPSERT delta + unpivot |\n| Traspasos | 262,689 | `FechaS` (send date — no FechaModifica) | Append-only by `FechaS` |\n| CCStock | 41,478 | None | Full refresh nightly → `ps_stock_central` |\n\n**Traspasos** is mostly historical: only 153 new rows since 2025-01-01. Records appear immutable once created. Append-only by `FechaS` is safe.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "CCStock (central warehouse stock) — confirmed 2026-05-01",
    "body": "`CCStock` is the central-warehouse stock matrix: one row per article (41 478 rows), 34 stock-slot columns (`Stock1..Stock34`). Confirmed field types via `_USER_COLUMNS`:\n\n- `NumArticulo` : `DATA_TYPE=6` (Real, 8 bytes) — PK (.99 suffix pattern)\n- `Stock` : `DATA_TYPE=6` (Real, 8 bytes) — row-level total maintained by 4D\n- `Stock1..Stock34` : **`DATA_TYPE=3, DATA_LENGTH=2` (16-bit WORD)** — same type as `Exportaciones.StockN`. The p4d driver returns unsigned values for negatives (`65535 = −1`). `decode_signed_int16_word()` is applied on each slot before summing.\n- `FechaModifica` : `DATA_TYPE=8` (Date)\n\n> **Important correction to issue #428 description**: The issue stated CCStock columns are \"Real (DATA_TYPE=6)\". This is TRUE for the root-level `Stock` column but FALSE for `Stock1..Stock34` which are int16 WORD (type 3, length 2) — confirmed by `_USER_COLUMNS` and live samples showing 65535 values. The ETL must apply `decode_signed_int16_word()` on these slots, the same as for `Exportaciones`.\n\n**Mirror**: `ps_stock_central` columns: `num_articulo NUMERIC(20,3) PK`, `stock INTEGER` (SUM of 34 decoded slots), `fecha_modifica DATE`. Full-refresh nightly; ~41 500 rows; no watermark needed.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_stock_tienda\",\n    \"alias\": \"StockTienda\",\n    \"description\": \"Stock por tienda y talla. tienda=99 es almacén central.\",\n    \"keyColumns\": [\"codigo (FK)\", \"tienda\", \"talla\", \"stock\", \"fecha_modifica\"]\n  },\n  {\n    \"table\": \"ps_traspasos\",\n    \"alias\": \"Traspaso\",\n    \"description\": \"Traspasos de stock. Cada movimiento = 2 filas (salida + entrada).\",\n    \"keyColumns\": [\"codigo (FK)\", \"tienda_salida\", \"tienda_entrada\", \"entrada\", \"unidades_s\", \"unidades_e\", \"fecha_s\", \"talla\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stock-logistics.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_stock_tienda\",  \"fromColumn\": \"codigo\",         \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_stock_tienda\",  \"fromColumn\": \"tienda\",         \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"tienda_salida\",  \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"tienda_entrada\", \"to\": \"ps_tiendas\",   \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_traspasos\",     \"fromColumn\": \"codigo\",         \"to\": \"ps_articulos\", \"toColumn\": \"codigo\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Articulos {\n        float RegArticulo PK \"Internal record ID\"\n        text Codigo \"Product code\"\n        text Descripcion \"Product description\"\n        text CodigoBarra \"Barcode (EAN)\"\n        text SKU \"Stock Keeping Unit\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n        float NumSubfamilia FK \"-> SubfamModelo\"\n        float NumDepartament FK \"-> DepaSeccFabr\"\n        float NumColor FK \"-> CCOPColores\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float NumMarca FK \"-> CCOPMarcTrat\"\n        float NumProveedor FK \"-> Proveedores\"\n        float Precio1 \"Retail price level 1\"\n        float Precio2 \"Retail price level 2\"\n        float PrecioCoste \"Cost price\"\n        float PrCosteNe \"Net cost price\"\n        float PIva \"VAT percentage\"\n        float Stock \"Total stock quantity\"\n        text Color \"Color name\"\n        text ClaveTemporada \"Season code\"\n        text ClaveMarca \"Brand code\"\n        text Modelo \"Model\"\n        text Sexo \"Gender target\"\n        boolean PActiva \"Price active flag\"\n        boolean Anulado \"Cancelled/disabled\"\n        date FechaCreacion \"Creation date\"\n        date FechaModifica \"Last modified\"\n        text Moneda \"Currency\"\n        float PrecioDivisa \"Foreign currency price\"\n    }\n\n    FamiGrupMarc {\n        float RegFamilia PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text FamiGrupMarc \"Family/group name\"\n        float Coeficiente1 \"Markup coefficient 1\"\n        float Coeficiente2 \"Markup coefficient 2\"\n        text CuentaVentas \"Sales account code\"\n        float Presupuesto \"Budget amount\"\n        boolean Anulado \"Disabled flag\"\n        text SerieTallas \"Size series\"\n        text ClaveSeccion \"Section code\"\n    }\n\n    SubfamModelo {\n        float RegSubfamilia PK \"Internal record ID\"\n        text SubfamModelo \"Subfamily/model name\"\n        text CuentaVentas \"Sales account code\"\n        float Coeficiente1 \"Markup coefficient\"\n    }\n\n    DepaSeccFabr {\n        float RegDepartament PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text DepaSeccFabr \"Department name\"\n        float JOIva \"Default VAT rate\"\n        float Presupuesto \"Budget\"\n        float Contador \"Counter\"\n        boolean Anulado \"Disabled flag\"\n    }\n\n    CCOPColores {\n        float RegColor PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text Color \"Color name\"\n        text WebIdioma1 \"Web label (lang 1)\"\n    }\n\n    CCOPTempTipo {\n        float RegTemporada PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text TemporadaTipo \"Season/type name\"\n        boolean TemporadaActiv \"Season is active\"\n        date InicioVentas \"Sales start date\"\n        date FinVentas \"Sales end date\"\n        date InicioRebajas \"Markdown start\"\n        date FinRebajas \"Markdown end\"\n    }\n\n    CCOPMarcTrat {\n        float RegMarca PK \"Internal record ID\"\n        text Clave \"Short code\"\n        text MarcaTratamien \"Brand name\"\n        float Presupuesto \"Budget\"\n        float DescuentoCompra \"Purchase discount %\"\n    }\n\n    CCStock {\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        float Stock \"Total stock\"\n        int Stock1 \"Stock size slot 1\"\n        int Stock2 \"Stock size slot 2\"\n        text Talla1 \"Size label slot 1\"\n        text Talla2 \"Size label slot 2\"\n        float PVP11 \"PVP store 1 size 1\"\n        float Compra1 \"Purchase cost size 1\"\n        int Minimo1 \"Minimum stock size 1\"\n    }\n\n    Articulos ||--o| FamiGrupMarc : \"NumFamilia -> RegFamilia\"\n    Articulos ||--o| SubfamModelo : \"NumSubfamilia -> RegSubfamilia\"\n    Articulos ||--o| DepaSeccFabr : \"NumDepartament -> RegDepartament\"\n    Articulos ||--o| CCOPColores : \"NumColor -> RegColor\"\n    Articulos ||--o| CCOPTempTipo : \"NumTemporada -> RegTemporada\"\n    Articulos ||--o| CCOPMarcTrat : \"NumMarca -> RegMarca\"\n    Articulos ||--|| CCStock : \"RegArticulo -> NumArticulo\"\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "Notes",
    "body": "- **Articulos** has 379 columns; most are repeating patterns for sizes (Medida1-20), prices (Precio1-15), markdowns (Rebajas1-15), coefficients (Coef1-15), and multilingual descriptions (Idioma1-10).\n- **CCStock** uses a wide-format layout with 582 columns: `Stock1..Stock34` (stock per size slot), `Talla1..Talla34` (size labels), `PVP1..PVP7 x 34` (prices per tariff per size), `Minimo1..Minimo34`, `Compra1..Compra34`, `Rebaja1..Rebaja2 x 34`, `Ubicacion1..Ubicacion3 x 34`, and `Anulada1..Anulada34`.\n- Classification hierarchy: **DepaSeccFabr** (department) -> **FamiGrupMarc** (family) -> **SubfamModelo** (subfamily). Cross-classified by **CCOPMarcTrat** (brand), **CCOPTempTipo** (season), and **CCOPColores** (color).\n- Related tables in other domains: `Proveedores` (purchasing), `LineasVentas` and `GCLinAlbarane` reference `NumArticulo`.",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "FamiGrupMarc Field Groups",
    "body": "> Confirmed 2026-04-05 from `_USER_COLUMNS` (112 columns total, 78 rows in production).\n\n| Group | Fields | Purpose |\n|-------|--------|---------|\n| Identity | `RegFamilia` (PK), `Clave`, `FamiGrupMarc`, `CodigoGenerico`, `Codigo1..Codigo6` | Family ID and short codes |\n| Accounting | `CuentaVentas`, `CuentaVentas2`, `Presupuesto`, `Comision`, `Coeficiente1..Coeficiente4` | Sales accounts, budget, markup |\n| Section/Dept | `ClaveSeccion`, `Seccion1..Seccion6`, `SerieEmpresa` | Cross-reference to DepaSeccFabr sections |\n| Size series | `SerieTallas` | **Dead end — not the size series source.** Blank in all 78 production rows, and structurally wrong: the series hangs off the *article*, via `Articulos.ClaveSerie` → `CCOPSeriCali.Clave`. See the gotcha below. |\n| Promotions | `PrecioPromocion`, `PorcenPromocion`, `PromoDesde`, `PromoHasta`, `UnidadPromocion`, `ValeCliente` | Promotional pricing |\n| Web/Commerce | `NoPSCloud`, `NoPSCommerce`, `NoPSCommerceM`, `PathPSCloud`, `WebIdioma1..WebIdioma5`, `Weborden` | E-commerce visibility |\n| Brand integrations | `CATAdidasMat1..10` (Adidas material codes), `CATNikeModel21/22`, `CATNikeStyleC1..3` | Third-party catalog mapping |\n| Volume/loyalty | `VolumenImporte`, `VolumenNumero`, `VolumenPorcen`, `VolumenVale`, `GrupoClientes` | Volume discount and loyalty rules |\n| Unit pricing | `Unidades1..Unidades6`, `Unidad1Imp..Unidad3Imp`, `Unidad1Por..Unidad3Por`, `UsarPVPUnidad2`, `STUnidad2` | Multi-unit pricing (e.g., pairs, sets) |\n| Stock special | `ST2X1`, `STVolumen`, `OPIncremento`, `NoPSCloud`, `AenaEsRentaUni`, `AenaRentaConIVA` | Stock/rental special rules |\n| Free fields | `Libre01..Libre10` | Custom use |\n| Metadata | `FModifica`, `HModifica`, `Anulado`, `Contador`, `Historico1..Historico4`, `CorrectorMDV` | Admin fields |\n\n> **Key gotcha — the size series is `Articulos.ClaveSerie`, not `FamiGrupMarc.SerieTallas`.**\n> The canonical definition of an article's size run is:\n> **`Articulos.ClaveSerie` → `CCOPSeriCali.Clave` → `CCOPSeriCali.Talla1..Talla34`** (that table has 219 columns; the 34 `Talla*` slots hold the size labels).\n>\n> `FamiGrupMarc.SerieTallas` is blank in all 78 production rows — but \"it's blank\" was the wrong reason to close this question. The field is not merely unpopulated, it is at the wrong grain: the series belongs to the **article**, not the family, so two articles in the same family can carry different size runs. An earlier revision of this file concluded \"use the literal labels from `Exportaciones`/`GCLinPedidos`\" and stopped there, which works by accident for those two tables and leaves you with no answer for any article that does not appear in them.\n>\n> Neither `Articulos.ClaveSerie` nor `CCOPSeriCali` is mirrored into PostgreSQL. For queries against the mirror the size labels do already come resolved in `ps_stock_tienda.talla` and `ps_traspasos.talla` — use those. Go to `ClaveSerie` → `CCOPSeriCali` when working against 4D directly, or when you need an article's full size run including sizes it has no stock rows for.\n\n> **Key gotcha — `CCRefeJOFACM` is reference+colour, not the model.** The last 2 characters are the colour code. Grouping a \"top articles\" ranking by `ccrefejofacm` splits one model across several rows: production holds 42,244 distinct `ccrefejofacm` values against only 19,941 models — 2.12 colours per model on average (measured 2026-08). A model that sells well can miss the top-N entirely because its volume is spread over its colours. Group by `LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2)` to rank by model. Real example: `75221411`, `75221420`, `75221421`, `75221470`, `75221490`, `75221496` are six colours of model `752214`. Use the raw `ccrefejofacm` only when the colour breakdown is what was actually asked for.\n\n> **Brand integrations:** `CATAdidasMat1..10` and `CATNikeModel/Style` fields map product families to Adidas and Nike catalog codes for data feed exports. These are the \"ADIDAS data feeds\" and \"corners/concessions\" modules discove",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_articulos\",\n    \"alias\": \"Producto\",\n    \"description\": \"Catálogo de productos. ccrefejofacm=Referencia REFERENCIA+COLOR (los 2 ultimos caracteres son el color): para rankear por MODELO agrupar por LEFT(ccrefejofacm, LENGTH(ccrefejofacm)-2). M=mayorista, MA=material (excluido del ETL).\",\n    \"keyColumns\": [\"reg_articulo (PK)\", \"codigo\", \"ccrefejofacm (Referencia = modelo+color; NO es el modelo)\", \"descripcion\", \"num_familia (FK)\", \"num_departament (FK)\", \"num_color (FK)\", \"num_temporada (FK)\", \"num_marca (FK)\", \"precio_coste\", \"p_iva\", \"anulado\", \"fecha_creacion\", \"clave_temporada\", \"modelo\", \"sexo\"]\n  },\n  {\n    \"table\": \"ps_familias\",\n    \"alias\": \"Familia\",\n    \"description\": \"Familias/grupos de productos.\",\n    \"keyColumns\": [\"reg_familia (PK)\", \"fami_grup_marc\"]\n  },\n  {\n    \"table\": \"ps_departamentos\",\n    \"alias\": \"Departamento\",\n    \"description\": \"Departamentos/secciones.\",\n    \"keyColumns\": [\"reg_departament (PK)\", \"depa_secc_fabr\"]\n  },\n  {\n    \"table\": \"ps_colores\",\n    \"alias\": \"Color\",\n    \"description\": \"Catálogo de colores.\",\n    \"keyColumns\": [\"reg_color (PK)\", \"color\"]\n  },\n  {\n    \"table\": \"ps_temporadas\",\n    \"alias\": \"Temporada\",\n    \"description\": \"Temporadas y tipos.\",\n    \"keyColumns\": [\"reg_temporada (PK)\", \"temporada_tipo\"]\n  },\n  {\n    \"table\": \"ps_marcas\",\n    \"alias\": \"Marca\",\n    \"description\": \"Marcas de producto.\",\n    \"keyColumns\": [\"reg_marca (PK)\", \"marca\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/products.md",
    "heading": "LLM:relationships",
    "body": "```json\n[\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_familia\", \"to\": \"ps_familias\", \"toColumn\": \"reg_familia\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_departament\", \"to\": \"ps_departamentos\", \"toColumn\": \"reg_departament\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_color\", \"to\": \"ps_colores\", \"toColumn\": \"reg_color\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_temporada\", \"to\": \"ps_temporadas\", \"toColumn\": \"reg_temporada\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_articulos\", \"fromColumn\": \"num_marca\", \"to\": \"ps_marcas\", \"toColumn\": \"reg_marca\", \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    Clientes {\n        float RegCliente PK \"Internal record ID\"\n        text Cliente \"Customer name\"\n        float Codigo \"Customer code\"\n        text CIF \"Tax ID (NIF/CIF)\"\n        text Direccion \"Billing address\"\n        text Poblacion \"City\"\n        text Provincia \"Province\"\n        text Postal \"Postal code\"\n        text Telefono \"Phone\"\n        text Telefono2 \"Phone 2\"\n        text Movil \"Mobile\"\n        text Fax \"Fax\"\n        text DireccionE \"Shipping address\"\n        text PoblacionE \"Shipping city\"\n        text ProvinciaE \"Shipping province\"\n        text PostalE \"Shipping postal code\"\n        text FormaPago \"Payment method\"\n        float PDescCom \"Commercial discount %\"\n        float ImpTarjetaPuntos \"Loyalty card points\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean LlevaRE \"Subject to surcharge\"\n        boolean BloqueoFinancials \"Financial block\"\n        int RiesgoConcedid \"Credit limit\"\n        text Tienda \"Home store code\"\n        float NumComercial FK \"-> GCComerciales.RegComercial\"\n        text Transportista \"Default carrier\"\n        text Contacto1 \"Contact person\"\n        text Marketing1 \"Marketing segment 1\"\n        text Marketing2 \"Marketing segment 2\"\n        date FechaCreacion \"Creation date\"\n        date FechaModifica \"Last modified\"\n    }\n\n    TiposClientes {\n        text TipoCliente \"Client type name\"\n    }\n\n    GrupoClientes {\n        text GrupoCliente \"Client group name\"\n    }\n\n    OPClientes {\n        text Descripcion \"Optical client data\"\n    }\n\n    GCComerciales {\n        float RegComercial PK \"Sales rep record ID\"\n        text Comercial \"Sales rep name\"\n        text ZonaComercial \"Commercial zone\"\n        float Comision1 \"Commission rate 1\"\n    }\n\n    Ventas {\n        float RegVentas PK \"Sale record ID\"\n        float NumCliente FK \"-> Clientes\"\n        text Cliente \"Customer name\"\n    }\n\n    GCAlbaranes {\n        float RegAlbaran PK \"Delivery note ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    GCFacturas {\n        float RegFactura PK \"Invoice ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    CobrosFacturas {\n        float RegCobroRefAde PK \"Collection record ID\"\n        float NumCliente FK \"-> Clientes\"\n    }\n\n    Clientes }o--|| GCComerciales : \"NumComercial -> RegComercial\"\n    Clientes ||--o{ Ventas : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ GCAlbaranes : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ GCFacturas : \"RegCliente -> NumCliente\"\n    Clientes ||--o{ CobrosFacturas : \"RegCliente -> NumCliente\"\n```",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "Notes",
    "body": "- **Clientes** has 311 columns including: multiple address sets (billing, shipping, invoicing), up to 12 payment installment fields, bank details (Banco, Agencia, CuentaCorriente, IBAN, BIC), risk management (RiesgoConcedid, BloqueoFinancials), loyalty (ImpTarjetaPuntos), and extensive CRM fields.\n- The same `Clientes` table serves both retail POS customers (linked via `Ventas.NumCliente`) and wholesale clients (linked via `GCAlbaranes.NumCliente`, `GCFacturas.NumCliente`).\n- **Customer segmentation is `TipoCliente`, and none of it is mirrored.** 4D `Clientes` has both a `Mayorista` boolean and a `TipoCliente` text field; the one that actually segments the business is **`TipoCliente`** (uppercase text: `'FRANQUICIADO INTERNO'`, `'FRANQUICIADO'`, `'MAYORISTA'`, `'MINORISTA'`). **Neither field is synced into `ps_clientes`** — the mirror has only `reg_cliente, num_cliente, nombre, nif, email, codigo_postal, poblacion, pais, fecha_creacion, fecha_modifica, ultima_compra_f`. A query against the mirror using `mayorista` fails outright with *column does not exist*; segment by **channel** instead (present in `ps_ventas` ⇒ retail, present in `ps_gc_albaranes`/`ps_gc_facturas` ⇒ wholesale). A customer can legitimately be in both. `B2B1..B2B4Provisional` flags track provisional B2B portal access levels.\n- **GCComerciales** links customers to sales representatives via `Clientes.NumComercial -> GCComerciales.RegComercial`.\n- **Optical module**: `Medida1..Medida26` + `MedidaT1..MedidaT26` store 26 optical prescription measurements per customer (eyeglass prescriptions). Label slots (MedidaT*) contain measurement names.\n- **Wapping**: `Wapping_ID` links the customer to the Wapping omnichannel loyalty platform.\n- **GDPR**: `PoliticaPrivacidad` (policy accepted), `FAcceptaComuni` (date accepted communications), `FAcceptaPP` (date accepted privacy policy) are GDPR consent fields — required for marketing.\n- The CRM module (CRMCampañas, CRMVisitados, etc.) exists in the schema but is completely empty.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/customers.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_clientes\",\n    \"alias\": \"Cliente\",\n    \"description\": \"Clientes. num_cliente=0 son ventas anónimas. NO tiene campo mayorista ni tipo_cliente: segmentar por canal (ps_ventas = retail, ps_gc_albaranes/ps_gc_facturas = mayorista). nif = 502108150 marca sociedades del propio grupo (19 registros).\",\n    \"keyColumns\": [\"reg_cliente (PK)\", \"num_cliente\", \"nombre\", \"nif\", \"email\", \"codigo_postal\", \"poblacion\", \"pais\", \"fecha_creacion\", \"fecha_modifica\", \"ultima_compra_f\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Entity Relationship Diagram",
    "body": "```mermaid\nerDiagram\n    GCPedidos {\n        float RegPedido PK \"Order record ID\"\n        float NPedido \"Order number\"\n        date FechaPedido \"Order date\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        float NumComercial FK \"-> GCComerciales\"\n        text Comercial \"Sales rep name (denorm)\"\n        float TotalPedido \"Order total\"\n        float ImporteBruto \"Gross amount\"\n        float Unidades \"Total units\"\n        float Entregadas \"Units delivered\"\n        float Pendientes \"Units pending\"\n        text FormaPago \"Payment method\"\n        int Tarifa \"Price list used\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean LlevaRE \"Subject to surcharge\"\n        text Temporada \"Season name\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        text TiendaAlmacen \"Warehouse/store\"\n        boolean PedidoCerrado \"Order closed\"\n        boolean Abono \"Is credit note\"\n        boolean Presupuesto \"Is quote\"\n    }\n\n    GCLinPedidos {\n        float RegLinea PK \"Line record ID\"\n        float NumPedido FK \"-> GCPedidos.RegPedido\"\n        float NumArticulo FK \"-> Articulos.RegArticulo\"\n        text Codigo \"Article code (denorm)\"\n        text Descripcion \"Description (denorm)\"\n        float PrecioBruto \"Gross unit price\"\n        float PrecioNeto \"Net unit price\"\n        float Unidades \"Qty ordered (total)\"\n        float Entregadas \"Qty delivered (total)\"\n        float Pendientes \"Qty pending\"\n        float Asignadas \"Warehouse allocated (total)\"\n        float Total \"Line total\"\n        float TotalNeto \"Net total\"\n        float PIva \"VAT %\"\n        text Lote \"Lot/batch\"\n        text TipoP \"Order type\"\n        text ClaveTemporada \"Season key\"\n        text Modelo \"Model code\"\n        float NumFamilia FK \"-> FamiGrupMarc\"\n        float NumDepartament FK \"-> DepaSeccFabr\"\n        float NumTemporada FK \"-> CCOPTempTipo\"\n        float NumMarca FK \"-> CCOPMarcTrat\"\n        float NumColor FK \"-> CCOPColores\"\n        int Talla1_34 \"34 size label slots (TALLA1..TALLA34)\"\n        int Pedidas1_34 \"34 ordered qty slots (PEDIDAS1..PEDIDAS34)\"\n        int Entregadas1_34 \"34 delivered qty slots (ENTREGADAS1..ENTREGADAS34)\"\n        int Asignadas1_34 \"34 warehouse-allocated slots (ASIGNADAS1..ASIGNADAS34)\"\n        int Original1_34 \"34 original order qty slots (ORIGINAL1..ORIGINAL34)\"\n    }\n\n    GCAlbaranes {\n        float RegAlbaran PK \"Delivery note record ID\"\n        float NAlbaran \"Delivery note number\"\n        date FechaEnvio \"Shipping date\"\n        float NumCliente FK \"-> Clientes.RegCliente\"\n        text Cliente \"Customer name (denorm)\"\n        float NumComercial FK \"-> GCComerciales\"\n        text Comercial \"Sales rep (denorm)\"\n        text Transportista \"Carrier name\"\n        float TotalAlbaran \"Total amount\"\n        float ImporteBruto \"Gross amount\"\n        float Unidades \"Total units\"\n        text FormaPago \"Payment method\"\n        int Tarifa \"Price list used\"\n        int SerieF \"Invoice series\"\n        boolean LlevaIva \"Subject to VAT\"\n        boolean Abono \"Is credit note\"\n        boolean Deposito \"Is deposit/consignment\"\n        text TiendaAlmacen \"Warehouse/store\"\n        text Temporada \"Season name\"\n        text TrackingNumber \"Carrier tracking number\"\n        text TrackingInfo \"Tracking status info\"\n        text TrackingURL \"Carrier tracking URL\"\n        date TrackingFEntrega \"Delivery date from carrier\"\n        date TrackingFEnvio \"Shipment date from carrier\"\n        text IntegradorMK \"Marketplace integrator code\"\n        text Marketplace \"Marketplace name (e-commerce)\"\n        text IDOrderMarket \"Marketplace order ID\"\n        text CarrierTipoEnvio \"Carrier shipment type\"\n        text IDSendCloud \"SendCloud shipment ID\"\n        float JoPorPesoUni \"Jewelry: price-per-gram unit\"\n        float JoConversion \"Jewelry: weight conversion factor\"\n        float PesoJoGramos \"Jewelry: item weight in grams\"\n        float JoGramosTotal \"Jewelry: total grams for line\"\n    }\n\n    GCLinAlbarane {",
    "hasSql": false,
    "dialect": "n/a"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Notes",
    "body": "- The wholesale flow follows a standard document chain: **Order -> Delivery Note -> Invoice -> Collection**.\n- **GCLinAlbarane** (1M+ rows) is the primary source for wholesale sales analytics, carrying full product classification (family, department, season, brand, color) denormalized for reporting.\n- **GCLinFacturas** closely mirrors GCLinAlbarane but at the invoice level. Both carry `Mes` (YYYYMM) for period filtering.\n- All header tables (GCPedidos, GCAlbaranes, GCFacturas) link to `Clientes` via `NumCliente` and to `GCComerciales` via `NumComercial`.\n- **GCLinPedidos** is the widest wholesale table (239 columns) due to the 5-dimension × 34-slot size matrix.\n- **Wholesale also handles e-commerce**: GCAlbaranes has Marketplace, IDOrderMarket, and IntegradorMK fields — same pattern as retail Ventas. Discovered 2026-04-05.\n- **Jewelry weight-based pricing**: GCAlbaranes has JoPorPesoUni, JoConversion, PesoJoGramos, JoGramosTotal — indicates the business sells jewelry priced by weight in the wholesale channel. Discovered 2026-04-05.\n- **Effective date of a delivery note = `FechaEnvio` if `>= 2000-01-01`, else `FechaValor`.** Not-yet-shipped notes carry a NULL or pre-2000 sentinel in `FechaEnvio`, so filtering a period on `fecha_envio` alone drops them silently. Use `CASE WHEN a.fecha_envio >= DATE '2000-01-01' THEN a.fecha_envio ELSE a.fecha_valor END`. Mirror impact today is 1 row out of 52,148 (measured 2026-08), but the sentinel reappears as soon as pending notes sync, so the pattern is mandatory rather than optional.\n- **CIF `502108150` marks intra-group traffic.** That tax ID (LINFE LDA / MHIA, Portugal) belongs to the group's own companies and is spread across **19 distinct `ps_clientes` rows** with different `num_cliente` *and different names* (LINFE FUNCHAL, LINFE FACTORY, MHIA CALDAS, MHIA TOMAR, MHIA ABRANTES, Linfe Moda Feminina Lda…). A wholesale delivery note or invoice to that CIF is **not a sale outside the group** — it is an internal movement. Exclude it by NIF, never by name: `JOIN ps_clientes c ON a.num_cliente = c.reg_cliente WHERE COALESCE(c.nif,'') <> '502108150'`. In 2026 it accounts for 38 delivery notes and ~€29,900.",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "Query pattern",
    "body": "To aggregate size-level quantities, unpivot the 34 slots in PostgreSQL:\n```sql\n-- Example: total units per size across all delivery note lines\nSELECT size_slot, SUM(qty_delivered) AS units\nFROM ps_gc_lin_albarane\nCROSS JOIN LATERAL (VALUES\n  (talla1, entregadas1), (talla2, entregadas2), ... (talla34, entregadas34)\n) AS t(size_slot, qty_delivered)\nWHERE size_slot IS NOT NULL AND qty_delivered > 0\nGROUP BY size_slot\nORDER BY units DESC;\n```\nThis is expensive on 1M rows — add a `WHERE numalbaran IN (...)` filter when possible.",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "ETL Sync Strategy",
    "body": "> Validated against production data 2026-03-30.\n\n| Table | Rows | Delta field | Strategy |\n|-------|------|-------------|---------|\n| GCAlbaranes | 48,948 | `Modifica` (~19 modified/day, ~833/month) | UPSERT delta |\n| GCLinAlbarane | 1,016,290 | **None** | Delete+reinsert via parent `Modifica` |\n| GCFacturas | 18,060 | `Modifica` (all rows populated) | UPSERT delta |\n| GCLinFacturas | 974,742 | **None** | Delete+reinsert via parent `Modifica` |\n| GCPedidos | 101 | `Modifica` | Full refresh (trivially small) |\n| GCLinPedidos | 2,645 | None | Full refresh (trivially small) |\n\n**Lines delta pattern** (no modification timestamp on line tables):\n```sql\n-- Fetch lines for recently changed delivery notes.\n-- The parent key is the 4D record ID (RegAlbaran), never the visible NAlbaran.\nSELECT * FROM GCLinAlbarane\nWHERE NumAlbaran IN (SELECT RegAlbaran FROM GCAlbaranes WHERE Modifica >= :last_sync)\n-- → DELETE + INSERT in PostgreSQL for those RegAlbaran values\n```\n\n**Line → header join key (corrected 2026-08-29):**\nDespite the `Num` prefix, the line tables carry the parent's **4D record ID**:\n- `GCLinAlbarane.NumAlbaran` → `GCAlbaranes.RegAlbaran` (4000/4000 on a production sample)\n- `GCLinFacturas.NumFactura` → `GCFacturas.RegFactura` (4000/4000)\n\nThe *visible* document numbers are the wrong key on both counts:\n`GCLinFacturas.NumFactura` matches `GCFacturas.NFactura` **0/4000**, and neither\nvisible number is unique (52,148 GCAlbaranes rows carry 40,727 distinct\n`NAlbaran` values; 19,351 GCFacturas rows carry 14,515 distinct `NFactura`\nvalues), so joining on them mixes lines from unrelated documents.  The ETL used\nthe visible numbers until 2026-08-29: the invoice-line delta re-inserted 0 rows\non every nightly run, and the mirror had drifted 1,873 invoice lines and 3,826\ndelivery-note lines behind 4D.\n\nSee [etl-sync-strategy.md](../etl-sync-strategy.md) for the full sync plan.\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "LLM:tables",
    "body": "```json\n[\n  {\n    \"table\": \"ps_gc_albaranes\",\n    \"alias\": \"AlbaranMayorista\",\n    \"description\": \"Albaranes mayorista. Importe neto = base1 + base2 + base3. Fecha efectiva = fecha_envio si >= 2000-01-01, si no fecha_valor. abono=true son devoluciones del cliente (entrada de stock), abono=false son envios.\",\n    \"keyColumns\": [\"reg_albaran (PK)\", \"n_albaran\", \"num_cliente (FK)\", \"num_comercial (FK)\", \"fecha_envio (usar con fecha_valor como fallback)\", \"fecha_valor\", \"base1\", \"base2\", \"base3\", \"entregadas\", \"abono\", \"temporada\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_albarane\",\n    \"alias\": \"LineaAlbaranMayorista\",\n    \"description\": \"Líneas de albarán mayorista.\",\n    \"keyColumns\": [\"n_albaran (FK)\", \"codigo\", \"unidades\", \"total\"]\n  },\n  {\n    \"table\": \"ps_gc_facturas\",\n    \"alias\": \"FacturaMayorista\",\n    \"description\": \"Facturas mayorista. Importe neto = base1 + base2 + base3.\",\n    \"keyColumns\": [\"reg_factura (PK)\", \"n_factura\", \"fecha_factura\", \"num_cliente (FK)\", \"num_comercial (FK)\", \"base1\", \"base2\", \"base3\", \"abono\", \"total_factura (CON IVA)\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_facturas\",\n    \"alias\": \"LineaFacturaMayorista\",\n    \"description\": \"Líneas de factura mayorista.\",\n    \"keyColumns\": [\"num_factura (FK)\", \"codigo\", \"unidades\", \"total\", \"total_coste\"]\n  },\n  {\n    \"table\": \"ps_gc_pedidos\",\n    \"alias\": \"PedidoMayorista\",\n    \"description\": \"Pedidos mayorista.\",\n    \"keyColumns\": [\"reg_pedido (PK)\", \"num_cliente (FK)\"]\n  },\n  {\n    \"table\": \"ps_gc_lin_pedidos\",\n    \"alias\": \"LineaPedidoMayorista\",\n    \"description\": \"Líneas de pedido mayorista.\",\n    \"keyColumns\": [\"num_pedido (FK)\", \"codigo\", \"unidades\"]\n  },\n  {\n    \"table\": \"ps_gc_comerciales\",\n    \"alias\": \"Comercial\",\n    \"description\": \"Comerciales/agentes de ventas mayorista.\",\n    \"keyColumns\": [\"reg_comercial (PK)\", \"comercial\"]\n  }\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/wholesale.md",
    "heading": "LLM:relationships",
    "body": "<!--\nLAS LÍNEAS SE UNEN POR EL ID DE REGISTRO 4D, NUNCA POR EL NÚMERO VISIBLE.\n\n`Num*` en una tabla de líneas apunta al `Reg*` de su cabecera (el ID interno de\n4D), NO al `N*` (el número que ve el usuario en el documento). Los nombres\ninducen a error justo al revés de lo que parece.\n\nMedido contra el 4D de producción sobre muestras de 2.000-4.000 líneas:\n\n  GCLinFacturas.NumFactura -> RegFactura  4000/4000   -> NFactura  0/4000\n  GCLinAlbarane.NumAlbaran -> RegAlbaran  4000/4000   -> NAlbaran  0/4000\n  GCLinPedidos.NumPedido   -> RegPedido   2000/2000   -> NPedido   0/2000\n\nY los números visibles NO son únicos (40.727 NAlbaran distintos para 52.148\nalbaranes; 76 NPedido para 120 pedidos), así que unir por ellos además mezcla\nlíneas de documentos distintos.\n\nEste fichero declaraba las tres relaciones al revés. Consecuencia real: el ETL\nmayorista perdió 5.699 líneas y toda consulta mayorista que generase el\ndashboard salía vacía o se multiplicaba.\n-->\n\n```json\n[\n  {\"from\": \"ps_gc_lin_albarane\", \"fromColumn\": \"num_albaran\", \"to\": \"ps_gc_albaranes\",   \"toColumn\": \"reg_albaran\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_lin_facturas\", \"fromColumn\": \"num_factura\", \"to\": \"ps_gc_facturas\",    \"toColumn\": \"reg_factura\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_albaranes\",    \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_facturas\",     \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_albaranes\",    \"fromColumn\": \"num_comercial\", \"to\": \"ps_gc_comerciales\", \"toColumn\": \"reg_comercial\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_facturas\",     \"fromColumn\": \"num_comercial\", \"to\": \"ps_gc_comerciales\", \"toColumn\": \"reg_comercial\", \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_pedidos\",      \"fromColumn\": \"num_cliente\", \"to\": \"ps_clientes\",       \"toColumn\": \"reg_cliente\",  \"type\": \"MANY_TO_ONE\"},\n  {\"from\": \"ps_gc_lin_pedidos\",  \"fromColumn\": \"num_pedido\",  \"to\": \"ps_gc_pedidos\",     \"toColumn\": \"reg_pedido\",   \"type\": \"MANY_TO_ONE\"}\n]\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/architecture/stores-hr.md",
    "heading": "Notes",
    "body": "- **Tiendas** has 208 columns (via `Tiendas_SQL` view) covering store identity, multi-register config, franchise data, fiscal settings, web/commerce flags, airport concession financials, and operational parameters. Column count corrected from 209 to 208 on 2026-04-05.\n- **Exportaciones** (2M+ rows) is the largest table by row count -- it logs all data synchronization events between stores and the central server.\n- **RRHHEmpleados** includes per-module access flags (PDFuturShop, PDWarehouse, PDFinancials, PDCommerce, PDAdministrador, etc.) acting as a permission system.\n- The full HR module (RRHH*) has 17+ tables but only RRHHEmpleados (15 rows) and RRHHAcceso (937 rows) contain data. The rest of the HR functionality is unused.\n- **Vales** (54K rows) tracks vouchers/store credit across stores, with both issuance and redemption tracked by store.\n- **FormasPago** is a shared lookup used by POS, wholesale, and purchasing modules. Has 30 columns including 12 payment installment slots (`VP1..VP12`), bank remittance flags, Datisa ERP integration code (`CodigoDatisa`), and wholesale-specific flags (`GCDPP`, `GCSinImpuestos`). Referenced as `FormaPago` FK from Clientes, Ventas, GCPedidos, GCFacturas.\n- **AENA_* fields** are only populated for stores operating inside airports under AENA concessions — null for all regular stores.\n- The `CON*` accounting fields map store transactions to the chart of accounts in the connected accounting ERP. Each store can have a different account structure.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "16-bit integers over SQL (`DATA_TYPE = 3`, `DATA_LENGTH = 2`)",
    "body": "`_USER_COLUMNS` reports **16-bit integer** fields (type **3**, length **2**) — e.g. all **`Exportaciones.Stock1`…`Stock34`** (34 columns, each type 3 / length 2 in production).\n\n- **Native 4D** (forms, compiled methods, `WORD` variables) keeps **signed** semantics: `−1` stays `−1`.\n- **4D SQL + p4d** can still return the same bit pattern widened as an **unsigned** 32-bit value, so **`−1` appears as `65535`**, **`−2` as `65534`**, etc. The **`CCStock`** column on the same row is **`DATA_TYPE = 6` (Real)** and continues to show the correct **row-level net** (e.g. `−6.0`), which is why the POS grid matches **`CCStock`** while raw **`StockN`** look “huge” until reinterpreted.\n\n**ETL fix:** `etl/db/fourd.py` → `decode_signed_int16_word()` — applied **only** when unpivoting **`Exportaciones.Stock1`…`Stock34`**, because **`_USER_COLUMNS`** marks those columns as **type 3 / length 2** only. There is **no `p4d.connect()` flag** to force signed 16-bit decoding.\n\n**Do not** apply this decode to **Real** columns (type **6**) or to any column that is not **type 3 / length 2** in `_USER_COLUMNS`: wholesale line quantities can exceed **32767** and would be mis-decoded as negative if the int16 rule were applied blindly.",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Full Syntax",
    "body": "```sql\nSELECT [ALL | DISTINCT]\n  {* | select_item, ..., select_item}\nFROM table_reference, ..., table_reference\n[WHERE search_condition]\n[GROUP BY sort_list]\n[HAVING search_condition]\n[ORDER BY sort_list]\n[LIMIT {int_number | ALL}]\n[OFFSET int_number]\n[INTO {4d_variable, ..., 4d_variable}]\n[FOR UPDATE]\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Key Clauses",
    "body": "**DISTINCT** -- eliminates duplicate rows:\n```sql\nSELECT DISTINCT Tienda FROM LineasVentas\n```\n\n**Aliases** -- use `AS` (optional keyword):\n```sql\nSELECT Codigo AS product_code, Descripcion AS name FROM Articulos\nSELECT a.Codigo, f.FamiGrupMarc\n  FROM Articulos a, FamiGrupMarc f\n  WHERE a.NumFamilia = f.RegFamilia\n```\n\n**ORDER BY** -- ascending (default) or descending; can reference column position:\n```sql\nSELECT Codigo, Descripcion FROM Articulos ORDER BY Descripcion ASC\nSELECT Tienda, COUNT(*) FROM LineasVentas GROUP BY Tienda ORDER BY 2 DESC\n```\n\n**LIMIT / OFFSET** -- row limiting (works like standard SQL):\n```sql\nSELECT Codigo, Descripcion FROM Articulos LIMIT 10\nSELECT Codigo, Descripcion FROM Articulos LIMIT 10 OFFSET 20\n```\n\n**GROUP BY / HAVING**:\n```sql\nSELECT Tienda, SUM(Total) AS revenue\n  FROM LineasVentas\n  WHERE Mes = 202501\n  GROUP BY Tienda\n  HAVING SUM(Total) > 1000\n  ORDER BY revenue DESC\n```\n\n**Subqueries** -- supported in WHERE and FROM:\n```sql\nSELECT Codigo, Descripcion FROM Articulos\n  WHERE RegArticulo IN (\n    SELECT NumArticulo FROM LineasVentas WHERE Mes = 202501\n  )\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "LIKE Predicate",
    "body": "Uses `%` (any sequence of characters) and `_` (any single character):\n\n```sql\n-- Products starting with \"CAMISA\"\nSELECT Codigo, Descripcion FROM Articulos WHERE Descripcion LIKE 'CAMISA%'\n\n-- Products with \"TEJANO\" anywhere in description\nSELECT Codigo, Descripcion FROM Articulos WHERE Descripcion LIKE '%TEJANO%'\n\n-- NOT LIKE\nSELECT Codigo FROM Articulos WHERE Codigo NOT LIKE '7%'\n\n-- ESCAPE clause for literal % or _\nSELECT * FROM Articulos WHERE Descripcion LIKE '%10\\%%' ESCAPE '\\'\n```\n\n**Important**: 4D SQL string comparison is **case-sensitive by default**. `'camisa'` will NOT match `'CAMISA'`. Use `UPPER()` or `LOWER()` for case-insensitive matching:\n```sql\nWHERE UPPER(Descripcion) LIKE '%CAMISA%'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "IN Predicate",
    "body": "```sql\nSELECT * FROM Tiendas WHERE Codigo IN ('99', '104', '121')\nSELECT Codigo, Descripcion FROM Articulos\n  WHERE NumFamilia IN (SELECT RegFamilia FROM FamiGrupMarc WHERE Clave = '10')\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "BETWEEN Predicate",
    "body": "```sql\nSELECT Codigo, Precio1 FROM Articulos WHERE Precio1 BETWEEN 10.0 AND 50.0\nSELECT * FROM Ventas WHERE FechaCreacion BETWEEN '2025-01-01' AND '2025-01-31'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "IS NULL / IS NOT NULL",
    "body": "```sql\nSELECT Codigo FROM Articulos WHERE CodigoBarra IS NULL\nSELECT Codigo FROM Articulos WHERE CodigoBarra IS NOT NULL\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Supported Join Types",
    "body": "4D supports both implicit (comma) and explicit JOIN syntax.\n\n**Implicit Inner Join (comma syntax)**:\n```sql\nSELECT lv.Codigo, lv.Descripcion, v.FechaCreacion, v.Total\n  FROM LineasVentas lv, Ventas v\n  WHERE lv.NumVentas = v.RegVentas\n```\n\n**Explicit INNER JOIN**:\n```sql\nSELECT a.Codigo, a.Descripcion, f.FamiGrupMarc AS familia\n  FROM Articulos a\n  INNER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n```\n\n**LEFT OUTER JOIN**:\n```sql\nSELECT a.Codigo, a.Descripcion, f.FamiGrupMarc\n  FROM Articulos a\n  LEFT OUTER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n```\n\n**RIGHT OUTER JOIN**:\n```sql\nSELECT a.Codigo, f.FamiGrupMarc\n  FROM Articulos a\n  RIGHT OUTER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n```\n\n**FULL OUTER JOIN**:\n```sql\nSELECT a.Codigo, f.FamiGrupMarc\n  FROM Articulos a\n  FULL OUTER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n```\n\n**CROSS JOIN** (Cartesian product):\n```sql\nSELECT a.Codigo, t.Codigo\n  FROM Articulos a CROSS JOIN Tiendas t\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "JOIN Limitations",
    "body": "- **No NATURAL JOIN** -- not supported. Always specify ON conditions explicitly.\n- **No USING clause** -- `JOIN ... USING (column)` is not supported. Use `ON` instead.\n- **Equality only in ON clause** -- explicit JOIN conditions must use `=`. Operators like `>=`, `<`, `BETWEEN` are NOT allowed in ON clauses. Use WHERE for non-equality conditions:\n\n```sql\n-- WRONG: will fail\nFROM Articulos a INNER JOIN LineasVentas lv ON a.RegArticulo = lv.NumArticulo AND lv.Mes >= 202501\n\n-- CORRECT: move non-equality to WHERE\nFROM Articulos a INNER JOIN LineasVentas lv ON a.RegArticulo = lv.NumArticulo\nWHERE lv.Mes >= 202501\n```\n\n- **Multiple joins** can be combined in a single query, mixing implicit and explicit syntax.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Examples with PowerShop Schema",
    "body": "```sql\n-- Total sales count and revenue per store\nSELECT Tienda, COUNT(*) AS num_tickets, SUM(Total) AS revenue\n  FROM Ventas\n  WHERE FechaCreacion >= '2025-01-01'\n  GROUP BY Tienda\n  ORDER BY revenue DESC\n\n-- Average ticket value by store\nSELECT v.Tienda, AVG(v.Total) AS avg_ticket\n  FROM Ventas v\n  WHERE v.FechaCreacion >= '2025-01-01' AND v.Total > 0\n  GROUP BY v.Tienda\n\n-- Product count per family\nSELECT f.FamiGrupMarc AS familia, COUNT(*) AS num_products\n  FROM Articulos a\n  INNER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n  GROUP BY f.FamiGrupMarc\n  HAVING COUNT(*) > 10\n  ORDER BY num_products DESC\n\n-- Date range with distinct count\nSELECT COUNT(DISTINCT NumCliente) AS unique_customers\n  FROM Ventas\n  WHERE FechaCreacion BETWEEN '2025-01-01' AND '2025-03-31'\n    AND NumCliente > 0\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "String Function Examples",
    "body": "```sql\n-- Full product description with family\nSELECT CONCAT(CONCAT(a.Codigo, ' - '), a.Descripcion) AS full_desc\n  FROM Articulos a\n  LIMIT 10\n\n-- Case-insensitive search\nSELECT Codigo, Descripcion FROM Articulos\n  WHERE UPPER(Descripcion) LIKE '%CAMISA%'\n\n-- Extract first 3 characters of store code\nSELECT LEFT(Tienda, 3) AS store_prefix, COUNT(*) AS sales\n  FROM LineasVentas\n  GROUP BY LEFT(Tienda, 3)\n\n-- Clean up trailing spaces\nSELECT TRIM(Descripcion) AS clean_name FROM Articulos LIMIT 5\n\n-- COALESCE for null handling\nSELECT Codigo, COALESCE(CodigoBarra, 'NO-BARCODE') AS barcode\n  FROM Articulos LIMIT 10\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Date/Time Examples",
    "body": "```sql\n-- Sales from current month\nSELECT COUNT(*) FROM Ventas\n  WHERE YEAR(FechaCreacion) = YEAR(CURRENT_DATE)\n    AND MONTH(FechaCreacion) = MONTH(CURRENT_DATE)\n\n-- Monthly sales summary for 2025\nSELECT YEAR(FechaCreacion) AS yr, MONTH(FechaCreacion) AS mo,\n       COUNT(*) AS num_sales, SUM(Total) AS revenue\n  FROM Ventas\n  WHERE FechaCreacion >= '2025-01-01' AND FechaCreacion < '2026-01-01'\n  GROUP BY YEAR(FechaCreacion), MONTH(FechaCreacion)\n  ORDER BY yr, mo\n\n-- Using LineasVentas.Mes for faster period filtering (integer YYYYMM)\nSELECT Mes, SUM(Total) AS revenue, COUNT(*) AS lines\n  FROM LineasVentas\n  WHERE Mes BETWEEN 202501 AND 202512\n  GROUP BY Mes\n  ORDER BY Mes\n\n-- Day-of-week analysis\nSELECT DAYOFWEEK(FechaCreacion) AS dow, COUNT(*) AS sales\n  FROM Ventas\n  WHERE FechaCreacion >= '2025-01-01'\n  GROUP BY DAYOFWEEK(FechaCreacion)\n  ORDER BY dow\n\n-- EXTRACT syntax\nSELECT EXTRACT(YEAR FROM FechaCreacion) AS year FROM Ventas LIMIT 5\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Date Arithmetic",
    "body": "4D SQL has limited built-in date arithmetic. For complex date math, prefer computing boundaries in Python and passing them as literals:\n\n```python\nfrom datetime import date, timedelta\nstart = date.today() - timedelta(days=30)\nquery = f\"SELECT * FROM Ventas WHERE FechaCreacion >= '{start.isoformat()}'\"\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Math Examples",
    "body": "```sql\n-- Gross margin percentage\nSELECT Codigo, Descripcion,\n       Precio1 AS pvp, PrecioCoste AS cost,\n       ROUND((Precio1 - PrecioCoste) / Precio1 * 100, 1) AS margin_pct\n  FROM Articulos\n  WHERE Precio1 > 0 AND PrecioCoste > 0\n  ORDER BY margin_pct DESC\n  LIMIT 20\n\n-- ROUND example\nSELECT ROUND(1234.1966, 2)  -- returns 1234.2000\n\n-- Random sample of products\nSELECT Codigo, Descripcion FROM Articulos\n  WHERE RAND() < 0.01\n  LIMIT 10\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "9. CAST Function",
    "body": "Convert between types:\n\n```sql\nCAST(expression AS sql_data_type_name)\n```\n\nExamples:\n```sql\n-- Object field to text (JSON)\nSELECT CAST(Objeto AS VARCHAR) FROM Articulos WHERE Objeto IS NOT NULL LIMIT 5\n\n-- Number to string\nSELECT CAST(RegArticulo AS VARCHAR) FROM Articulos LIMIT 5\n\n-- String to integer\nSELECT * FROM LineasVentas WHERE CAST(Tienda AS INT) = 99\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_TABLES",
    "body": "```sql\nSELECT TABLE_NAME, TABLE_ID, SCHEMA_ID FROM _USER_TABLES\n```\n\n| Column | Type | Description |\n|--------|------|-------------|\n| TABLE_NAME | VARCHAR | Table name |\n| TEMPORARY | BOOLEAN | Is temporary table |\n| TABLE_ID | INT64 | Numeric table ID |\n| SCHEMA_ID | INT32 | Schema ID |\n| REST_AVAILABLE | BOOLEAN | Exposed via REST |\n| LOGGED | BOOLEAN | Included in transaction log |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_COLUMNS",
    "body": "```sql\nSELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE\n  FROM _USER_COLUMNS\n  WHERE TABLE_NAME = 'Articulos'\n  ORDER BY COLUMN_ID\n```\n\n| Column | Type | Description |\n|--------|------|-------------|\n| TABLE_NAME | VARCHAR | Parent table |\n| COLUMN_NAME | VARCHAR | Column name |\n| DATA_TYPE | INT32 | SQL type code (see type IDs above) |\n| DATA_LENGTH | INT32 | Size in bytes |\n| OLD_DATA_TYPE | INT32 | Legacy 4D type code |\n| NULLABLE | BOOLEAN | Allows NULLs |\n| TABLE_ID | INT64 | Table number |\n| COLUMN_ID | INT64 | Column number |\n| UNIQUENESS | BOOLEAN | Has unique constraint |\n| AUTOGENERATE | BOOLEAN | Auto-generated value |\n| AUTOINCREMENT | BOOLEAN | Auto-increment |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_INDEXES",
    "body": "```sql\nSELECT INDEX_NAME, TABLE_NAME, INDEX_TYPE, UNIQUENESS\n  FROM _USER_INDEXES\n  WHERE TABLE_NAME = 'Articulos'\n```\n\n| Column | Type | Description |\n|--------|------|-------------|\n| INDEX_ID | VARCHAR | Index identifier |\n| INDEX_NAME | VARCHAR | Index name |\n| INDEX_TYPE | INT32 | 1=BTree, 3=Cluster/Keyword, 7=Auto, 8=Object-type |\n| KEYWORD | BOOLEAN | Is keyword index |\n| TABLE_NAME | VARCHAR | Table name |\n| UNIQUENESS | BOOLEAN | Unique index |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_IND_COLUMNS",
    "body": "```sql\nSELECT INDEX_NAME, TABLE_NAME, COLUMN_NAME, COLUMN_POSITION\n  FROM _USER_IND_COLUMNS\n  WHERE TABLE_NAME = 'Articulos'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_CONSTRAINTS",
    "body": "```sql\nSELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, TABLE_NAME,\n       RELATED_TABLE_NAME, DELETE_RULE\n  FROM _USER_CONSTRAINTS\n```\n\n| CONSTRAINT_TYPE | Meaning |\n|-----------------|---------|\n| `P` | Primary Key |\n| `R` | Foreign Key |\n| `4DR` | 4D Relation (automatic) |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_CONS_COLUMNS",
    "body": "```sql\nSELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,\n       RELATED_COLUMN_NAME\n  FROM _USER_CONS_COLUMNS\n  WHERE TABLE_NAME = 'LineasVentas'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_SCHEMAS",
    "body": "```sql\nSELECT SCHEMA_ID, SCHEMA_NAME FROM _USER_SCHEMAS\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "_USER_VIEWS / _USER_VIEW_COLUMNS",
    "body": "```sql\nSELECT VIEW_NAME FROM _USER_VIEWS\nSELECT VIEW_NAME, COLUMN_NAME, DATA_TYPE FROM _USER_VIEW_COLUMNS\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Practical Gotchas",
    "body": "1. **Never use `SELECT *`** on wide tables (CCStock: 582 cols, Articulos: 379 cols, Clientes: 311 cols). Always list specific columns.\n\n2. **Type 0 columns** cause `Unrecognized 4D type: 0` errors with p4d. Always query specific columns or pre-filter by checking `_USER_COLUMNS.DATA_TYPE != 0`.\n\n3. **Picture/Blob columns** (type 12, 18) in `SELECT *` can hang the connection. Exclude them.\n\n4. **Text returns bytes**: In Python 3.13+, p4d may return `bytes` for text columns. Always handle: `val.decode('utf-8', errors='replace') if isinstance(val, bytes) else val`.\n\n5. **Floating-point PKs**: When joining on Real-type foreign keys (e.g., `NumVentas = RegVentas`), be aware of floating-point precision. The values should match exactly since they are stored as-is, but avoid arithmetic on PK values.\n\n6. **No `ILIKE`**: Unlike PostgreSQL, there is no case-insensitive LIKE. Use `UPPER(col) LIKE 'PATTERN%'`.\n\n7. **No `::type` casting**: Use `CAST(expr AS type)` instead of PostgreSQL's `::` syntax.\n\n8. **No `COALESCE` with mixed types**: Ensure all arguments to COALESCE are the same type.\n\n9. **String comparison is byte-level**: Accented characters (common in Spanish/Portuguese data like \"Descripcion\", \"Poblacion\") sort by byte value, not linguistic order.\n\n10. **Connection stability**: The SQL server is manually started on the 4D Server. If 4D restarts, SQL may not come back without manual intervention.\n\n---",
    "hasSql": false,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Sales Analysis",
    "body": "```sql\n-- Daily sales summary for a store\nSELECT FechaCreacion, COUNT(*) AS tickets, SUM(Total) AS revenue\n  FROM Ventas\n  WHERE Tienda = '99' AND FechaCreacion >= '2025-01-01'\n  GROUP BY FechaCreacion\n  ORDER BY FechaCreacion\n\n-- Top 20 products by units sold in a period\nSELECT lv.Codigo, lv.Descripcion,\n       SUM(lv.Unidades) AS units, SUM(lv.Total) AS revenue\n  FROM LineasVentas lv\n  WHERE lv.Mes BETWEEN 202501 AND 202503\n  GROUP BY lv.Codigo, lv.Descripcion\n  ORDER BY units DESC\n  LIMIT 20\n\n-- Sales by family with join\nSELECT f.FamiGrupMarc AS familia,\n       SUM(lv.Total) AS revenue,\n       SUM(lv.Unidades) AS units,\n       COUNT(*) AS line_count\n  FROM LineasVentas lv\n  INNER JOIN FamiGrupMarc f ON lv.NumFamilia = f.RegFamilia\n  WHERE lv.Mes = 202501\n  GROUP BY f.FamiGrupMarc\n  ORDER BY revenue DESC\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Product Analysis",
    "body": "```sql\n-- Products with margin below threshold\nSELECT Codigo, Descripcion, Precio1, PrecioCoste,\n       ROUND((Precio1 - PrecioCoste) / Precio1 * 100, 1) AS margin_pct\n  FROM Articulos\n  WHERE Precio1 > 0 AND PrecioCoste > 0 AND Anulado = FALSE\n    AND (Precio1 - PrecioCoste) / Precio1 < 0.3\n  ORDER BY margin_pct ASC\n  LIMIT 50\n\n-- Product catalog with classification\nSELECT a.Codigo, a.Descripcion, a.Precio1,\n       f.FamiGrupMarc AS familia,\n       d.DepaSeccFabr AS departamento,\n       a.ClaveTemporada, a.MarcaO2 AS marca\n  FROM Articulos a\n  LEFT OUTER JOIN FamiGrupMarc f ON a.NumFamilia = f.RegFamilia\n  LEFT OUTER JOIN DepaSeccFabr d ON a.NumDepartament = d.RegDepartament\n  WHERE a.Anulado = FALSE\n  ORDER BY a.Codigo\n  LIMIT 100\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Customer Analysis",
    "body": "```sql\n-- Top customers by purchase volume\nSELECT v.NumCliente, v.Cliente,\n       COUNT(*) AS num_purchases, SUM(v.Total) AS total_spent\n  FROM Ventas v\n  WHERE v.NumCliente > 0\n    AND v.FechaCreacion >= '2025-01-01'\n  GROUP BY v.NumCliente, v.Cliente\n  HAVING SUM(v.Total) > 500\n  ORDER BY total_spent DESC\n  LIMIT 50\n\n-- Customer details lookup\nSELECT RegCliente, Cliente, Poblacion, Provincia, Postal,\n       Telefono, Movil, CIF, FormaPago\n  FROM Clientes\n  WHERE UPPER(Cliente) LIKE '%EXAMPLE%'\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Stock and Transfers",
    "body": "```sql\n-- Transfer summary by store\nSELECT TiendaEntrada, Tipo, COUNT(*) AS transfers,\n       SUM(UnidadesE) AS total_units\n  FROM Traspasos\n  WHERE FechaE >= '2025-01-01'\n  GROUP BY TiendaEntrada, Tipo\n  ORDER BY TiendaEntrada, total_units DESC\n\n-- Products never sold (in last year)\nSELECT a.Codigo, a.Descripcion, a.Stock\n  FROM Articulos a\n  WHERE a.Anulado = FALSE AND a.Stock > 0\n    AND a.RegArticulo NOT IN (\n      SELECT DISTINCT lv.NumArticulo FROM LineasVentas lv\n      WHERE lv.Mes >= 202501\n    )\n  LIMIT 100\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/4d-sql-dialect.md",
    "heading": "Schema Discovery",
    "body": "```sql\n-- List all tables with row estimates\nSELECT TABLE_NAME, TABLE_ID FROM _USER_TABLES ORDER BY TABLE_NAME\n\n-- Describe a table's columns\nSELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE\n  FROM _USER_COLUMNS\n  WHERE TABLE_NAME = 'Ventas'\n  ORDER BY COLUMN_ID\n\n-- Find all text columns in a table (safe to query)\nSELECT COLUMN_NAME FROM _USER_COLUMNS\n  WHERE TABLE_NAME = 'Articulos' AND DATA_TYPE = 10\n\n-- Find all numeric columns\nSELECT COLUMN_NAME FROM _USER_COLUMNS\n  WHERE TABLE_NAME = 'Articulos' AND DATA_TYPE IN (3, 4, 6)\n\n-- Find columns safe to query (exclude Picture, Blob, type 0)\nSELECT COLUMN_NAME, DATA_TYPE FROM _USER_COLUMNS\n  WHERE TABLE_NAME = 'Articulos' AND DATA_TYPE NOT IN (0, 12, 18)\n  ORDER BY COLUMN_ID\n```\n\n---",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/data-access.md",
    "heading": "System tables",
    "body": "| Query | Purpose |\n|-------|---------|\n| `SELECT * FROM _USER_TABLES` | List all tables (name, id, flags) |\n| `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, DATA_LENGTH FROM _USER_COLUMNS WHERE TABLE_NAME = 'X'` | Columns for table X |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/data-access.md",
    "heading": "Gotchas",
    "body": "- **Always use VAT-exclusive fields**: `Ventas.TotalSI` not `Total`, `LineasVentas.PrecioNetoSI * Unidades` not `Total`, `GCFacturas.(Base1+Base2+Base3)` not `TotalFactura`. VAT is 23% PT mainland / 22% Madeira / 21% Spain -- it distorts comparisons across regions.\n- **Primary keys are Real (float)**: Most tables use a Real field as PK with a `.99` suffix pattern (e.g. `RegArticulo = 534.99`). The `.99` is just a convention, not meaningful.\n- **Article identifier mapping**: `Articulos.CCRefeJOFACM` = **Referencia** (e.g., \"V26212484\") -- this is the **primary business identifier**: what appears on labels, what staff know, what reports should display. `Articulos.Codigo` (text, internal code like \"144880\") is used by SOAP APIs. `Articulos.RegArticulo` (float PK like \"10053347.99\") = `CCStock.NumArticulo` = `LineasVentas.NumArticulo` (used for JOINs). `Articulos.Articulo` is the supplier/provider reference. `Articulos.CodigoBarra` is the EAN/barcode. **Note**: `LineasVentas` has `Codigo` (= `Articulos.Codigo`) but does NOT have `CCRefeJOFACM` -- you must JOIN with `Articulos` on `a.RegArticulo = lv.NumArticulo` to get the Referencia. Reports should always show Referencia (`CCRefeJOFACM`) as the primary SKU column, not Codigo.\n- **Referencia prefix conventions**: Prefix `M` = wholesale/mayorista article. Prefix `MA` = **material** (bolsas, perchas, etc.) — no inventory tracked, no stock management, exclude from stock analysis and sales KPIs. When filtering for wholesale articles, use `LEFT(CCRefeJOFACM, 1) = 'M'` but be aware that MA articles are a subset that should often be excluded from business metrics.\n- **MA articles excluded at ETL level**: Articles whose CCRefeJOFACM starts with `'MA'` are filtered out during ETL sync — they are not present in `ps_articulos` or any line-item table in the PostgreSQL mirror (`ps_lineas_ventas`, `ps_stock_tienda`, `ps_gc_lin_albarane`, `ps_gc_lin_facturas`). **No need to add `WHERE ccrefejofacm NOT LIKE 'MA%'` in PostgreSQL queries** — the exclusion is already done upstream. Only the 4D source (`Articulos`) still contains MA rows.\n- **CCStock has 582 columns**: Wide-format stock matrix. Query specific columns, not `SELECT *`.\n- **Articulos has 379 columns**: Includes 15 price levels, 20 size slots, multilingual descriptions. Query specific columns.\n- **Read-only**: Never issue modification statements. The CLI blocks them, but be careful in direct Python scripts too.\n- **SQL dialect**: 4D SQL, not standard SQL. Some functions may differ. `LIMIT` works for row limiting.\n- **Connection stability**: The SQL server was manually started; if 4D Server restarts, SQL may not come back without manual intervention.\n- **PagosVentas fields**: `ImporteEnt` = \"Importe Entregado\" (physical amount handed over, e.g., a 20 EUR bill for a 5.99 EUR item) -- NOT useful for analytics. `ImporteCob` = \"Importe Cobrado\" (actual amount charged, includes VAT) -- use for payment analysis. `Ventas.TotalSI` = the real revenue number (VAT-exclusive), use for all revenue analytics. There is NO `ImporteSal` column. ~33 \"Devolucion Vale\" records have a POS bug in ImporteEnt that concatenates store codes, producing huge values -- this is not corruption, just an irrelevant field.\n- **No TLS**: SQL connection is unencrypted. Only use on trusted networks.\n- **p4d type 0 columns**: Some columns have type 0 (unknown to p4d). `SELECT *` on tables with these columns raises `Unrecognized 4D type: 0`. Always query specific columns or filter by `_USER_COLUMNS.DATA_TYPE` first.\n- **p4d cursor.description returns bytes column names**: The p4d driver returns column names in `cursor.description` as `bytes` (e.g. `b'REGARTICULO'`), not `str`. If you iterate `cursor.description` to build dict keys, you'll get bytes keys that don't match any string-based mapping. The ETL's `safe_fetch()` in `etl/db/fourd.py` handles this with `_decode_column_name()`. If writing custom queries outside the ETL, always decode: `col_name.decode('utf-8') if isinstan",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/data-access.md",
    "heading": "CLI usage",
    "body": "```bash\nps sql tables                          # List all tables\nps sql describe Articulos              # Show columns\nps sql query \"SELECT * FROM Tiendas\"   # Run query\nps sql sample Ventas 3                 # Sample rows\nps sql count LineasVentas              # Row count\n```",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/data-access.md",
    "heading": "Method 1: SQL via `Exportaciones` table (discovered from legacy VFP app)",
    "body": "The `Exportaciones` table contains per-store, per-article stock with per-size breakdown.\n\n```sql\n-- Get stock for a specific store\nSELECT *\nFROM Exportaciones\nWHERE CAST(Tienda AS INT) = 152\n  AND CCStock <> 0\n```\n\nKey columns: `Tienda` (store code), `Codigo` (article code), `CCStock` (row-level net stock, Real), `Stock1..Stock34` (per-size stock, 16-bit integer slots — see gotcha on unsigned negatives via SQL).\n\nThis method is faster for bulk queries (all articles in a store at once) and does not require SOAP authentication.\n\n**Note**: This table was used by the legacy VFP application (2014-2018). Verify the table still exists and is populated in the current schema.",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/skills/data-access.md",
    "heading": "To get total stock in a specific store:",
    "body": "for art in data:\n    for tienda in art['tiendas']:\n        store_total = sum(s['stock'] for s in tienda['stock'])\n        if store_total > 0:\n            print(f\"Store {tienda['codigo_tienda']}: {store_total} units\")\n```\n\n**Important notes:**\n- The input codes must be `Articulos.Codigo` (internal numeric codes like \"144880\"), NOT the article reference (`Articulo` field like \"BOBA\") or barcode (`CodigoBarra`).\n- To map between identifiers: `SELECT Codigo, Articulo, CodigoBarra, RegArticulo FROM Articulos WHERE Codigo = 'XXXX'`\n- `CCStock.NumArticulo` corresponds to `Articulos.RegArticulo` (the float PK with .99 suffix).\n- Store code 99 is the central warehouse (company headquarters).\n- Store code 97 is the online store.\n- Negative stock values can appear (returns pending, adjustments).\n- The API returns all ~51 stores for every article, even those with zero stock.",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "Dashboard SQL Pairs",
    "body": "Curated question → SQL examples for the dashboard LLM prompt.\n\nThese pairs teach the LLM how to translate natural-language business questions\ninto correct PostgreSQL queries against the `ps_*` mirror tables.\n\n**Rules for new pairs:**\n- Always use `:curr_from` / `:curr_to` for current-period date ranges (never `CURRENT_DATE` or bare `INTERVAL`).\n- Use `:comp_from` / `:comp_to` only for explicitly comparative questions (YoY, año anterior, etc.).\n- Always use `total_si` (not `total`) for sales amounts.\n- Always filter `entrada = true` for sales, `entrada = false` for returns. **`entrada` exists only on `ps_ventas`, NOT on `ps_lineas_ventas`** — when querying `ps_lineas_ventas`, JOIN `ps_ventas v ON lv.num_ventas = v.reg_ventas` and filter `v.entrada`.\n- Exclude tienda `'99'` from retail store rankings.\n- Test new SQL against the local mirror with `ps sql query \"...\"`.\n\n---",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "LLM:sql-pairs",
    "body": "<!--\nREGLA QUE GOBIERNA TODOS LOS PARES DE ABAJO — \"ventas\" significa NETO.\n\nPowerShop presenta tres cifras distintas en su pantalla de caja:\n  01VEN  ventas brutas\n  02DEV  devoluciones   (importe guardado en POSITIVO)\n  NETO   01VEN - 02DEV  <- esto es lo que el usuario llama \"ventas\"\n\nFiltrar `entrada = true` a secas DESCARTA las devoluciones en vez de restarlas\ny sobrestima las ventas entre un 7 y un 10 % (medido en produccion, 2026-08:\n~20.000 EUR/mes de devoluciones ignoradas). Verificado contra la pantalla del\nERP de Ferrol el 2026-08-29: ventas 1.630,09 - devoluciones 201,46 = NETO\n1.428,63; el panel mostraba el bruto.\n\nPatron obligatorio para cualquier importe o unidad agregada de ps_ventas,\nps_lineas_ventas o ps_pagos_ventas:\n\n  COALESCE(SUM(x) FILTER (WHERE v.\"entrada\"), 0)\n  - COALESCE(SUM(x) FILTER (WHERE NOT v.\"entrada\"), 0)\n\nLos COALESCE NO son decorativos. SUM(...) FILTER (...) devuelve NULL cuando el\ngrupo no tiene ninguna fila de ese lado, y NULL - algo = NULL, asi que la fila\nentera sale vacia. Sin ellos el 30,6 % de los grupos de un ranking por articulo\nsalen NULL y, como NULL ordena primero en DESC, el \"top 10\" acaba siendo diez\nfilas vacias. Medido en produccion el 2026-08-29: 8.726 de 28.493 referencias.\n\nExcepciones legitimas (usar entrada=true a secas):\n  - contar TICKETS de venta (una devolucion no es un ticket vendido)\n  - la propia consulta de devoluciones, que filtra entrada=false\n\nNO es una excepcion el \"descuento medio\": ps_lineas_ventas no tiene p_desc_g ni\nimporte_descuento (existen en 4D LineasVentas, pero el ETL no las sincroniza),\nasi que esa metrica no se puede calcular contra el espejo.\n\nOtras reglas que gobiernan los pares de abajo:\n  - ps_clientes NO tiene 'mayorista' ni 'tipo_cliente'; segmentar por canal\n    (ps_ventas = retail, ps_gc_albaranes / ps_gc_facturas = mayorista).\n  - ps_traspasos: excluir SIEMPRE tipo IN ('Apertura','Inventario Parcial'),\n    que son asientos de inventario y suponen el 94 % de la tabla.\n  - albaran mayorista: fecha efectiva = fecha_envio si >= 2000-01-01, si no\n    fecha_valor.\n  - CIF 502108150 (19 registros de ps_clientes) es trafico intragrupo, no venta.\n  - ccrefejofacm es REFERENCIA+COLOR; el modelo es\n    LEFT(ccrefejofacm, LENGTH(ccrefejofacm) - 2).\n-->",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 artículos más vendidos por cantidad?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades Vendidas\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 modelos más vendidos?",
    "body": "```sql\nSELECT LEFT(p.\"ccrefejofacm\", LENGTH(p.\"ccrefejofacm\") - 2) AS \"Modelo\", MIN(p.\"descripcion\") AS \"Descripción\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Colores\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND LENGTH(p.\"ccrefejofacm\") > 2 GROUP BY 1 ORDER BY \"Unidades Vendidas\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas netas por tienda este mes?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas de la semana pasada por tienda?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el ticket medio?",
    "body": "```sql\nSELECT ROUND((COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0)) / NULLIF(COUNT(DISTINCT \"reg_ventas\") FILTER (WHERE \"entrada\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" WHERE \"tienda\" <> '99' AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántas devoluciones hubo este mes?",
    "body": "```sql\nSELECT COUNT(*) AS \"Devoluciones\", SUM(\"total_si\") AS \"Importe Devuelto\" FROM \"public\".\"ps_ventas\" WHERE \"entrada\" = false AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas de hoy?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY v.\"tienda\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuánto vendimos ayer?",
    "body": "```sql\nSELECT COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas netas acumuladas del año (YTD) comparadas con el año anterior?",
    "body": "```sql\nSELECT 'Este año' AS \"Período\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to UNION ALL SELECT 'Año anterior' AS \"Período\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT \"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :comp_from AND :comp_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas mensuales por tienda en el año actual?",
    "body": "```sql\nSELECT DATE_TRUNC('month', v.\"fecha_creacion\") AS \"Mes\", v.\"tienda\" AS \"Tienda\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY DATE_TRUNC('month', v.\"fecha_creacion\"), v.\"tienda\" ORDER BY \"Mes\", v.\"tienda\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántas unidades vendimos la semana pasada?",
    "body": "```sql\nSELECT COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por día de la semana?",
    "body": "```sql\nSELECT TO_CHAR(v.\"fecha_creacion\", 'Day') AS \"Día\", EXTRACT(DOW FROM v.\"fecha_creacion\") AS \"Num Día\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" v WHERE v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND v.\"tienda\" <> '99' GROUP BY TO_CHAR(v.\"fecha_creacion\", 'Day'), EXTRACT(DOW FROM v.\"fecha_creacion\") ORDER BY EXTRACT(DOW FROM v.\"fecha_creacion\")\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los 10 artículos más vendidos por importe?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Importe Neto\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Importe Neto\" DESC LIMIT 10\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué familias de producto venden más?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" GROUP BY fm.\"fami_grup_marc\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON p.\"num_departament\" = d.\"reg_departament\" GROUP BY d.\"depa_secc_fabr\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por temporada de la colección?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Artículos\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"clave_temporada\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por marca?",
    "body": "```sql\nSELECT m.\"marca_tratamien\" AS \"Marca\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_marcas\" m ON p.\"num_marca\" = m.\"reg_marca\" GROUP BY m.\"marca_tratamien\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos artículos activos hay en el catálogo?",
    "body": "```sql\nSELECT COUNT(*) AS \"Total Artículos\", SUM(CASE WHEN \"ccrefejofacm\" IS NULL OR \"ccrefejofacm\" NOT LIKE 'M%' THEN 1 ELSE 0 END) AS \"Retail\", SUM(CASE WHEN \"ccrefejofacm\" LIKE 'M%' THEN 1 ELSE 0 END) AS \"Mayorista\" FROM \"public\".\"ps_articulos\" WHERE \"anulado\" = false\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el stock total por tienda?",
    "body": "```sql\nSELECT s.\"tienda\" AS \"Tienda\", SUM(s.\"stock\") AS \"Stock Total\", COUNT(DISTINCT s.\"codigo\") AS \"Artículos\" FROM \"public\".\"ps_stock_tienda\" s WHERE s.\"stock\" > 0 GROUP BY s.\"tienda\" ORDER BY \"Stock Total\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué artículos tienen más stock en el almacén central?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"tienda\" = '99' AND s.\"stock\" > 0 GROUP BY s.\"codigo\", p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Stock\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es el valor del stock al coste?",
    "body": "```sql\nSELECT SUM(s.\"stock\" * p.\"precio_coste\") AS \"Valor al Coste\", SUM(s.\"stock\") AS \"Unidades Totales\", COUNT(DISTINCT s.\"codigo\") AS \"Referencias\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué tallas se venden más de una referencia?",
    "body": "```sql\nSELECT UPPER(lv.\"talla\") AS \"Talla\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI' AND lv.\"talla\" IS NOT NULL GROUP BY UPPER(lv.\"talla\") ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las tallas más vendidas de toda la cadena?",
    "body": "```sql\nSELECT UPPER(lv.\"talla\") AS \"Talla\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND lv.\"tienda\" <> '99' AND lv.\"talla\" IS NOT NULL GROUP BY UPPER(lv.\"talla\") ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué tallas vendo bien pero no tengo en stock?",
    "body": "```sql\nWITH vendido AS (SELECT p.\"ccrefejofacm\" AS ref, UPPER(lv.\"talla\") AS talla, COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS uds FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND lv.\"talla\" IS NOT NULL GROUP BY 1, 2), stock AS (SELECT p.\"ccrefejofacm\" AS ref, UPPER(s.\"talla\") AS talla, SUM(s.\"stock\") AS stock FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"tienda\" <> '99' GROUP BY 1, 2) SELECT v.ref AS \"Referencia\", v.talla AS \"Talla\", v.uds AS \"Vendidas\", COALESCE(st.stock, 0) AS \"Stock\" FROM vendido v LEFT JOIN stock st ON st.ref = v.ref AND st.talla = v.talla WHERE v.uds > 0 AND COALESCE(st.stock, 0) <= 0 ORDER BY v.uds DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son las ventas, devoluciones y neto por tienda?",
    "body": "```sql\nSELECT \"tienda\" AS \"Tienda\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) AS \"Ventas (01VEN)\", COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Devoluciones (02DEV)\", COALESCE(SUM(\"total_si\") FILTER (WHERE \"entrada\"), 0) - COALESCE(SUM(\"total_si\") FILTER (WHERE NOT \"entrada\"), 0) AS \"Neto (NETO)\", COUNT(DISTINCT \"reg_ventas\") FILTER (WHERE \"entrada\") AS \"Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND \"tienda\" <> '99' GROUP BY \"tienda\" ORDER BY \"Neto (NETO)\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por artículo y talla?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", s.\"talla\" AS \"Talla\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 GROUP BY s.\"codigo\", p.\"ccrefejofacm\", s.\"talla\" ORDER BY p.\"ccrefejofacm\", s.\"talla\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Artículos con stock negativo?",
    "body": "```sql\nSELECT s.\"codigo\" AS \"Código\", p.\"ccrefejofacm\" AS \"Referencia\", s.\"tienda\" AS \"Tienda\", s.\"talla\" AS \"Talla\", s.\"stock\" AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" < 0 ORDER BY s.\"stock\" ASC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por familia de producto?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", SUM(s.\"stock\") AS \"Unidades\", ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false GROUP BY fm.\"fami_grup_marc\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Artículos con stock pero sin ventas recientes (dead stock)?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\", p.\"clave_temporada\" AS \"Temporada\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 10 AND p.\"anulado\" = false AND p.\"codigo\" NOT IN (SELECT DISTINCT lv.\"codigo\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to) GROUP BY p.\"ccrefejofacm\", p.\"descripcion\", p.\"clave_temporada\" ORDER BY \"Stock\" DESC LIMIT 30\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Top artículos vendidos con su stock actual?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades Vendidas\", COALESCE(SUM(s.\"stock\"), 0) AS \"Stock Actual\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_stock_tienda\" s ON lv.\"codigo\" = s.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades Vendidas\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Distribución de stock por talla?",
    "body": "```sql\nSELECT s.\"talla\" AS \"Talla\", SUM(s.\"stock\") AS \"Unidades\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY s.\"talla\" ORDER BY s.\"talla\" ASC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué familias y tallas tienen más roturas de stock (referencias sin stock)?",
    "body": "```sql\nWITH stock_por_codigo AS (SELECT COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar') AS familia, s.\"talla\", s.\"codigo\", SUM(s.\"stock\") AS stock_total FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar'), s.\"talla\", s.\"codigo\") SELECT familia AS \"Familia\", \"talla\" AS \"Talla\", COUNT(CASE WHEN stock_total <= 0 THEN 1 END) AS \"Sin Stock\", COUNT(CASE WHEN stock_total > 0 THEN 1 END) AS \"Con Stock\", COUNT(*) AS \"Total Refs\", ROUND(COUNT(CASE WHEN stock_total <= 0 THEN 1 END)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS \"% Rotura\" FROM stock_por_codigo GROUP BY familia, \"talla\" HAVING COUNT(CASE WHEN stock_total <= 0 THEN 1 END) > 0 ORDER BY \"% Rotura\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Qué artículos acumulan más stock por talla?",
    "body": "```sql\nSELECT COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar') AS \"Familia\", s.\"talla\" AS \"Talla\", COALESCE(NULLIF(p.\"ccrefejofacm\", ''), '—') AS \"Referencia\", COALESCE(NULLIF(p.\"descripcion\", ''), '—') AS \"Descripción\", SUM(s.\"stock\") AS \"Stock\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" LEFT JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" WHERE s.\"stock\" > 0 AND s.\"tienda\" <> '99' AND p.\"anulado\" = false GROUP BY COALESCE(NULLIF(TRIM(fm.\"fami_grup_marc\"), ''), 'Sin clasificar'), s.\"talla\", COALESCE(NULLIF(p.\"ccrefejofacm\", ''), '—'), COALESCE(NULLIF(p.\"descripcion\", ''), '—') ORDER BY \"Stock\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuál es la facturación mayorista por comercial?",
    "body": "```sql\nSELECT c.\"comercial\" AS \"Comercial\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" f JOIN \"public\".\"ps_gc_comerciales\" c ON f.\"num_comercial\" = c.\"reg_comercial\" WHERE f.\"abono\" = false GROUP BY c.\"comercial\" ORDER BY \"Facturación Neta\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Facturación mayorista mensual del año actual?",
    "body": "```sql\nSELECT DATE_TRUNC('month', f.\"fecha_factura\") AS \"Mes\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Importe Neto\" FROM \"public\".\"ps_gc_facturas\" f WHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to AND f.\"abono\" = false GROUP BY DATE_TRUNC('month', f.\"fecha_factura\") ORDER BY \"Mes\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los principales clientes mayoristas por facturación?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(DISTINCT f.\"reg_factura\") AS \"Facturas\", SUM(f.\"base1\" + f.\"base2\" + f.\"base3\") AS \"Facturación Neta\" FROM \"public\".\"ps_gc_facturas\" f JOIN \"public\".\"ps_clientes\" c ON f.\"num_cliente\" = c.\"reg_cliente\" WHERE f.\"abono\" = false GROUP BY c.\"nombre\" ORDER BY \"Facturación Neta\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos albaranes mayoristas se enviaron este mes?",
    "body": "```sql\nSELECT COUNT(*) AS \"Albaranes\", SUM(a.\"entregadas\") AS \"Unidades\", SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") AS \"Importe Neto\" FROM \"public\".\"ps_gc_albaranes\" a LEFT JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\" WHERE (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01' THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END) BETWEEN :curr_from AND :curr_to AND a.\"abono\" = false AND COALESCE(c.\"nif\", '') <> '502108150'\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Notas de crédito mayoristas (abonos) del año?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(*) AS \"Abonos\", SUM(a.\"base1\" + a.\"base2\" + a.\"base3\") AS \"Total Abonado\" FROM \"public\".\"ps_gc_albaranes\" a JOIN \"public\".\"ps_clientes\" c ON a.\"num_cliente\" = c.\"reg_cliente\" WHERE a.\"abono\" = true AND (CASE WHEN a.\"fecha_envio\" >= DATE '2000-01-01' THEN a.\"fecha_envio\" ELSE a.\"fecha_valor\" END) BETWEEN :curr_from AND :curr_to AND COALESCE(c.\"nif\", '') <> '502108150' GROUP BY c.\"nombre\" ORDER BY \"Total Abonado\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Productos más vendidos en canal mayorista?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", SUM(lf.\"unidades\") AS \"Unidades\", SUM(lf.\"total\") AS \"Importe\" FROM \"public\".\"ps_gc_lin_facturas\" lf JOIN \"public\".\"ps_articulos\" p ON lf.\"codigo\" = p.\"codigo\" WHERE lf.\"unidades\" > 0 GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" ORDER BY \"Unidades\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuáles son los mejores clientes retail por compras?",
    "body": "```sql\nSELECT c.\"nombre\" AS \"Cliente\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Compras\", COALESCE(SUM(v.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(v.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Total Gastado\" FROM \"public\".\"ps_ventas\" v JOIN \"public\".\"ps_clientes\" c ON v.\"num_cliente\" = c.\"reg_cliente\" WHERE v.\"num_cliente\" > 0 AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"nombre\" ORDER BY \"Total Gastado\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos clientes únicos compraron este mes?",
    "body": "```sql\nSELECT COUNT(DISTINCT \"num_cliente\") AS \"Clientes Identificados\", SUM(CASE WHEN \"num_cliente\" = 0 THEN 1 ELSE 0 END) AS \"Tickets Anónimos\", COUNT(*) AS \"Total Tickets\" FROM \"public\".\"ps_ventas\" WHERE \"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Nuevos clientes registrados este año?",
    "body": "```sql\nSELECT COUNT(*) AS \"Nuevos Clientes\", COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_ventas\" v WHERE v.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Compra Retail\", COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM \"public\".\"ps_gc_albaranes\" a WHERE a.\"num_cliente\" = c.\"reg_cliente\")) AS \"Con Actividad Mayorista\" FROM \"public\".\"ps_clientes\" c WHERE c.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Frecuencia de compra de clientes?",
    "body": "```sql\nSELECT CASE WHEN compras = 1 THEN '1 compra' WHEN compras BETWEEN 2 AND 3 THEN '2-3 compras' WHEN compras BETWEEN 4 AND 10 THEN '4-10 compras' ELSE 'Más de 10' END AS \"Segmento\", COUNT(*) AS \"Clientes\" FROM (SELECT \"num_cliente\", COUNT(DISTINCT \"reg_ventas\") AS compras FROM \"public\".\"ps_ventas\" WHERE \"num_cliente\" > 0 AND \"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY \"num_cliente\") t GROUP BY 1 ORDER BY 2 DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ingresos por método de pago este mes?",
    "body": "```sql\nSELECT p.\"forma\" AS \"Forma de Pago\", COUNT(*) AS \"Transacciones\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe Cobrado\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"forma\" ORDER BY \"Importe Cobrado\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Mix de formas de pago por tienda?",
    "body": "```sql\nSELECT p.\"tienda\" AS \"Tienda\", p.\"forma\" AS \"Forma de Pago\", COUNT(*) AS \"Transacciones\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND p.\"tienda\" <> '99' GROUP BY p.\"tienda\", p.\"forma\" ORDER BY p.\"tienda\", \"Importe\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Efectivo vs tarjeta por tienda?",
    "body": "```sql\nSELECT p.\"tienda\" AS \"Tienda\", SUM(CASE WHEN p.\"codigo_forma\" = '01' THEN p.\"importe_cob\" ELSE 0 END) AS \"Efectivo\", SUM(CASE WHEN p.\"codigo_forma\" <> '01' THEN p.\"importe_cob\" ELSE 0 END) AS \"Tarjeta/Otro\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Total\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to AND p.\"tienda\" <> '99' GROUP BY p.\"tienda\" ORDER BY \"Total\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Evolución diaria de ingresos por forma de pago?",
    "body": "```sql\nSELECT p.\"fecha_creacion\" AS \"Fecha\", p.\"forma\" AS \"Forma de Pago\", COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE p.\"entrada\"), 0) - COALESCE(SUM(p.\"importe_cob\") FILTER (WHERE NOT p.\"entrada\"), 0) AS \"Importe\" FROM \"public\".\"ps_pagos_ventas\" p WHERE p.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"fecha_creacion\", p.\"forma\" ORDER BY p.\"fecha_creacion\", p.\"forma\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por familia de producto?",
    "body": "```sql\nSELECT fm.\"fami_grup_marc\" AS \"Familia\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_familias\" fm ON p.\"num_familia\" = fm.\"reg_familia\" GROUP BY fm.\"fami_grup_marc\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por tienda?",
    "body": "```sql\nSELECT lv.\"tienda\" AS \"Tienda\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" WHERE lv.\"tienda\" <> '99' GROUP BY lv.\"tienda\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Productos con bajo margen (menos del 30%)?",
    "body": "```sql\nSELECT p.\"ccrefejofacm\" AS \"Referencia\", p.\"descripcion\" AS \"Descripción\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" GROUP BY p.\"ccrefejofacm\", p.\"descripcion\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 AND ((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) < 0.30 ORDER BY \"Margen %\" ASC LIMIT 30\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen bruto por departamento?",
    "body": "```sql\nSELECT d.\"depa_secc_fabr\" AS \"Departamento\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Coste Total\", ROUND(((COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0)) - (COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_coste_si\") FILTER (WHERE NOT v.\"entrada\"), 0))) / NULLIF(COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0), 0) * 100, 1) AS \"Margen %\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" JOIN \"public\".\"ps_departamentos\" d ON p.\"num_departament\" = d.\"reg_departament\" GROUP BY d.\"depa_secc_fabr\" HAVING COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) > 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": false,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Margen mayorista por comercial?",
    "body": "```sql\nWITH neto AS (SELECT c.\"comercial\" AS comercial, COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(lf.\"total\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS ingreso, COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS NOT TRUE), 0) - COALESCE(SUM(lf.\"total_coste\") FILTER (WHERE f.\"abono\" IS TRUE), 0) AS coste FROM \"public\".\"ps_gc_lin_facturas\" lf JOIN \"public\".\"ps_gc_facturas\" f ON lf.\"num_factura\" = f.\"reg_factura\" JOIN \"public\".\"ps_gc_comerciales\" c ON f.\"num_comercial\" = c.\"reg_comercial\" WHERE f.\"fecha_factura\" BETWEEN :curr_from AND :curr_to GROUP BY c.\"comercial\") SELECT comercial AS \"Comercial\", ingreso AS \"Ingreso\", coste AS \"Coste\", ROUND((ingreso - coste) / NULLIF(ingreso, 0) * 100, 1) AS \"Margen %\" FROM neto WHERE ingreso <> 0 ORDER BY \"Margen %\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Volumen de traspasos por ruta?",
    "body": "```sql\nSELECT t.\"tienda_salida\" AS \"Tienda Origen\", t.\"tienda_entrada\" AS \"Tienda Destino\", COUNT(*) AS \"Traspasos\", SUM(t.\"unidades_s\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" t WHERE t.\"entrada\" = false AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial') AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"tienda_salida\", t.\"tienda_entrada\" ORDER BY \"Unidades\" DESC LIMIT 20\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Traspasos diarios de stock?",
    "body": "```sql\nSELECT t.\"fecha_s\" AS \"Fecha\", COUNT(*) AS \"Traspasos\", SUM(t.\"unidades_s\") AS \"Unidades\" FROM \"public\".\"ps_traspasos\" t WHERE t.\"entrada\" = false AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial') AND t.\"fecha_s\" BETWEEN :curr_from AND :curr_to GROUP BY t.\"fecha_s\" ORDER BY t.\"fecha_s\"\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Movimientos de stock de un artículo?",
    "body": "```sql\nSELECT t.\"fecha_s\" AS \"Fecha\", t.\"tienda_salida\" AS \"Origen\", t.\"tienda_entrada\" AS \"Destino\", t.\"talla\" AS \"Talla\", t.\"unidades_s\" AS \"Unidades\", t.\"tipo\" AS \"Tipo\" FROM \"public\".\"ps_traspasos\" t JOIN \"public\".\"ps_articulos\" p ON t.\"codigo\" = p.\"codigo\" WHERE p.\"ccrefejofacm\" = 'REFERENCIA_AQUI' AND t.\"entrada\" = false AND COALESCE(t.\"tipo\", '') NOT IN ('Apertura', 'Inventario Parcial') ORDER BY t.\"fecha_s\" DESC LIMIT 50\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Cuántos artículos hay por temporada?",
    "body": "```sql\nSELECT t.\"temporada_tipo\" AS \"Temporada\", COUNT(p.\"reg_articulo\") AS \"Artículos\", SUM(CASE WHEN p.\"anulado\" = false THEN 1 ELSE 0 END) AS \"Activos\" FROM \"public\".\"ps_articulos\" p JOIN \"public\".\"ps_temporadas\" t ON p.\"num_temporada\" = t.\"reg_temporada\" GROUP BY t.\"temporada_tipo\" ORDER BY \"Artículos\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Stock por temporada de colección?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COUNT(DISTINCT p.\"ccrefejofacm\") AS \"Referencias\", SUM(s.\"stock\") AS \"Unidades\", ROUND(SUM(s.\"stock\" * p.\"precio_coste\"), 2) AS \"Valor Coste\" FROM \"public\".\"ps_stock_tienda\" s JOIN \"public\".\"ps_articulos\" p ON s.\"codigo\" = p.\"codigo\" WHERE s.\"stock\" > 0 AND p.\"anulado\" = false GROUP BY p.\"clave_temporada\" ORDER BY \"Unidades\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por temporada de origen del artículo?",
    "body": "```sql\nSELECT p.\"clave_temporada\" AS \"Temporada\", COALESCE(SUM(lv.\"total_si\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"total_si\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Ventas Netas\", COALESCE(SUM(lv.\"unidades\") FILTER (WHERE v.\"entrada\"), 0) - COALESCE(SUM(lv.\"unidades\") FILTER (WHERE NOT v.\"entrada\"), 0) AS \"Unidades\" FROM \"public\".\"ps_lineas_ventas\" lv JOIN \"public\".\"ps_ventas\" v ON lv.\"num_ventas\" = v.\"reg_ventas\" JOIN \"public\".\"ps_articulos\" p ON lv.\"codigo\" = p.\"codigo\" WHERE lv.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY p.\"clave_temporada\" ORDER BY \"Ventas Netas\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Rendimiento YTD por tienda con comparativa año anterior?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", SUM(CASE WHEN v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to THEN v.\"total_si\" ELSE 0 END) AS \"Ventas Este Año\", SUM(CASE WHEN v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to THEN v.\"total_si\" ELSE 0 END) AS \"Ventas Año Anterior\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND (v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to OR v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to) GROUP BY v.\"tienda\" ORDER BY \"Ventas Este Año\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ticket medio por tienda?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"Tienda\", COUNT(DISTINCT v.\"reg_ventas\") AS \"Tickets\", ROUND(SUM(v.\"total_si\") / NULLIF(COUNT(DISTINCT v.\"reg_ventas\"), 0), 2) AS \"Ticket Medio\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND v.\"fecha_creacion\" BETWEEN :curr_from AND :curr_to GROUP BY v.\"tienda\" ORDER BY \"Ticket Medio\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "docs/dashboard/sql-pairs.md",
    "heading": "¿Ventas por tienda del período de comparación?",
    "body": "```sql\nSELECT v.\"tienda\" AS \"label\", SUM(v.\"total_si\") AS \"value\" FROM \"public\".\"ps_ventas\" v WHERE v.\"tienda\" <> '99' AND v.\"fecha_creacion\" BETWEEN :comp_from AND :comp_to GROUP BY v.\"tienda\" ORDER BY \"value\" DESC\n```",
    "hasSql": true,
    "dialect": "postgres"
  },
  {
    "source": "DECISIONS.md",
    "heading": "Data / ETL",
    "body": "| ID | Binding rule |\n|----|--------------|\n| [D-001](docs/decisions/D-001-postgres-mirror.md) | Analytics queries hit a PostgreSQL mirror. Never touch the live 4D ERP from analytics paths. ETL is the only writer to the mirror. |\n| [D-003](docs/decisions/D-003-single-select-no-offset.md) | For 4D tables < 2M rows, use a single SELECT — never LIMIT/OFFSET (4D re-scans from row 0 at each offset). |\n| [D-004](docs/decisions/D-004-stock-sync-per-store.md) | Stock sync fetches one store at a time (`WHERE Tienda='X'`). 50 stores × ~80s. Don't fetch the full Exportaciones table. |\n| [D-015](docs/decisions/D-015-schema-from-4dc.md) | Schema discovery uses string extraction on `PowerShop.4DC` + live `_USER_VIEWS` / `_USER_COLUMNS` queries. Don't rely on PowerShop install file trees alone. |\n| [D-017](docs/decisions/D-017-signed-int16-stock.md) | Apply `decode_signed_int16_word()` ONLY to `Exportaciones.Stock1..Stock34` (and `CCStock.Stock1..Stock34`) — the type-3/length-2 columns. Never on Real (type-6) columns. |\n| [D-050](docs/decisions/D-050-upsert-batch-loss.md) | `upsert()` pre-filters NULL/NaN-PK rows, falls back to row-by-row SAVEPOINT inserts on batch failure, and raises if zero rows survive — never a quiet 0-row \"ok\". |\n| [D-051](docs/decisions/D-051-fetch-anomaly-guard.md) | `safe_fetch()` scans every fetch for decode-corruption-shaped rows and refetches once to discriminate transient corruption from real data; evidence goes to `etl_fetch_anomalies`, never the D-050 skip log. |",
    "hasSql": true,
    "dialect": "4d"
  },
  {
    "source": "DECISIONS.md",
    "heading": "Dashboard App",
    "body": "| ID | Binding rule |\n|----|--------------|\n| [D-010](docs/decisions/D-010-custom-dashboard-generator.md) | Dashboard App is custom Next.js + Tremor (LLM generates a dashboard JSON spec). Don't try to retrofit Metabase / Evidence / ToolJet. |\n| [D-018](docs/decisions/D-018-agentic-tools.md) | `generate`/`modify`/`analyze` use a backend-controlled tool loop via OpenRouter `chat.completions`. Read-only SQL only. Tool catalog + limits in `dashboard/lib/llm-tools/runner.ts`. |\n| [D-019](docs/decisions/D-019-pluggable-llm-providers.md) | Dashboard LLM provider is `openrouter` or `cli` (selected by `DASHBOARD_LLM_PROVIDER`). CLI path uses argv-array spawn + JSON tool-step protocol. |\n| [D-022](docs/decisions/D-022-dashboard-redesign.md) | Dashboard chrome is token-driven (CSS variables on `<html>` data-attrs). New widgets/components go through the redesign tokens, not Tremor defaults. |\n| [D-026](docs/decisions/D-026-home-page-inicio.md) | `/inicio` is a read-only home — no chat, no save flow, no Analizar launcher. Filters are implicit via `CURRENT_DATE`/`DATE_TRUNC`. Not a user-pickable template. |\n| [D-027](docs/decisions/D-027-inicio-redesign.md) | `/` (root) renders the new home; dashboard list moved to `/paneles`. Home is bespoke React, not `DashboardRenderer`-driven. |\n| [D-032](docs/decisions/D-032-free-chat-tools.md) | Free-chat uses `FREE_CHAT_TOOLS` (11 inspection + `start_dashboard_generation` + `set_title` = 13). `set_title` is idempotent (`AND title IS NULL`). Full write tools in `FULL_DASHBOARD_TOOLS`. Handoff via `POST /api/conversations/:id/handoff-to-dashboard`. |\n| [D-036](docs/decisions/D-036-llm-context-centralization.md) | All dashboard LLM calls must go through `assembleRequest()` in `dashboard/lib/llm-context/`. No file outside that directory may import `llmComplete` or `runAgenticChat` directly; CI enforces this. |\n| [D-040](docs/decisions/D-040-context-log-files.md) | Per-turn context logs (exact payload sent to the LLM) live in files at `<DASHBOARD_CONTEXT_DIR>/<convId>/<turnId>.json` (bind mount); Postgres stores only the `conversation_turns.context_file` pointer. UI lazy-loads on expand; writes best-effort. |\n| [D-041](docs/decisions/D-041-e2e-required-for-features.md) | Every PR adding or modifying a user-facing dashboard surface must ship a Playwright e2e test asserting no error surface against seeded Postgres. PRs without one are not mergeable for those areas. |\n| [D-043](docs/decisions/D-043-cli-usage-metering-and-budget.md) | CLI-provider calls log real token/cost accounting (`--output-format json`, `total_cost_usd`) at every call site; `checkDailyBudget` applies to every provider, not just OpenRouter. |\n| [D-044](docs/decisions/D-044-mobile-breakpoint-and-pad-x-token.md) | Mobile breakpoint is Tailwind's `md:` (768px); Tailwind owns display/visibility only, inline styles own everything else; horizontal padding shrink goes through one `--pad-x` token declared unconditionally at `:root`. |\n| [D-045](docs/decisions/D-045-title-generation-contract.md) | Titles use the first user message, clamped to 100 chars; failures log, never throw. `buildSystemPrompt` is exhaustive over `LLM_FLOWS` — no silent fallback onto `chat`'s tools. |\n| [D-046](docs/decisions/D-046-cli-lean-mode-and-kill-switch.md) | CLI calls strip the harness (`dashboard.llm_cli_lean_mode`, default true); only vars-independent flows put `stable` on `--system-prompt` (`CLI_SYSTEM_PROMPT_SAFE_FLOWS`). `dashboard.llm_enabled` stops every LLM call at the two `assembleRequest`/`llmComplete` seams; `checkDailyBudget` runs once, pre-flight, in `assembleRequest`. |\n| [D-047](docs/decisions/D-047-diagnosable-failures.md) | Every route tree carries an `error.tsx` (+ root `global-error.tsx`); tool handlers log the real error object before returning the generic one; `/api/query` failures persist to `query_errors`. Container stdout dies on deploy — Postgres is the only durable trace. |\n| [D-048](docs/decisions/D-048-sales-by-size.md) | La talla de una v",
    "hasSql": false,
    "dialect": "n/a"
  }
];
