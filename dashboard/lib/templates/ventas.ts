/**
 * Template: Responsable de Ventas
 *
 * KPIs de ventas retail, devoluciones, desglose por tienda, tendencia semanal,
 * formas de pago, margen por tienda, top articulos con margen.
 * All date filters use :curr_from / :curr_to tokens set by the date picker.
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersRetail } from "@/lib/template-global-filters";

export const name = "Responsable de Ventas";

export const description =
  "Panel para el responsable de ventas retail: KPIs y devoluciones, desglose por tienda, tendencia semanal, formas de pago, margen por tienda y top articulos.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Ventas Retail",
  description,
  filters: templateGlobalFiltersRetail,
  widgets: [
    {
      id: "ventas-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Ventas Netas",
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
          label: "Tickets",
          sql: `SELECT COUNT(DISTINCT v."reg_ventas") AS value
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__`,
          format: "number",
        },
        {
          label: "Ticket Medio",
          sql: `SELECT ROUND(SUM(v."total_si") / NULLIF(COUNT(DISTINCT v."reg_ventas"), 0), 2) AS value
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
          label: "Devoluciones",
          sql: `SELECT COALESCE(ABS(SUM(v."total_si")), 0) AS value
FROM "public"."ps_ventas" v
WHERE v."entrada" = false
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__`,
          format: "currency",
          prefix: "€",
        },
      ],
    },
    {
      id: "ventas-por-tienda",
      type: "bar_chart",
      title: "Ventas por Tienda (período seleccionado)",
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
      id: "ventas-tendencia-semanal",
      type: "line_chart",
      title: "Tendencia Semanal (período seleccionado)",
      sql: `SELECT DATE_TRUNC('week', v."fecha_creacion") AS x, SUM(v."total_si") AS y
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
  AND __gf_tienda__
GROUP BY DATE_TRUNC('week', v."fecha_creacion")
ORDER BY x`,
      x: "x",
      y: "y",
    },
    {
      id: "ventas-formas-pago",
      type: "donut_chart",
      title: "Mix de Formas de Pago (período seleccionado)",
      sql: `SELECT p."forma" AS label,
       SUM(p."importe_cob") AS value
FROM "public"."ps_pagos_ventas" p
JOIN "public"."ps_ventas" v ON p."num_ventas" = v."reg_ventas"
WHERE v."entrada" = true
  AND p."tienda" <> '99'
  AND p."fecha_creacion" >= :curr_from
  AND p."fecha_creacion" <= :curr_to
  AND __gf_tienda__
GROUP BY p."forma"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "ventas-margen-tienda",
      type: "bar_chart",
      title: "Margen Bruto % por Tienda (período seleccionado)",
      sql: `SELECT lv."tienda" AS label,
       ROUND((SUM(lv."total_si") - SUM(lv."total_coste_si"))
         / NULLIF(SUM(lv."total_si"), 0) * 100, 1) AS value
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
GROUP BY lv."tienda"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "ventas-top-articulos",
      type: "table",
      title: "Top 10 Artículos (período seleccionado)",
      sql: `SELECT p."ccrefejofacm" AS "Referencia",
       p."descripcion" AS "Descripción",
       SUM(lv."unidades") AS "Unidades",
       SUM(lv."total_si") AS "Ventas Netas",
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
GROUP BY p."ccrefejofacm", p."descripcion"
ORDER BY "Ventas Netas" DESC
LIMIT 10`,
    },
  ],
};
