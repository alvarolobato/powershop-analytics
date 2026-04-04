/**
 * Template: Responsable de Stock
 *
 * Stock overview: totals (incl. central warehouse), distribution by store,
 * low-stock alerts, out-of-stock items, stock in central warehouse, recent transfers.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Responsable de Stock";

export const description =
  "Panel para el responsable de stock: unidades totales, distribucion por tienda, stock en almacen, sin stock y traspasos recientes.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Stock",
  description,
  widgets: [
    {
      id: "stock-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Unidades en Tiendas",
          sql: `SELECT COALESCE(SUM("stock"), 0) AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0 AND "tienda" <> '99'`,
          format: "number",
        },
        {
          label: "Unidades en Almacén Central",
          sql: `SELECT COALESCE(SUM("stock"), 0) AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0 AND "tienda" = '99'`,
          format: "number",
        },
        {
          label: "Tiendas con Stock",
          sql: `SELECT COUNT(DISTINCT "tienda") AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0 AND "tienda" <> '99'`,
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
      title: "Stock por Tienda (excluye almacén central)",
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
      title: "Artículos con Stock Bajo (< 5 unidades en alguna tienda)",
      sql: `SELECT s."tienda" AS "Tienda",
       p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
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
    {
      id: "stock-sin-stock",
      type: "table",
      title: "Artículos Sin Stock en Tiendas (con stock en almacén)",
      sql: `SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
       SUM(CASE WHEN s."tienda" = '99' THEN s."stock" ELSE 0 END) AS "Stock Almacén"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE p."anulado" = false
GROUP BY p."ccrefejofacm", p."descripcion"
HAVING SUM(CASE WHEN s."tienda" <> '99' THEN s."stock" ELSE 0 END) = 0
   AND SUM(CASE WHEN s."tienda" = '99' THEN s."stock" ELSE 0 END) > 0
ORDER BY "Stock Almacén" DESC
LIMIT 30`,
    },
    {
      id: "stock-traspasos-recientes",
      type: "table",
      title: "Traspasos Recientes (ultimos 30 dias)",
      sql: `SELECT t."fecha_s" AS "Fecha",
       t."tienda_salida" AS "Origen",
       t."tienda_entrada" AS "Destino",
       COUNT(*) AS "Lineas",
       SUM(t."unidades_s") AS "Unidades"
FROM "public"."ps_traspasos" t
WHERE t."entrada" = false
  AND t."fecha_s" >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t."fecha_s", t."tienda_salida", t."tienda_entrada"
ORDER BY t."fecha_s" DESC
LIMIT 30`,
    },
  ],
};
