/**
 * Template: Director General
 *
 * Executive overview: retail + wholesale revenue, channel mix, 12-month trend.
 */
import type { DashboardSpec } from "@/lib/schema";

export const name = "Director General";

export const description =
  "Panel ejecutivo: ventas retail, facturacion mayorista, margen global, mix de canales y tendencia 12 meses.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Director General",
  description,
  widgets: [
    {
      id: "general-kpis",
      type: "kpi_row",
      items: [
        {
          label: "Ventas Retail Netas",
          sql: `SELECT COALESCE(SUM("total_si"), 0) AS value
FROM "public"."ps_ventas"
WHERE "entrada" = true
  AND "tienda" <> '99'
  AND "fecha_creacion" >= DATE_TRUNC('year', CURRENT_DATE)`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Facturacion Mayorista",
          sql: `SELECT COALESCE(SUM("base1" + "base2" + "base3"), 0) AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= DATE_TRUNC('year', CURRENT_DATE)`,
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
WHERE v."entrada" = true
  AND lv."tienda" <> '99'
  AND lv."total_si" > 0
  AND lv."fecha_creacion" >= DATE_TRUNC('year', CURRENT_DATE)`,
          format: "percent",
        },
      ],
    },
    {
      id: "general-mix-canales",
      type: "donut_chart",
      title: "Mix Retail vs Mayorista (YTD)",
      sql: `SELECT 'Retail' AS label,
       COALESCE(SUM("total_si"), 0) AS value
FROM "public"."ps_ventas"
WHERE "entrada" = true
  AND "tienda" <> '99'
  AND "fecha_creacion" >= DATE_TRUNC('year', CURRENT_DATE)
UNION ALL
SELECT 'Mayorista' AS label,
       COALESCE(SUM("base1" + "base2" + "base3"), 0) AS value
FROM "public"."ps_gc_facturas"
WHERE "abono" = false
  AND "fecha_factura" >= DATE_TRUNC('year', CURRENT_DATE)`,
      x: "label",
      y: "value",
    },
    {
      id: "general-tendencia-12m",
      type: "line_chart",
      title: "Tendencia Mensual (ultimos 12 meses)",
      sql: `SELECT DATE_TRUNC('month', "fecha_creacion") AS x,
       SUM("total_si") AS y
FROM "public"."ps_ventas"
WHERE "entrada" = true
  AND "tienda" <> '99'
  AND "fecha_creacion" >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', "fecha_creacion")
ORDER BY x`,
      x: "x",
      y: "y",
    },
  ],
};
