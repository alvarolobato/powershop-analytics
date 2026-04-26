/**
 * Template: Responsable de Stock
 *
 * Stock overview for the warehouse / inventory manager: point-in-time stock
 * totals, valuation at cost, distribution by store and family, low-stock and
 * out-of-stock alerts, dead-stock detection, and recent transfers.
 *
 * Business decisions documented in this header (see issue #415):
 *
 * 1. **Point-in-time vs windowed.** All stock KPIs and the by-store / by-family
 *    bar charts are *point-in-time* — they reflect the current state of
 *    `ps_stock_tienda` and intentionally do **not** apply `:curr_from` /
 *    `:curr_to`. Only the dead-stock lookback ("sin ventas en período") and
 *    "Traspasos recientes" widgets react to the date picker.
 *
 * 2. **No central-warehouse mirror.** Tienda code `'99'` is the central
 *    warehouse in PowerShop, but its stock lives in the separate `CCStock`
 *    4D table which is **not** synced to PostgreSQL. `Exportaciones.CCStock`
 *    (mirrored as `ps_stock_tienda.cc_stock`) is the **per-row net stock**
 *    for `(Codigo, TiendaCodigo)` — *not* the central warehouse balance —
 *    so attempting to pull "Almacén Central" from this table would be
 *    misleading. We surface a Stock Negativo incidencias KPI instead, and
 *    document the gap. (See `docs/architecture/stock-logistics.md` and
 *    `DECISIONS-AND-CHANGES.md` D-017.)
 *
 * 3. **Signed-int16 stock (D-017).** `ps_stock_tienda.stock` already passes
 *    through the ETL `decode_signed_int16_word()` decoder, so negatives from
 *    POS (e.g. `-1`) appear as negatives, not as `65535`. Verified at review
 *    time: 9 222 rows with `stock < 0`, range `-122..-1`, 0 rows with
 *    `stock > 32767`. The "Incidencias Stock Negativo" KPI gives a daily
 *    sanity check that the decoder is still applied end-to-end.
 *
 * 4. **MA-prefix articles.** `ccrefejofacm LIKE 'MA%'` (materials: bags,
 *    hangers, packaging) are **excluded at ETL load time** — they never
 *    reach `ps_articulos` or `ps_stock_tienda`, so widgets do not need an
 *    explicit `NOT LIKE 'MA%'` filter. (See `lib/knowledge.ts`.)
 *
 * 5. **Wholesale (M-prefix) articles.** `ccrefejofacm LIKE 'M%'` (without
 *    'MA') are wholesale references that DO live in `ps_articulos` and may
 *    carry stock. They are *kept* in this stock dashboard because the
 *    inventory manager owns physical units regardless of channel; if a
 *    retail-only view is ever required, add `AND p."ccrefejofacm" NOT LIKE 'M%'`
 *    or expose it via a dedicated filter.
 *
 * 6. **Anulados.** `p."anulado" = false` is required on every widget that
 *    joins `ps_articulos`; without it ~20% of catalog rows (cancelled SKUs)
 *    bleed into the totals. The dead-stock subquery does *not* filter
 *    `anulado` on `ps_lineas_ventas` because that field lives on
 *    `ps_articulos` and the subquery only needs the `codigo` set.
 *
 * 7. **Familia join.** Always `LEFT JOIN ps_familias` (alias `fm`) so SKUs
 *    whose `num_familia` does not resolve to a `ps_familias` row are still
 *    counted (~1 254 units / ~4 000 SKUs in the live mirror would be silently
 *    dropped by an `INNER JOIN`). Familia label is `TRIM`-normalised to
 *    collapse the duplicate `'PANTALON'` / `'PANTALON '` entries that exist
 *    in `ps_familias`.
 *
 * 8. **Tienda filter on traspasos.** `__gf_tienda__` binds to `s."tienda"`
 *    via `templateGlobalFiltersStock.TIENDA_STOCK` and therefore cannot be
 *    applied to `ps_traspasos` rows (which have `tienda_salida` / `tienda_entrada`,
 *    not `tienda`). The traspasos table is intentionally not filtered by
 *    the global Tienda combobox; users can still filter it by date via the
 *    time picker.
 */
import type { DashboardSpec } from "@/lib/schema";
import { templateGlobalFiltersStock } from "@/lib/template-global-filters";

export const name = "Responsable de Stock";

export const description =
  "Panel para el responsable de stock: unidades totales, valoración al coste, distribución por tienda y familia, stock bajo, dead stock, sin stock y traspasos recientes.";

