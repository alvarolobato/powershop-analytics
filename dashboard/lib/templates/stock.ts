/**
 * Template: Responsable de Stock
 *
 * Stock overview: totals, distribution by store, low-stock alerts.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Responsable de Stock";

export const description =
  "Panel para el responsable de stock: unidades totales, distribucion por tienda y alertas de stock bajo.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Stock",
  description,
  widgets: [
    {
      id: "stock-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Unidades en Stock",
          sql: `SELECT COALESCE(SUM("stock"), 0) AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0`,
          format: "number",
        },
        {
          label: "Tiendas con Stock",
          sql: `SELECT COUNT(DISTINCT "tienda") AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0`,
          format: "number",
        },
        {
          label: "Referencias Activas",
          sql: `SELECT COUNT(DISTINCT s."codigo") AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0 AND p."anulado" = false`,
          format: "number",
        },
      ],
    },
    {
      id: "stock-por-tienda",
      type: "bar_chart",
      title: "Stock por Tienda (excluye almacen central)",
      sql: `SELECT "tienda" AS label, SUM("stock") AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0 AND "tienda" <> '99'
GROUP BY "tienda"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "stock-bajo",
      type: "table",
      title: "Articulos con Stock Bajo (< 5 unidades en alguna tienda)",
      sql: `SELECT s."tienda" AS "Tienda",
       p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripcion",
       SUM(s."stock") AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0 AND s."stock" < 5
  AND s."tienda" <> '99'
  AND p."anulado" = false
GROUP BY s."tienda", p."ccrefejofacm", p."descripcion"
ORDER BY "Stock" ASC
LIMIT 50`,
    },
  ],
};
