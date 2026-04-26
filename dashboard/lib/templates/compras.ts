/**
 * Template: Responsable de Compras
 *
 * Purchasing overview: monthly KPIs, top suppliers, recent purchase orders,
 * recent receptions, and monthly purchase-order trends.
 * All date filters use :curr_from / :curr_to tokens set by the date picker.
 *
 * Schema notes (validated 2026-04-26 against the live mirror):
 * - "ps_compras" columns: reg_pedido, fecha_pedido, fecha_recibido,
 *   modificada, num_proveedor.  Uses fecha_pedido (NOT fecha_creacion);
 *   fecha_recibido EXISTS but is NULL for ~91% of rows (orders not yet
 *   received), so widgets that filter on it will return very few rows
 *   compared to fecha_pedido.
 * - "ps_lineas_compras" columns: reg_linea_compra, num_pedido, num_tienda,
 *   fecha, num_articulo (NUMERIC FK).  THERE IS NO unidades / total /
 *   importe column on this mirror table — do not aggregate amounts here.
 *   Joins to compras via num_pedido = reg_pedido.
 * - "ps_albaranes" columns: reg_albaran, fecha_recibido, modificada.  Has
 *   NO FK to ps_compras or ps_proveedores in the current ETL — the
 *   "Recepciones" widget can only show the albaran id and the date.
 * - "ps_proveedores.nombre" is currently empty for every row (520/520) in
 *   the mirror; SQL therefore COALESCEs to num_proveedor as a fallback so
 *   widgets stay readable until the ETL backfills the name.
 *
 * If you change a field name in this template, update the comment above
 * the affected SQL block to keep the contract explicit for future agents.
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersCompras } from "@/lib/template-global-filters";

export const name = "Responsable de Compras";

export const description =
  "Panel para el responsable de compras: pedidos del mes, lead time, proveedores activos, top proveedores, últimas recepciones y tendencia mensual de pedidos.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Compras",
  description,
  filters: templateGlobalFiltersCompras,
  widgets: [
    {
      id: "compras-kpis",
      type: "kpi_row",
      items: [
        {
          // Distinct purchase orders emitted in the selected period.
          // Field: ps_compras.fecha_pedido (NOT fecha_creacion — does not
          // exist on this table).
          label: "Pedidos de Compra (período seleccionado)",
          sql: `SELECT COALESCE(COUNT(DISTINCT co."reg_pedido"), 0) AS value
FROM "public"."ps_compras" co
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          // Distinct suppliers with at least one PO emitted in the period
          // (filter on ps_compras.fecha_pedido — NOT fecha_recibido).
          label: "Proveedores Activos (período seleccionado)",
          sql: `SELECT COALESCE(COUNT(DISTINCT co."num_proveedor"), 0) AS value
FROM "public"."ps_compras" co
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          // Average lead time (days between fecha_pedido and fecha_recibido)
          // for the orders RECEIVED in the selected period.  We anchor the
          // window on fecha_recibido here so the KPI describes deliveries
          // closed in the period; both dates must be non-NULL or the row
          // is excluded from the average.  COALESCE wraps the AVG so an
          // empty period (no rows) renders as 0 instead of NULL/"—",
          // matching the other KPIs in this row.
          label: "Lead Time Medio (días, recibidos en período)",
          sql: `SELECT COALESCE(ROUND(AVG(co."fecha_recibido" - co."fecha_pedido")::numeric, 1), 0) AS value
FROM "public"."ps_compras" co
WHERE co."fecha_recibido" IS NOT NULL
  AND co."fecha_pedido" IS NOT NULL
  AND co."fecha_recibido" >= :curr_from
  AND co."fecha_recibido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          // Open POs as of today: ordered in the period but never received.
          // ~91% of historical rows have fecha_recibido NULL, so this is
          // expected to be a non-trivial number.  Marked "inverted" so the
          // KPI card signals "rising is bad".
          label: "Pedidos Pendientes de Recibir (emitidos en período)",
          sql: `SELECT COALESCE(COUNT(DISTINCT co."reg_pedido"), 0) AS value
FROM "public"."ps_compras" co
WHERE co."fecha_recibido" IS NULL
  AND co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
          inverted: true,
        },
        {
          // Lines belonging to POs emitted in the period.
          // Counted on ps_lineas_compras.reg_linea_compra (PK) — there is
          // no unidades column on this table.
          label: "Líneas de Compra (período seleccionado)",
          sql: `SELECT COALESCE(COUNT(lc."reg_linea_compra"), 0) AS value
FROM "public"."ps_lineas_compras" lc
JOIN "public"."ps_compras" co ON lc."num_pedido" = co."reg_pedido"
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
      ],
    },
    {
      // Top suppliers by number of distinct POs in the period.
      // Label uses COALESCE(NULLIF(pr.nombre,''), num_proveedor) because
      // ps_proveedores.nombre is empty for every row in the current mirror
      // (data quality issue tracked outside this template).
      id: "compras-por-proveedor",
      type: "bar_chart",
      title: "Top Proveedores por Pedidos (período seleccionado)",
      sql: `SELECT COALESCE(NULLIF(pr."nombre", ''), CAST(co."num_proveedor" AS TEXT)) AS label,
       COUNT(DISTINCT co."reg_pedido") AS value
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY pr."nombre", co."num_proveedor"
ORDER BY value DESC
LIMIT 10`,
      x: "label",
      y: "value",
    },
    {
      // Lead time per supplier: AVG days between fecha_pedido and
      // fecha_recibido for the orders RECEIVED in the period.  Sorted by
      // lead time DESC so the slowest suppliers surface first; the buyer
      // can scroll for fast ones if needed.
      id: "compras-lead-time-proveedor",
      type: "table",
      title: "Lead Time por Proveedor (recibidos en período)",
      sql: `SELECT COALESCE(NULLIF(pr."nombre", ''), CAST(co."num_proveedor" AS TEXT)) AS "Proveedor",
       COUNT(*) AS "Recibidos",
       ROUND(AVG(co."fecha_recibido" - co."fecha_pedido")::numeric, 1) AS "Lead Time (días)"
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
WHERE co."fecha_recibido" IS NOT NULL
  AND co."fecha_pedido" IS NOT NULL
  AND co."fecha_recibido" >= :curr_from
  AND co."fecha_recibido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY pr."nombre", co."num_proveedor"
ORDER BY "Lead Time (días)" DESC
LIMIT 20`,
    },
    {
      // Latest 20 POs in the selected period.  Sorted by fecha_pedido DESC
      // with reg_pedido as a stable tiebreaker.  "Fecha Recibido" will be
      // NULL for orders still open — the table renderer shows blank cells
      // for NULL values.  Filtered by the time picker so it stays
      // consistent with the rest of the dashboard.
      id: "compras-ultimos-pedidos",
      type: "table",
      title: "Últimos Pedidos de Compra (período seleccionado)",
      sql: `SELECT co."reg_pedido" AS "Pedido",
       COALESCE(NULLIF(pr."nombre", ''), CAST(co."num_proveedor" AS TEXT)) AS "Proveedor",
       COUNT(lc."reg_linea_compra") AS "Líneas",
       co."fecha_pedido" AS "Fecha Pedido",
       co."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = co."reg_pedido"
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY co."reg_pedido", pr."nombre", co."num_proveedor", co."fecha_pedido", co."fecha_recibido"
ORDER BY co."fecha_pedido" DESC, co."reg_pedido" DESC
LIMIT 20`,
    },
    {
      // Open POs aged by days since emission.  Shows the oldest open
      // pedidos first so the buyer can chase them.  ps_proveedores.nombre
      // falls back to num_proveedor when empty (see header note).  The
      // "Días Abierto" column uses :curr_to as the reference date (NOT
      // CURRENT_DATE) so the aging is consistent with the selected period
      // and the templates lint rule that bans CURRENT_DATE alongside date
      // filters.
      id: "compras-pendientes-recibir",
      type: "table",
      title: "Pedidos Pendientes de Recibir (aging, emitidos en período)",
      sql: `SELECT co."reg_pedido" AS "Pedido",
       COALESCE(NULLIF(pr."nombre", ''), CAST(co."num_proveedor" AS TEXT)) AS "Proveedor",
       co."fecha_pedido" AS "Fecha Pedido",
       (:curr_to::date - co."fecha_pedido") AS "Días Abierto",
       COUNT(lc."reg_linea_compra") AS "Líneas"
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = co."reg_pedido"
WHERE co."fecha_recibido" IS NULL
  AND co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY co."reg_pedido", pr."nombre", co."num_proveedor", co."fecha_pedido"
ORDER BY co."fecha_pedido" ASC, co."reg_pedido" ASC
LIMIT 20`,
    },
    {
      // Recent receptions.  ps_albaranes has only reg_albaran +
      // fecha_recibido + modificada in the current ETL — no FK to compras
      // or proveedores — so the table cannot show supplier or PO for now.
      // If the ETL adds RegPedido / NumProveedor on Albaranes, extend this
      // widget then update the docstring above.  No __gf_proveedor_compras__
      // applied here for the same reason: no proveedor column to bind to.
      id: "compras-recepciones-recientes",
      type: "table",
      title: "Recepciones Recientes (período seleccionado)",
      sql: `SELECT a."reg_albaran" AS "Albarán",
       a."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_albaranes" a
WHERE a."fecha_recibido" >= :curr_from
  AND a."fecha_recibido" <= :curr_to
ORDER BY a."fecha_recibido" DESC, a."reg_albaran" DESC
LIMIT 20`,
    },
    {
      // Monthly trend of POs emitted.  Granularity is fixed at month —
      // sufficient for the typical 1-year purchasing horizon.  Switch to
      // DATE_TRUNC('week', …) if the user picks a < 90-day window
      // frequently.
      id: "compras-tendencia-mensual",
      type: "line_chart",
      title: "Pedidos de Compra por Mes (período seleccionado)",
      sql: `SELECT DATE_TRUNC('month', co."fecha_pedido") AS x,
       COUNT(DISTINCT co."reg_pedido") AS y
FROM "public"."ps_compras" co
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY DATE_TRUNC('month', co."fecha_pedido")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
