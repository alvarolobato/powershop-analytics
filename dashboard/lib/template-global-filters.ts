import type { GlobalFilter } from "./schema";

/**
 * Default global filters for retail-heavy dashboard templates (v1).
 * Widget SQL must alias `ps_ventas` as `v` where `__gf_tienda__` is used, and
 * include joins to `ps_familias` as `fm` where `__gf_familia__` is used.
 */
export const templateGlobalFiltersRetail: GlobalFilter[] = [
  {
    id: "tienda",
    type: "single_select",
    label: "Tienda",
    bind_expr: `v."tienda"`,
    value_type: "text",
    options_sql: `SELECT DISTINCT v."tienda" AS value, v."tienda" AS label
FROM "public"."ps_ventas" v
WHERE v."entrada" = true
  AND v."tienda" <> '99'
  AND v."fecha_creacion" >= :curr_from
  AND v."fecha_creacion" <= :curr_to
ORDER BY 1`,
  },
  {
    id: "familia",
    type: "multi_select",
    label: "Familia",
    bind_expr: `fm."fami_grup_marc"`,
    value_type: "text",
    options_sql: `SELECT DISTINCT fm."fami_grup_marc" AS value, fm."fami_grup_marc" AS label
FROM "public"."ps_lineas_ventas" lv
JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
JOIN "public"."ps_articulos" p ON lv."codigo" = p."codigo"
JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE v."entrada" = true
  AND lv."tienda" <> '99'
  AND lv."fecha_creacion" >= :curr_from
  AND lv."fecha_creacion" <= :curr_to
  AND __gf_tienda__
ORDER BY 1`,
  },
];
