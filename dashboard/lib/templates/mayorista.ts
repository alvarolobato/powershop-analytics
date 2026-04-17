/**
 * Template: Director Mayorista
 *
 * Wholesale channel: invoicing KPIs, breakdown by sales rep, top clients,
 * recent delivery notes, and period comparison.
 * Dates are driven by the dashboard time picker ({{date_from}} / {{date_to}}).
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Director Mayorista";

export const description =
  "Panel para el director del canal mayorista: facturacion neta, margen, desglose por comercial, top clientes, pedidos pendientes, albaranes recientes, top productos y comparativa mensual.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Mayorista",
  description,
  default_time_range: { preset: "current_month" },
  widgets: [
    {
      id: "mayorista-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Facturacion Neta",
          sql: `SELECT COALESCE(SUM("base1" + "base2" + "base3"), 0) AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Facturas",
          sql: `SELECT COUNT(DISTINCT "reg_factura") AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'`,
          format: "number",
        },
        {
          label: "Margen Mayorista",
          sql: `SELECT ROUND(
  (SUM(lf."total") - SUM(lf."total_coste"))
  / NULLIF(SUM(lf."total"), 0) * 100, 1
) AS value
FROM "public"."ps_gc_lin_facturas" lf
JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."n_factura"
WHERE lf."total" > 0
  AND f."abono" = false
  AND f."fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'`,
          format: "percent",
        },
        {
          label: "Clientes Activos",
          sql: `SELECT COUNT(DISTINCT "num_cliente") AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'`,
          format: "number",
        },
      ],
    },
    {
      id: "mayorista-por-comercial",
      type: "bar_chart",
      title: "Facturacion por Comercial",
      sql: `SELECT c."comercial" AS label,
       SUM(f."base1" + f."base2" + f."base3") AS value
FROM "public"."ps_gc_facturas" f
JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial"
WHERE f."abono" = false
  AND f."fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'
GROUP BY c."comercial"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "mayorista-top-clientes",
      type: "table",
      title: "Top 10 Clientes Mayorista",
      sql: `WITH facturas_ytd AS (
  SELECT f."reg_factura",
         f."n_factura",
         f."num_cliente",
         (f."base1" + f."base2" + f."base3") AS neto
  FROM "public"."ps_gc_facturas" f
  WHERE f."abono" = false
    AND f."fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'
), margenes AS (
  SELECT lf."num_factura",
         SUM(lf."total")       AS total_ingreso,
         SUM(lf."total_coste") AS total_coste
  FROM "public"."ps_gc_lin_facturas" lf
  WHERE lf."num_factura" IN (SELECT "n_factura" FROM facturas_ytd)
  GROUP BY lf."num_factura"
)
SELECT c."nombre" AS "Cliente",
       COUNT(DISTINCT fy."reg_factura") AS "Facturas",
       SUM(fy.neto) AS "Facturacion Neta",
       ROUND((SUM(m.total_ingreso) - SUM(m.total_coste))
         / NULLIF(SUM(m.total_ingreso), 0) * 100, 1) AS "Margen %"
FROM facturas_ytd fy
JOIN "public"."ps_clientes" c ON fy."num_cliente" = c."reg_cliente"
LEFT JOIN margenes m ON m."num_factura" = fy."n_factura"
GROUP BY c."nombre"
ORDER BY "Facturacion Neta" DESC
LIMIT 10`,
    },
    {
      id: "mayorista-pedidos-pendientes",
      type: "table",
      title: "Pedidos Pendientes de Entregar",
      sql: `SELECT c."nombre" AS "Cliente",
       gp."n_pedido" AS "Pedido",
       gp."fecha_pedido" AS "Fecha",
       gp."unidades" AS "Pedidas",
       gp."entregadas" AS "Entregadas",
       gp."pendientes" AS "Pendientes",
       gp."temporada" AS "Temporada"
FROM "public"."ps_gc_pedidos" gp
JOIN "public"."ps_clientes" c ON gp."num_cliente" = c."reg_cliente"
WHERE gp."pedido_cerrado" = false
  AND gp."abono" = false
  AND gp."pendientes" > 0
ORDER BY gp."fecha_pedido" DESC
LIMIT 20`,
    },
    {
      id: "mayorista-albaranes-recientes",
      type: "table",
      title: "Albaranes Recientes",
      sql: `SELECT a."n_albaran" AS "Albaran",
       c."nombre" AS "Cliente",
       a."entregadas" AS "Unidades",
       (a."base1" + a."base2" + a."base3") AS "Importe Neto",
       a."fecha_envio" AS "Fecha"
FROM "public"."ps_gc_albaranes" a
JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente"
WHERE a."abono" = false
  AND a."fecha_envio" BETWEEN '{{date_from}}' AND '{{date_to}}'
ORDER BY a."fecha_envio" DESC
LIMIT 20`,
    },
    {
      id: "mayorista-top-productos",
      type: "table",
      title: "Top 10 Productos Mayorista",
      sql: `SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
       SUM(lf."unidades") AS "Unidades",
       SUM(lf."total") AS "Importe",
       ROUND((SUM(lf."total") - SUM(lf."total_coste"))
         / NULLIF(SUM(lf."total"), 0) * 100, 1) AS "Margen %"
FROM "public"."ps_gc_lin_facturas" lf
JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."n_factura"
JOIN "public"."ps_articulos" p ON lf."codigo" = p."codigo"
WHERE f."abono" = false
  AND lf."unidades" > 0
  AND f."fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Importe" DESC
LIMIT 10`,
    },
    {
      id: "mayorista-comparativa-mensual",
      type: "line_chart",
      title: "Tendencia Facturacion Mensual",
      sql: `SELECT DATE_TRUNC('month', f."fecha_factura") AS x,
       SUM(f."base1" + f."base2" + f."base3") AS y
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" BETWEEN '{{date_from}}' AND '{{date_to}}'
GROUP BY DATE_TRUNC('month', f."fecha_factura")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
