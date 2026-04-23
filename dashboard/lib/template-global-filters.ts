import type { GlobalFilter } from "./schema";

/**
 * Global filters for pre-built dashboard templates.
 *
 * Each filter declaration wires a combobox in the dashboard chrome to a
 * `__gf_<id>__` token that widget SQL can reference inside a WHERE clause.
 * When a filter is inactive (no selection) the token expands to `TRUE`,
 * so widgets that don't use a given filter don't need to change.
 *
 * ## Alias conventions used by the widget SQL
 * Widgets that opt into each filter MUST use these aliases (or an equivalent
 * joined column) so that `bind_expr` matches:
 *
 *   v   — "public"."ps_ventas"
 *   lv  — "public"."ps_lineas_ventas"
 *   p   — "public"."ps_articulos"
 *   fm  — "public"."ps_familias"
 *   pr  — "public"."ps_proveedores"
 *   lf  — "public"."ps_gc_lin_facturas"
 *   f   — "public"."ps_gc_facturas"
 *   c   — "public"."ps_clientes"
 *   s   — "public"."ps_stock_tienda"
 *   lc  — "public"."ps_lineas_compras"
 *   co  — "public"."ps_compras"
 */

// ---------------------------------------------------------------------------
// Individual filter definitions
// ---------------------------------------------------------------------------

const TIENDA: GlobalFilter = {
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
};

const FAMILIA: GlobalFilter = {
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
};

/** Temporada (clave code of the season, e.g. "75" for PV12). Text key stored on ps_articulos.clave_temporada. */
const TEMPORADA: GlobalFilter = {
  id: "temporada",
  type: "multi_select",
  label: "Temporada",
  bind_expr: `p."clave_temporada"`,
  value_type: "text",
  options_sql: `SELECT DISTINCT t."clave" AS value,
       COALESCE(NULLIF(t."temporada_tipo", ''), t."clave") AS label
FROM "public"."ps_temporadas" t
WHERE t."clave" IS NOT NULL AND t."clave" <> ''
ORDER BY 1`,
};

/** Marca (brand). Joined via ps_articulos.num_marca → ps_marcas.reg_marca. */
const MARCA: GlobalFilter = {
  id: "marca",
  type: "multi_select",
  label: "Marca",
  bind_expr: `p."num_marca"`,
  value_type: "numeric",
  options_sql: `SELECT m."reg_marca" AS value, m."clave" AS label
FROM "public"."ps_marcas" m
WHERE m."clave" IS NOT NULL AND m."clave" <> ''
ORDER BY 2`,
};

/** Sexo — plain text on ps_articulos.sexo (HOMBRE / MUJER / …). */
const SEXO: GlobalFilter = {
  id: "sexo",
  type: "multi_select",
  label: "Sexo",
  bind_expr: `p."sexo"`,
  value_type: "text",
  options_sql: `SELECT DISTINCT p."sexo" AS value, p."sexo" AS label
FROM "public"."ps_articulos" p
WHERE p."sexo" IS NOT NULL AND p."sexo" <> ''
ORDER BY 1`,
};

/** Departamento — FK numeric on ps_articulos.num_departament → ps_departamentos.reg_departament. */
const DEPARTAMENTO: GlobalFilter = {
  id: "departamento",
  type: "multi_select",
  label: "Departamento",
  bind_expr: `p."num_departament"`,
  value_type: "numeric",
  options_sql: `SELECT d."reg_departament" AS value,
       COALESCE(NULLIF(d."depa_secc_fabr", ''), d."clave") AS label
FROM "public"."ps_departamentos" d
WHERE d."clave" IS NOT NULL AND d."clave" <> ''
ORDER BY 2`,
};

/** Proveedor — FK numeric on ps_articulos.num_proveedor / ps_compras.num_proveedor. */
const PROVEEDOR_ARTICULO: GlobalFilter = {
  id: "proveedor",
  type: "multi_select",
  label: "Proveedor",
  bind_expr: `p."num_proveedor"`,
  value_type: "numeric",
  options_sql: `SELECT pr."reg_proveedor" AS value, pr."nombre" AS label
FROM "public"."ps_proveedores" pr
WHERE pr."nombre" IS NOT NULL AND pr."nombre" <> ''
ORDER BY 2`,
};

