/**
 * Fragmentos SQL compartidos por plantillas, review-queries y documentación.
 *
 * Viven en un solo sitio porque son REGLAS DE NEGOCIO, no detalles de una
 * consulta: si el criterio cambia, debe cambiar en un punto y no en veintitantos.
 */

/** CIF de las sociedades del propio grupo (LINFE LDA / MHIA, Portugal). */
export const CIF_INTRAGRUPO = "502108150";

/**
 * Excluye el tráfico intragrupo de una consulta mayorista.
 *
 * El CIF `502108150` está repartido en 19 registros de `ps_clientes` con
 * `num_cliente` y nombres distintos (LINFE FUNCHAL, MHIA TOMAR, ...), así que
 * la exclusión va SIEMPRE por NIF y nunca por nombre.
 *
 * ## Por qué `NOT EXISTS` y no un JOIN
 *
 * La versión que estaba documentada era
 * `JOIN ps_clientes c ON a.num_cliente = c.reg_cliente WHERE COALESCE(c.nif,'') <> '...'`,
 * y ese JOIN es INNER: descarta en silencio los albaranes cuyo `num_cliente` no
 * existe en `ps_clientes`. No es hipotético — medido en producción 2026-08-30:
 *
 * | variante                  | albaranes 2026 |
 * |---------------------------|----------------|
 * | sin excluir nada          | 5.424          |
 * | INNER JOIN + nif <> CIF   | 5.383          |
 * | NOT EXISTS (esta)         | 5.386          |
 *
 * 5.424 − 38 intragrupo = 5.386. El INNER JOIN se llevaba por delante 3
 * albaranes reales de 2026 (70 de 52.148 en el total histórico).
 *
 * `NOT EXISTS` además es seguro ante NULL: un `num_cliente` nulo o huérfano no
 * casa, la subconsulta no encuentra nada y la fila SE CONSERVA — que es la
 * semántica que queremos. Un `NOT IN` daría lo contrario en cuanto la
 * subconsulta devolviese un NULL.
 *
 * @param alias alias de la tabla mayorista (`ps_gc_albaranes` / `ps_gc_facturas`)
 *              que aporta la columna `num_cliente`.
 */
export function sinIntragrupo(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM "public"."ps_clientes" ci
    WHERE ci."reg_cliente" = ${alias}."num_cliente"
      AND COALESCE(ci."nif", '') = '${CIF_INTRAGRUPO}'
  )`;
}

/**
 * Importe mayorista NETO de abonos.
 *
 * Los abonos (notas de crédito) se guardan **en positivo**, igual que las
 * devoluciones de retail en [D-057]. Medido en producción 2026-08-30 sobre
 * `ps_gc_lin_facturas`: de 220.967 líneas de abono, 220.885 son positivas y 4
 * negativas; en cabecera, 8.595 de 8.597 abonos tienen `base1+2+3` positiva.
 *
 * Por eso `WHERE abono IS NOT TRUE` **no resta la devolución, la ignora**, y la
 * facturación sale inflada:
 *
 * |            | excluyendo abonos | neto        | diferencia |
 * |------------|-------------------|-------------|------------|
 * | 2026       | 3.677.893 €       | 3.199.868 € | −13,0 %    |
 * | histórico  | 53.880.139 €      | 47.169.063 €| −12,5 %    |
 *
 * El `COALESCE` va en **cada lado** y es obligatorio: sin él, un periodo sin
 * abonos hace `SUM(...) FILTER (WHERE abono)` → NULL, y `algo − NULL` es NULL,
 * de modo que la cifra desaparece en vez de quedarse igual. Es exactamente el
 * fallo que D-057 documenta para retail.
 *
 * @param expr  expresión de importe, ya cualificada (p. ej. `f."total_factura"`)
 * @param alias alias de la tabla que aporta la columna `abono`
 */
export function netoDeAbonos(expr: string, alias: string): string {
  return `COALESCE(SUM(${expr}) FILTER (WHERE ${alias}."abono" IS NOT TRUE), 0)
        - COALESCE(SUM(${expr}) FILTER (WHERE ${alias}."abono" IS TRUE), 0)`;
}

/**
 * Modelo de una referencia de artículo, sin el código de color.
 *
 * Una fila de `ps_articulos` es **modelo + color**, no un SKU: los dos últimos
 * caracteres de `ccrefejofacm` son el color, y la talla vive en
 * `ps_lineas_ventas.talla` ([D-048]). Verificado en producción 2026-08-30:
 *
 * | ccrefejofacm | color  |
 * |--------------|--------|
 * | V26342820    | BLANCO |
 * | V26342821    | BEIG   |
 * | V26342830    | MARRON |
 * | V26342855    | KAKY   |
 * | V26342899    | NEGRO  |
 *
 * Por eso un "top artículos" agrupado por la referencia completa parte el mismo
 * pantalón en cinco filas y ninguna encabeza el ranking. Medido sobre agosto de
 * 2026: 2.918 referencias son 1.448 modelos, 2,02 filas de media, y los más
 * vendidos se parten en 4-5.
 *
 * ## La guarda de longitud no es decorativa
 *
 * `LEFT(x, LENGTH(x) - 2)` sobre una referencia de 1 o 2 caracteres devuelve
 * cadena vacía, y en producción hay 9 así (1 vacía y 8 de 1-2 caracteres, sobre
 * 42.270). Sin la guarda, esas nueve se funden en un único modelo fantasma.
 *
 * @param col columna ya cualificada, p. ej. `p."ccrefejofacm"`
 */
export function modeloDeReferencia(col: string): string {
  const ref = `TRIM(COALESCE(${col}, ''))`;
  return `CASE WHEN LENGTH(${ref}) > 2
              THEN LEFT(${ref}, LENGTH(${ref}) - 2)
              ELSE NULLIF(${ref}, '')
         END`;
}
