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
