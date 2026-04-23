/**
 * Template: Director Mayorista
 *
 * Wholesale channel: invoicing KPIs, breakdown by sales rep, top clients,
 * recent delivery notes, and period comparison.
 * All date filters use :curr_from / :curr_to tokens set by the date picker.
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersMayorista } from "@/lib/template-global-filters";

export const name = "Director Mayorista";

export const description =
  "Panel para el director del canal mayorista: facturacion neta, margen, desglose por comercial, top clientes, pedidos pendientes, albaranes recientes, top productos y comparativa mensual.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Mayorista",
  description,
  filters: templateGlobalFiltersMayorista,
  widgets: [
    {
      id: "mayorista-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Facturacion Neta",
          sql: `SELECT COALESCE(SUM(f."base1" + f."base2" + f."base3"), 0) AS value
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Facturas",
          sql: `SELECT COUNT(DISTINCT f."reg_factura") AS value
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__`,
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
JOIN "public"."ps_articulos" p ON lf."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE lf."total" > 0
  AND f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__`,
          format: "percent",
        },
        {
          label: "Clientes Activos (período seleccionado)",
          sql: `SELECT COUNT(DISTINCT f."num_cliente") AS value
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__`,
          format: "number",
        },
      ],
    },
    {
      id: "mayorista-por-comercial",
      type: "bar_chart",
      title: "Facturacion por Comercial (período seleccionado)",
      sql: `SELECT c."comercial" AS label,
       SUM(f."base1" + f."base2" + f."base3") AS value
FROM "public"."ps_gc_facturas" f
JOIN "public"."ps_gc_comerciales" c ON f."num_comercial" = c."reg_comercial"
WHERE f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__
GROUP BY c."comercial"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "mayorista-top-clientes",
      type: "table",
      title: "Top 10 Clientes Mayorista (período seleccionado)",
      sql: `WITH facturas_periodo AS (
  SELECT f."reg_factura",
         f."n_factura",
         f."num_cliente",
         (f."base1" + f."base2" + f."base3") AS neto
  FROM "public"."ps_gc_facturas" f
  WHERE f."abono" = false
    AND f."fecha_factura" >= :curr_from
    AND f."fecha_factura" <= :curr_to
    AND __gf_cliente_mayorista__
), margenes AS (
  SELECT lf."num_factura",
         SUM(lf."total")       AS total_ingreso,
         SUM(lf."total_coste") AS total_coste
  FROM "public"."ps_gc_lin_facturas" lf
  WHERE lf."num_factura" IN (SELECT "n_factura" FROM facturas_periodo)
  GROUP BY lf."num_factura"
)
SELECT c."nombre" AS "Cliente",
       COUNT(DISTINCT fy."reg_factura") AS "Facturas",
       SUM(fy.neto) AS "Facturacion Neta",
       ROUND((SUM(m.total_ingreso) - SUM(m.total_coste))
         / NULLIF(SUM(m.total_ingreso), 0) * 100, 1) AS "Margen %"
FROM facturas_periodo fy
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
      title: "Albaranes Recientes (período seleccionado)",
      sql: `SELECT a."n_albaran" AS "Albaran",
       c."nombre" AS "Cliente",
       a."entregadas" AS "Unidades",
       (a."base1" + a."base2" + a."base3") AS "Importe Neto",
       a."fecha_envio" AS "Fecha"
FROM "public"."ps_gc_albaranes" a
JOIN "public"."ps_clientes" c ON a."num_cliente" = c."reg_cliente"
WHERE a."abono" = false
  AND a."fecha_envio" >= :curr_from
  AND a."fecha_envio" <= :curr_to
ORDER BY a."fecha_envio" DESC
LIMIT 20`,
    },
    {
      id: "mayorista-top-productos",
      type: "table",
      title: "Top 10 Productos Mayorista (período seleccionado)",
      sql: `SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
       SUM(lf."unidades") AS "Unidades",
       SUM(lf."total") AS "Importe",
       ROUND((SUM(lf."total") - SUM(lf."total_coste"))
         / NULLIF(SUM(lf."total"), 0) * 100, 1) AS "Margen %"
FROM "public"."ps_gc_lin_facturas" lf
JOIN "public"."ps_gc_facturas" f ON lf."num_factura" = f."n_factura"
JOIN "public"."ps_articulos" p ON lf."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE f."abono" = false
  AND lf."unidades" > 0
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Importe" DESC
LIMIT 10`,
    },
    {
      id: "mayorista-comparativa-mensual",
      type: "line_chart",
      title: "Facturacion Mensual (período seleccionado)",
      sql: `SELECT DATE_TRUNC('month', f."fecha_factura") AS x,
       SUM(f."base1" + f."base2" + f."base3") AS y
FROM "public"."ps_gc_facturas" f
WHERE f."abono" = false
  AND f."fecha_factura" >= :curr_from
  AND f."fecha_factura" <= :curr_to
  AND __gf_cliente_mayorista__
GROUP BY DATE_TRUNC('month', f."fecha_factura")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
