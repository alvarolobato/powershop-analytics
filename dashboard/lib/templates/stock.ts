/**
 * Template: Responsable de Stock
 *
 * Stock overview: totals (incl. central warehouse), distribution by store,
 * low-stock alerts, out-of-stock items, stock in central warehouse, recent transfers.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Responsable de Stock";

export const description =
  "Panel para el responsable de stock: unidades totales, valoracion al coste, distribucion por tienda y familia, stock bajo, dead stock, sin stock y traspasos recientes.";

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
          label: "Valor Stock al Coste",
          sql: `SELECT COALESCE(ROUND(SUM(s."stock" * p."precio_coste"), 2), 0) AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0 AND p."anulado" = false`,
          format: "currency",
          prefix: "€",
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
      id: "stock-por-familia",
      type: "bar_chart",
      title: "Stock por Familia (unidades, top 10)",
      sql: `SELECT fm."fami_grup_marc" AS label,
       SUM(s."stock") AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0 AND p."anulado" = false
GROUP BY fm."fami_grup_marc"
ORDER BY value DESC
LIMIT 10`,
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
      id: "stock-dead-stock",
      type: "table",
      title: "Dead Stock (stock total > 10, sin ventas en 90 dias)",
      sql: `SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
       SUM(s."stock") AS "Stock",
       p."clave_temporada" AS "Temporada"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0
  AND p."anulado" = false
  AND p."codigo" NOT IN (
    SELECT DISTINCT lv."codigo"
    FROM "public"."ps_lineas_ventas" lv
    JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
    WHERE v."entrada" = true
      AND lv."tienda" <> '99'
      AND lv."fecha_creacion" >= :curr_from AND lv."fecha_creacion" <= :curr_to
  )
GROUP BY p."ccrefejofacm", p."descripcion", p."clave_temporada"
HAVING SUM(s."stock") > 10
ORDER BY "Stock" DESC
LIMIT 30`,
    },
    {
      id: "stock-traspasos-recientes",
      type: "table",
      title: "Traspasos Recientes",
      sql: `SELECT t."fecha_s" AS "Fecha",
       t."tienda_salida" AS "Origen",
       t."tienda_entrada" AS "Destino",
       COUNT(*) AS "Lineas",
       SUM(t."unidades_s") AS "Unidades"
FROM "public"."ps_traspasos" t
WHERE t."entrada" = false
  AND t."fecha_s" >= :curr_from AND t."fecha_s" <= :curr_to
GROUP BY t."fecha_s", t."tienda_salida", t."tienda_entrada"
ORDER BY t."fecha_s" DESC
LIMIT 30`,
    },
  ],
};