/** Proveedor for purchasing-scope dashboards — binds to ps_compras.num_proveedor via alias `co`. */
const PROVEEDOR_COMPRAS: GlobalFilter = {
  ...PROVEEDOR_ARTICULO,
  id: "proveedor_compras",
  bind_expr: `co."num_proveedor"`,
};

/** Cliente mayorista — binds to ps_gc_facturas.num_cliente via alias `f`. */
const CLIENTE_MAYORISTA: GlobalFilter = {
  id: "cliente_mayorista",
  type: "multi_select",
  label: "Cliente Mayorista",
  bind_expr: `f."num_cliente"`,
  value_type: "numeric",
  options_sql: `SELECT c."reg_cliente" AS value, c."nombre" AS label
FROM "public"."ps_clientes" c
JOIN "public"."ps_gc_facturas" gf ON gf."num_cliente" = c."reg_cliente"
WHERE c."nombre" IS NOT NULL AND c."nombre" <> ''
  AND gf."abono" = false
  AND gf."fecha_factura" >= :curr_from
  AND gf."fecha_factura" <= :curr_to
GROUP BY c."reg_cliente", c."nombre"
ORDER BY 2`,
};

/** Familia for purchasing / stock when there is no ps_ventas scope on the date. */
const FAMILIA_CATALOG: GlobalFilter = {
  ...FAMILIA,
  options_sql: `SELECT fm."fami_grup_marc" AS value, fm."fami_grup_marc" AS label
FROM "public"."ps_familias" fm
WHERE fm."fami_grup_marc" IS NOT NULL AND fm."fami_grup_marc" <> ''
ORDER BY 1`,
};

/** Tienda for stock — not constrained by ps_ventas date. */
const TIENDA_STOCK: GlobalFilter = {
  id: "tienda",
  type: "single_select",
  label: "Tienda",
  bind_expr: `s."tienda"`,
  value_type: "text",
  options_sql: `SELECT DISTINCT s."tienda" AS value, s."tienda" AS label
FROM "public"."ps_stock_tienda" s
WHERE s."tienda" <> '99'
ORDER BY 1`,
};

// ---------------------------------------------------------------------------
// Template filter sets
// ---------------------------------------------------------------------------

/**
 * Retail-scope dashboards (ventas, general). Widgets that join ps_articulos
 * as alias `p` gain access to temporada / marca / sexo / departamento
 * filters (bind_expr above binds to `p."<col>"` exactly). Widgets that stay
 * on ps_ventas only use `__gf_tienda__`.
 */
export const templateGlobalFiltersRetail: GlobalFilter[] = [
  TIENDA,
  FAMILIA,
  TEMPORADA,
  MARCA,
  SEXO,
  DEPARTAMENTO,
];

/** Wholesale dashboards: facturas/lineas via `f`/`lf`, articles via `p`. */
export const templateGlobalFiltersMayorista: GlobalFilter[] = [
  CLIENTE_MAYORISTA,
  FAMILIA_CATALOG,
  TEMPORADA,
  MARCA,
];

/** Stock dashboards. Date-free; tienda scopes ps_stock_tienda. */
export const templateGlobalFiltersStock: GlobalFilter[] = [
  TIENDA_STOCK,
  FAMILIA_CATALOG,
  TEMPORADA,
  MARCA,
];

/**
 * Purchasing dashboards. proveedor_compras binds to ps_compras.num_proveedor.
 *
 * NOTE: familia / temporada are intentionally NOT included here. The compras
 * template widgets do not join ps_lineas_compras → ps_articulos → ps_familias
 * / ps_temporadas, so declaring those filters would render combobox chrome
 * that has no effect on any widget. Wire the joins into compras widgets first
 * before adding those filters back.
 */
export const templateGlobalFiltersCompras: GlobalFilter[] = [
  PROVEEDOR_COMPRAS,
];
