/**
 * Template: Director General
 *
 * Executive overview: retail + wholesale revenue, channel mix, margin,
 * 12-month trend (retail + wholesale), and top product families.
 * All date filters use :curr_from / :curr_to tokens set by the date picker.
 * YoY KPI compares selected period vs same period one year prior.
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersRetail } from "@/lib/template-global-filters";

export const name = "Director General";

export const description =
  "Panel ejecutivo: ventas retail, facturacion mayorista, margen global, comparativa YoY, mix de canales, ventas por tienda, tendencia 12 meses, top familias y valor de stock.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Director General",
  description,
  filters: templateGlobalFiltersRetail,
  widgets: [
    {
      id: "general-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Ventas Retail Netas (período seleccionado)",
          sql: `SELECT COALESCE(SUM(v."total_si"), 0) AS value
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Facturacion Mayorista (período seleccionado)",
          sql: `SELECT COALESCE(SUM("base1" + "base2" + "base3"), 0) AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= :curr_from
  AND "fecha_factura" <= :curr_to`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Margen Global Retail",
          sql: `SELECT ROUND(
  (SUM(lv."total_si") - SUM(lv."total_coste_si"))
  / NULLIF(SUM(lv."total_si"), 0) * 100, 1
) AS value
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE v."entrada" = true
  AND lv."tienda" <> '99'
  AND lv."total_si" > 0
  AND lv."fecha_creacion" >= :curr_from
  AND lv."fecha_creacion" <= :curr_to
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
  AND __gf_sexo__
  AND __gf_departamento__`,
          format: "percent",
        },
        {
          label: "Retail YoY %",
          sql: `SELECT ROUND(
  (curr.ventas - prev.ventas) / NULLIF(ABS(prev.ventas), 0) * 100, 1
) AS value
FROM (
  SELECT COALESCE(SUM(v."total_si"), 0) AS ventas
  FROM "public"."ps_ventas" v
  WHERE v."entrada" = true AND v."tienda" <> '99'
    AND v."fecha_creacion" >= :curr_from
    AND v."fecha_creacion" <= :curr_to
    AND __gf_tienda__
) curr,
(
  SELECT COALESCE(SUM(v."total_si"), 0) AS ventas
  FROM "public"."ps_ventas" v
  WHERE v."entrada" = true AND v."tienda" <> '99'
    AND v."fecha_creacion" >= :curr_from::date - INTERVAL '1 year'
    AND v."fecha_creacion" <= :curr_to::date - INTERVAL '1 year'
    AND __gf_tienda__
) prev`,
          format: "percent",
        },
      ],
    },
    {
      id: "general-mix-canales",
      type: "donut_chart",
      title: "Mix Retail vs Mayorista (período seleccionado)",
      sql: `SELECT 'Retail' AS label,
       COALESCE(SUM(v."total_si"), 0) AS value
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__
UNION ALL
SELECT 'Mayorista' AS label,
       COALESCE(SUM("base1" + "base2" + "base3"), 0) AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= :curr_from
  AND "fecha_factura" <= :curr_to`,
      x: "label",
      y: "value",
    },
    {
      id: "general-ventas-por-tienda",
      type: "bar_chart",
      title: "Ventas Retail por Tienda (período seleccionado)",
      sql: `SELECT v."tienda" AS label, SUM(v."total_si") AS value
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__
GROUP BY v."tienda"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "general-tendencia-12m",
      type: "line_chart",
      title: "Tendencia Mensual Retail + Mayorista (período seleccionado)",
      sql: `SELECT mes, SUM(importe) AS y, mes AS x FROM (
  SELECT DATE_TRUNC('month', v."fecha_creacion") AS mes,
         SUM(v."total_si") AS importe
  FROM "public"."ps_ventas" v
  WHERE v."entrada" = true
    AND v."tienda" <> '99'
    AND v."fecha_creacion" >= :curr_from
    AND v."fecha_creacion" <= :curr_to
    AND __gf_tienda__
  GROUP BY DATE_TRUNC('month', v."fecha_creacion")
  UNION ALL
  SELECT DATE_TRUNC('month', "fecha_factura") AS mes,
         SUM("base1" + "base2" + "base3") AS importe
  FROM "public"."ps_gc_facturas"
  WHERE "abono" = false
    AND "fecha_factura" >= :curr_from
    AND "fecha_factura" <= :curr_to
  GROUP BY DATE_TRUNC('month', "fecha_factura")
) combined
GROUP BY mes
ORDER BY mes`,
      x: "x",
      y: "y",
    },
    {
      id: "general-top-familias",
      type: "table",
      title: "Top 10 Familias por Ventas (período seleccionado)",
      sql: `SELECT fm."fami_grup_marc" AS "Familia",
       SUM(lv."total_si") AS "Ventas Netas",
       SUM(lv."unidades") AS "Unidades",
       ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si"))
         / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS "Margen %"
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE v."entrada" = true
  AND lv."tienda" <> '99'
  AND lv."total_si" > 0
  AND lv."fecha_creacion" >= :curr_from
  AND lv."fecha_creacion" <= :curr_to
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
  AND __gf_sexo__
  AND __gf_departamento__
GROUP BY fm."fami_grup_marc"
ORDER BY "Ventas Netas" DESC
LIMIT 10`,
    },
    {
      id: "general-valor-stock",
      type: "kpi_row",
      items: [
        {
          label: "Valor Stock Total al Coste",
          sql: `SELECT COALESCE(ROUND(SUM(s."stock" * p."precio_coste"), 2), 0) AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0 AND p."anulado" = false`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Unidades en Stock",
          sql: `SELECT COALESCE(SUM("stock"), 0) AS value
FROM "public"."ps_stock_tienda"
WHERE "stock" > 0`,
          format: "number",
        },
        {
          label: "Pedidos Mayorista Pendientes",
          sql: `SELECT COUNT(DISTINCT "reg_pedido") AS value
FROM "public"."ps_gc_pedidos"
WHERE "pedido_cerrado" = false
  AND "abono" = false
  AND "pendientes" > 0`,
          format: "number",
        },
      ],
    },
  ],
};
