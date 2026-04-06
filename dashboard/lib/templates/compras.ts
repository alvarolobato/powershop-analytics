/**
 * Template: Responsable de Compras
 *
 * Purchasing overview: monthly KPIs, top suppliers, recent purchase orders,
 * recent receptions, and monthly purchase-order trends.
 *
 * Schema notes (from issue #142 data model review):
 * - ps_compras uses fecha_pedido (NOT fecha_creacion)
 * - ps_lineas_compras has num_articulo (NUMERIC FK), NOT codigo/unidades
 * - ps_albaranes has fecha_recibido (NOT fecha_creacion)
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Responsable de Compras";

export const description =
  "Panel para el responsable de compras: pedidos del mes, proveedores activos, top proveedores, ultimas recepciones y tendencia mensual de pedidos.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Compras",
  description,
  widgets: [
    {
      id: "compras-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Pedidos de Compra (mes)",
          sql: `SELECT COUNT(DISTINCT "reg_pedido") AS value
FROM "public"."ps_compras"
WHERE "fecha_pedido" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "number",
        },
        {
          label: "Proveedores Activos (YTD)",
          sql: `SELECT COUNT(DISTINCT "num_proveedor") AS value
FROM "public"."ps_compras"
WHERE "fecha_pedido" >= DATE_TRUNC('year', CURRENT_DATE)`,
          format: "number",
        },
        {
          label: "Pedidos Recibidos (mes)",
          sql: `SELECT COUNT(DISTINCT "reg_pedido") AS value
FROM "public"."ps_compras"
WHERE "fecha_recibido" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "number",
        },
        {
          label: "Lineas de Compra (mes)",
          sql: `SELECT COUNT(*) AS value
FROM "public"."ps_lineas_compras" lc
JOIN "public"."ps_compras" c ON lc."num_pedido" = c."reg_pedido"
WHERE c."fecha_pedido" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "number",
        },
      ],
    },
    {
      id: "compras-por-proveedor",
      type: "bar_chart",
      title: "Pedidos por Proveedor (top 10, YTD)",
      sql: `SELECT pr."nombre" AS label,
       COUNT(DISTINCT c."reg_pedido") AS value
FROM "public"."ps_compras" c
JOIN "public"."ps_proveedores" pr ON c."num_proveedor" = pr."reg_proveedor"
WHERE c."fecha_pedido" >= DATE_TRUNC('year', CURRENT_DATE)
GROUP BY pr."nombre"
ORDER BY value DESC
LIMIT 10`,
      x: "label",
      y: "value",
    },
    {
      id: "compras-ultimos-pedidos",
      type: "table",
      title: "Ultimos Pedidos de Compra",
      sql: `SELECT c."reg_pedido" AS "Pedido",
       pr."nombre" AS "Proveedor",
       COUNT(lc."reg_linea_compra") AS "Lineas",
       c."fecha_pedido" AS "Fecha Pedido",
       c."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_compras" c
JOIN "public"."ps_proveedores" pr ON c."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = c."reg_pedido"
GROUP BY c."reg_pedido", pr."nombre", c."fecha_pedido", c."fecha_recibido"
ORDER BY c."fecha_pedido" DESC
LIMIT 20`,
    },
    {
      id: "compras-recepciones-recientes",
      type: "table",
      title: "Recepciones Recientes (ultimos 30 dias)",
      sql: `SELECT a."reg_albaran" AS "Albaran",
       a."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_albaranes" a
WHERE a."fecha_recibido" >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY a."fecha_recibido" DESC
LIMIT 20`,
    },
    {
      id: "compras-pendientes-recibir",
      type: "table",
      title: "Pedidos Pendientes de Recibir",
      sql: `SELECT c."reg_pedido" AS "Pedido",
       pr."nombre" AS "Proveedor",
       c."fecha_pedido" AS "Fecha Pedido",
       COUNT(lc."reg_linea_compra") AS "Lineas"
FROM "public"."ps_compras" c
JOIN "public"."ps_proveedores" pr ON c."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = c."reg_pedido"
WHERE c."fecha_recibido" IS NULL
  AND c."fecha_pedido" >= CURRENT_DATE - INTERVAL '6 months'
GROUP BY c."reg_pedido", pr."nombre", c."fecha_pedido"
ORDER BY c."fecha_pedido" DESC
LIMIT 20`,
    },
    {
      id: "compras-tendencia-mensual",
      type: "line_chart",
      title: "Pedidos de Compra Mensuales (ultimos 12 meses)",
      sql: `SELECT DATE_TRUNC('month', c."fecha_pedido") AS x,
       COUNT(DISTINCT c."reg_pedido") AS y
FROM "public"."ps_compras" c
WHERE c."fecha_pedido" >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', c."fecha_pedido")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
