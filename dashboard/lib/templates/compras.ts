/**
 * Template: Responsable de Compras
 *
 * Purchasing overview: monthly KPIs, top suppliers, recent purchase orders,
 * recent receptions, and monthly purchase-order trends.
 * All date filters use :curr_from / :curr_to tokens set by the date picker.
 *
 * Schema notes (from issue #142 data model review):
 * - ps_compras uses fecha_pedido (NOT fecha_creacion)
 * - ps_lineas_compras has num_articulo (NUMERIC FK), NOT codigo/unidades
 * - ps_albaranes has fecha_recibido (NOT fecha_creacion)
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersCompras } from "@/lib/template-global-filters";

export const name = "Responsable de Compras";

export const description =
  "Panel para el responsable de compras: pedidos del mes, proveedores activos, top proveedores, ultimas recepciones y tendencia mensual de pedidos.";

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
          label: "Pedidos de Compra (período seleccionado)",
          sql: `SELECT COUNT(DISTINCT co."reg_pedido") AS value
FROM "public"."ps_compras" co
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          label: "Proveedores Activos (período seleccionado)",
          sql: `SELECT COUNT(DISTINCT co."num_proveedor") AS value
FROM "public"."ps_compras" co
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          label: "Pedidos Recibidos (período seleccionado)",
          sql: `SELECT COUNT(DISTINCT co."reg_pedido") AS value
FROM "public"."ps_compras" co
WHERE co."fecha_recibido" >= :curr_from
  AND co."fecha_recibido" <= :curr_to
  AND __gf_proveedor_compras__`,
          format: "number",
        },
        {
          label: "Lineas de Compra (período seleccionado)",
          sql: `SELECT COUNT(*) AS value
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
      id: "compras-por-proveedor",
      type: "bar_chart",
      title: "Pedidos por Proveedor (top 10, período seleccionado)",
      sql: `SELECT pr."nombre" AS label,
       COUNT(DISTINCT co."reg_pedido") AS value
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
WHERE co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
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
      sql: `SELECT co."reg_pedido" AS "Pedido",
       pr."nombre" AS "Proveedor",
       COUNT(lc."reg_linea_compra") AS "Lineas",
       co."fecha_pedido" AS "Fecha Pedido",
       co."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = co."reg_pedido"
WHERE __gf_proveedor_compras__
GROUP BY co."reg_pedido", pr."nombre", co."fecha_pedido", co."fecha_recibido"
ORDER BY co."fecha_pedido" DESC
LIMIT 20`,
    },
    {
      id: "compras-recepciones-recientes",
      type: "table",
      title: "Recepciones Recientes (período seleccionado)",
      sql: `SELECT a."reg_albaran" AS "Albaran",
       a."fecha_recibido" AS "Fecha Recibido"
FROM "public"."ps_albaranes" a
WHERE a."fecha_recibido" >= :curr_from
  AND a."fecha_recibido" <= :curr_to
ORDER BY a."fecha_recibido" DESC
LIMIT 20`,
    },
    {
      id: "compras-pendientes-recibir",
      type: "table",
      title: "Pedidos Pendientes de Recibir",
      sql: `SELECT co."reg_pedido" AS "Pedido",
       pr."nombre" AS "Proveedor",
       co."fecha_pedido" AS "Fecha Pedido",
       COUNT(lc."reg_linea_compra") AS "Lineas"
FROM "public"."ps_compras" co
JOIN "public"."ps_proveedores" pr ON co."num_proveedor" = pr."reg_proveedor"
LEFT JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = co."reg_pedido"
WHERE co."fecha_recibido" IS NULL
  AND co."fecha_pedido" >= :curr_from
  AND co."fecha_pedido" <= :curr_to
  AND __gf_proveedor_compras__
GROUP BY co."reg_pedido", pr."nombre", co."fecha_pedido"
ORDER BY co."fecha_pedido" DESC
LIMIT 20`,
    },
    {
      id: "compras-tendencia-mensual",
      type: "line_chart",
      title: "Pedidos de Compra Mensuales (período seleccionado)",
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