export const spec: DashboardSpec = {
  title: "Cuadro de Mandos — Stock",
  description,
  filters: templateGlobalFiltersStock,
  widgets: [
    {
      id: "stock-kpis",
      type: "kpi_row",
      items: [
        {
          // Point-in-time KPI — no :curr_from/:curr_to filter by design.
          // Alias ps_stock_tienda as `s` so __gf_tienda__ (bind: s."tienda") resolves.
          label: "Unidades en Tiendas",
          sql: `SELECT COALESCE(SUM(s."stock"), 0) AS value
FROM "public"."ps_stock_tienda" s
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND __gf_tienda__`,
          format: "number",
        },
        {
          // Replaces the previous (broken) "Unidades en Almacén Central" KPI:
          // tienda='99' rows do not exist in ps_stock_tienda (the central
          // warehouse stock lives in the un-mirrored CCStock 4D table). This
          // KPI surfaces the count of rows with negative stock — a direct
          // health check on the D-017 signed-int16 decoder and on inventory
          // regularisation pending in POS.
          label: "Incidencias Stock Negativo",
          sql: `SELECT COUNT(*) AS value
FROM "public"."ps_stock_tienda" s
WHERE s."stock" < 0
  AND s."tienda" <> '99'
  AND __gf_tienda__`,
          format: "number",
          inverted: true,
        },
        {
          label: "Valor Stock al Coste",
          sql: `SELECT COALESCE(ROUND(SUM(s."stock" * COALESCE(p."precio_coste", 0)), 2), 0) AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__`,
          format: "currency",
          prefix: "€",
        },
        {
          label: "Referencias Activas",
          sql: `SELECT COUNT(DISTINCT s."codigo") AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__`,
          format: "number",
        },
      ],
    },
    {
      id: "stock-por-tienda",
      type: "bar_chart",
      title: "Stock por Tienda (excluye almacén central)",
      // LEFT JOIN ps_familias so SKUs without a matching family row still count
      // (~1 254 units would be silently dropped by an INNER JOIN against the
      // current mirror).
      sql: `SELECT s."tienda" AS label, SUM(s."stock") AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
GROUP BY s."tienda"
ORDER BY value DESC`,
      x: "label",
      y: "value",
    },
    {
      id: "stock-por-familia",
      type: "bar_chart",
      title: "Stock por Familia (unidades, top 10)",
      // TRIM collapses the duplicate "PANTALON" / "PANTALON " family rows that
      // exist in ps_familias. LEFT JOIN keeps articles whose num_familia does
      // not resolve and labels them "Sin clasificar".
      sql: `SELECT
       COALESCE(NULLIF(TRIM(fm."fami_grup_marc"), ''), 'Sin clasificar') AS label,
       SUM(s."stock") AS value
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
GROUP BY 1
ORDER BY value DESC
LIMIT 10`,
      x: "label",
      y: "value",
    },
    {
      id: "stock-bajo",
      type: "table",
      title: "Artículos con Stock Bajo (< 5 unidades en alguna tienda)",
      // Identifier → ubicación → descripción → cantidad. Familia added so the
      // manager can scan low-stock items by category. NULL/empty references
      // surface as "—" instead of leaking through as raw NULL.
      sql: `SELECT
       s."tienda" AS "Tienda",
       COALESCE(NULLIF(p."ccrefejofacm", ''), '—') AS "Referencia",
       COALESCE(NULLIF(p."descripcion", ''), '—') AS "Descripción",
       COALESCE(NULLIF(TRIM(fm."fami_grup_marc"), ''), '—') AS "Familia",
       SUM(s."stock") AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0 AND s."stock" < 5
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
GROUP BY s."tienda", p."ccrefejofacm", p."descripcion", fm."fami_grup_marc"
ORDER BY "Stock" ASC, "Tienda" ASC
LIMIT 50`,
    },
    {
      id: "stock-sin-stock",
      type: "table",
      title: "Roturas: Artículos activos sin stock en tiendas",
      // Replaces the broken "Sin Stock en Tiendas (con stock en almacén)"
      // widget — that widget required tienda='99' rows in ps_stock_tienda
      // (the central warehouse) which do NOT exist in the mirror, so it
      // always returned zero. The list is intentionally large; combine with
      // the global Tienda / Temporada / Familia / Marca filters to narrow it down.
      // LEFT JOIN ps_stock_tienda so SKUs that have no row at all (never
      // distributed to stores) are still surfaced. __gf_tienda__ is wired into
      // the LEFT JOIN ON-clause so selecting a store narrows the meaning to
      // "no stock in the selected store" without breaking left-join semantics.
      sql: `SELECT
       COALESCE(NULLIF(p."ccrefejofacm", ''), '—') AS "Referencia",
       COALESCE(NULLIF(p."descripcion", ''), '—') AS "Descripción",
       COALESCE(NULLIF(TRIM(fm."fami_grup_marc"), ''), '—') AS "Familia",
       COALESCE(NULLIF(p."clave_temporada", ''), '—') AS "Temporada"
FROM "public"."ps_articulos" p
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
LEFT JOIN "public"."ps_stock_tienda" s
       ON s."codigo" = p."codigo"
      AND s."stock" > 0
      AND s."tienda" <> '99'
      AND __gf_tienda__
WHERE p."anulado" = false
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
GROUP BY p."codigo", p."ccrefejofacm", p."descripcion", fm."fami_grup_marc", p."clave_temporada"
HAVING COALESCE(SUM(s."stock"), 0) <= 0
ORDER BY p."clave_temporada" DESC NULLS LAST, p."descripcion" ASC
LIMIT 50`,
    },
    {
      id: "stock-dead-stock",
      type: "table",
      title: "Dead Stock (stock total > 10, sin ventas en período seleccionado)",
      // Identifier → familia → temporada → cantidad. Global filters apply on
      // the catalog side; the lookback window (curr_from/curr_to) defines the
      // "sin ventas" criterion. tienda <> '99' is a no-op on the live mirror
      // (no rows exist with tienda='99' in either ps_stock_tienda or
      // ps_lineas_ventas) but is kept for defence-in-depth.
      sql: `SELECT
       COALESCE(NULLIF(p."ccrefejofacm", ''), '—') AS "Referencia",
       COALESCE(NULLIF(p."descripcion", ''), '—') AS "Descripción",
       COALESCE(NULLIF(TRIM(fm."fami_grup_marc"), ''), '—') AS "Familia",
       COALESCE(NULLIF(p."clave_temporada", ''), '—') AS "Temporada",
       SUM(s."stock") AS "Stock"
FROM "public"."ps_stock_tienda" s
JOIN "public"."ps_articulos" p ON s."codigo" = p."codigo"
LEFT JOIN "public"."ps_familias" fm ON p."num_familia" = fm."reg_familia"
WHERE s."stock" > 0
  AND s."tienda" <> '99'
  AND p."anulado" = false
  AND __gf_tienda__
  AND __gf_familia__
  AND __gf_temporada__
  AND __gf_marca__
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."ps_lineas_ventas" lv
    JOIN "public"."ps_ventas" v ON lv."num_ventas" = v."reg_ventas"
    WHERE lv."codigo" = p."codigo"
      AND v."entrada" = true
      AND lv."tienda" <> '99'
      AND lv."fecha_creacion" >= :curr_from
      AND lv."fecha_creacion" <= :curr_to
  )
GROUP BY p."ccrefejofacm", p."descripcion", fm."fami_grup_marc", p."clave_temporada"
HAVING SUM(s."stock") > 10
ORDER BY "Stock" DESC
LIMIT 50`,
    },
    {
      id: "stock-traspasos-recientes",
      type: "table",
      title: "Traspasos Recientes (período seleccionado)",
      // Traspasos has tienda_salida / tienda_entrada (no plain "tienda"
      // column), so __gf_tienda__ — which binds to s."tienda" — is
      // intentionally NOT applied here. Filter via the time picker.
      // Header order: Fecha → Origen → Destino → Líneas → Unidades.
      sql: `SELECT
       t."fecha_s" AS "Fecha",
       COALESCE(NULLIF(t."tienda_salida", ''), '—') AS "Origen",
       COALESCE(NULLIF(t."tienda_entrada", ''), '—') AS "Destino",
       COUNT(*) AS "Líneas",
       COALESCE(SUM(t."unidades_s"), 0) AS "Unidades"
FROM "public"."ps_traspasos" t
WHERE t."entrada" = false
  AND t."fecha_s" >= :curr_from
  AND t."fecha_s" <= :curr_to
GROUP BY t."fecha_s", t."tienda_salida", t."tienda_entrada"
ORDER BY t."fecha_s" DESC, "Unidades" DESC
LIMIT 50`,
    },
  ],
};
