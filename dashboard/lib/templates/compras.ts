/**
 * Template: Responsable de Compras
 *
 * Purchasing overview: monthly totals, top suppliers, recent purchase lines.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Responsable de Compras";

export const description =
  "Panel para el responsable de compras: total compras del mes, proveedores activos, top proveedores y ultimas lineas.";

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
WHERE "fecha_creacion" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "number",
        },
        {
          label: "Proveedores Activos",
          sql: `SELECT COUNT(DISTINCT "num_proveedor") AS value
FROM "public"."ps_compras"
WHERE "fecha_creacion" >= DATE_TRUNC('year', CURRENT_DATE)`,
          format: "number",
        },
        {
          label: "Lineas de Compra (mes)",
          sql: `SELECT COUNT(*) AS value
FROM "public"."ps_lineas_compras" lc
JOIN "public"."ps_compras" c ON lc."num_pedido" = c."reg_pedido"
WHERE c."fecha_creacion" >= DATE_TRUNC('month', CURRENT_DATE)`,
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
WHERE c."fecha_creacion" >= DATE_TRUNC('year', CURRENT_DATE)
GROUP BY pr."nombre"
ORDER BY value DESC
LIMIT 10`,
      x: "label",
      y: "value",
    },
    {
      id: "compras-ultimas-recepciones",
      type: "table",
      title: "Ultimos Pedidos de Compra",
      sql: `SELECT c."reg_pedido" AS "Pedido",
       pr."nombre" AS "Proveedor",
       COUNT(lc."codigo") AS "Lineas",
       SUM(lc."unidades") AS "Unidades",
       c."fecha_creacion" AS "Fecha"
FROM "public"."ps_compras" c
JOIN "public"."ps_proveedores" pr ON c."num_proveedor" = pr."reg_proveedor"
JOIN "public"."ps_lineas_compras" lc ON lc."num_pedido" = c."reg_pedido"
GROUP BY c."reg_pedido", pr."nombre", c."fecha_creacion"
ORDER BY c."fecha_creacion" DESC
LIMIT 20`,
    },
  ],
};
