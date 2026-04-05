/**
 * Template: Director Mayorista
 *
 * Wholesale channel: invoicing KPIs, breakdown by sales rep, top clients,
 * recent delivery notes, and period comparison.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Director Mayorista";

export const description =
  "Panel para el director del canal mayorista: facturacion neta, margen, desglose por comercial, top clientes, pedidos pendientes, albaranes recientes, top productos y comparativa mensual.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Mayorista",
  description,
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
  AND "fecha_factura" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Facturas",
          sql: `SELECT COUNT(DISTINCT "reg_factura") AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= DATE_TRUNC('month', CURRENT_DATE)`,
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
  AND f."fecha_factura" >= DATE_TRUNC('month', CURRENT_DATE)`,
          format: "percent",
        },
        {
          label: "Clientes Activos (YTD)",
          sql: `SELECT COUNT(DISTINCT "num_cliente") AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= DATE_TRUNC('year', CURRENT_DATE)`,
          format: "number",
        },
      ],
    },
    {
      id: "mayorista-por-comercial",
      type: "bar_chart",
      title: "Facturacion por Comercial (mes actual)",
      sql: `SELECT c."comercial" AS label,
       SUM(f."base1" + f."base2" + f."base3") AS value
FROM "public"."ps_gc_facturas" f
JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial"
WHERE f."abono" = false
  AND f."fecha_factura" >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY c."comercial"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "mayorista-top-clientes",
      type: "table",
      title: "Top 10 Clientes Mayorista (YTD)",
      sql: `SELECT c."nombre" AS "Cliente",
       COUNT(DISTINCT f."reg_factura") AS "Facturas",
       SUM(f."base1" + f."base2" + f."base3") AS "Facturacion Neta",
       ROUND((SUM(lf."total") - SUM(lf."total_coste"))
         / NULLIF(SUM(lf."total"), 0) * 100, 1) AS "Margen %"
FROM "public"."ps_gc_facturas" f
JOIN "public"."ps_clientes" c ON f."num_cliente" = c."reg_cliente"
JOIN "public"."ps_gc_lin_facturas" lf ON lf."num_factura" = f."n_factura"
WHERE f."abono" = false
  AND f."fecha_factura" >= DATE_TRUNC('year', CURRENT_DATE)
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
      title: "Albaranes Recientes (ultimos 30 dias)",
      sql: `SELECT a."n_albaran" AS "Albaran",
       c."nombre" AS "Cliente",
       a."entregadas" AS "Unidades",
       (a."base1" + a."base2" + a."base3") AS "Importe Neto",
       a."fecha_envio" AS "Fecha"
FROM "public"."ps_gc_albaranes" a
JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente"
WHERE a."abono" = false
  AND a."fecha_envio" >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY a."fecha_envio" DESC
LIMIT 20`,
    },
    {
      id: "mayorista-top-productos",
      type: "table",
      title: "Top 10 Productos Mayorista (YTD)",
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
  AND f."fecha_factura" >= DATE_TRUNC('year', CURRENT_DATE)
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Importe" DESC
LIMIT 10`,
    },
    {
      id: "mayorista-comparativa-mensual",
      type: "line_chart",
      title: "Facturacion Mensual (ultimos 12 meses)",
      sql: `SELECT DATE_TRUNC('month', f."fecha_factura") AS x,
       SUM(f."base1" + f."base2" + f."base3") AS y
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', f."fecha_factura")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
