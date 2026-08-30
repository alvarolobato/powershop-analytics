import { describe, it, expect } from "vitest";
import { INSTRUCTIONS, SQL_PAIRS, SCHEMA } from "../knowledge";

/**
 * El bundle no puede negar columnas que SÍ existen en el espejo.
 *
 * Durante meses una regla decía que `talla` no estaba replicada en
 * `ps_lineas_ventas`. Cuando el ETL la trajo (D-048), la regla se quedó, y el
 * modelo respondía "ese dato no está sincronizado" a preguntas que ya se
 * podían contestar. Es el peor tipo de conocimiento obsoleto: no falla, miente
 * con seguridad.
 *
 * Lo señaló Copilot revisando el PR que actualizaba una de esas reglas — las
 * otras seguían diciendo lo contrario y el bundle quedaba contradictorio
 * consigo mismo.
 *
 * Columnas verificadas contra producción el 2026-08-30, tras la
 * resincronización completa (run 1516, 23/23 tablas, 20.011.868 filas).
 */

/** Columnas que existen en el espejo desplegado y que nadie debe negar. */
const EXISTEN: Array<[tabla: string, columna: string]> = [
  ["ps_lineas_ventas", "talla"],
  ["ps_lineas_ventas", "entrada"],
  ["ps_lineas_ventas", "movimiento_caja"],
  ["ps_stock_tienda", "talla"],
  ["ps_traspasos", "talla"],
];

const texto = JSON.stringify({ INSTRUCTIONS, SQL_PAIRS, SCHEMA });

describe("el bundle no niega columnas que existen", () => {
  it("el bundle no está vacío", () => {
    // Sin esto el test pasaría sobre una cadena vacía.
    expect(texto.length).toBeGreaterThan(10_000);
  });

  it.each(EXISTEN)("%s.%s no se declara ausente", (tabla, columna) => {
    // Formas en que una regla puede negar la columna. La ventana es corta a
    // propósito: buscamos la negación pegada al nombre, no en otro párrafo.
    const negaciones = [
      new RegExp(
        `${columna}[^.]{0,80}NO\\s+est[aá][^.]{0,40}(replicad|espejad|sincronizad)`,
        "i",
      ),
      new RegExp(`${columna}\\s+NO\\s+esta\\s+en\\s+${tabla}`, "i"),
      new RegExp(`${tabla}[^.]{0,60}(no tiene|sin)\\s+${columna}\\b`, "i"),
      new RegExp(
        `nunca inventes una columna ${columna}[^.]{0,40}${tabla}`,
        "i",
      ),
    ];
    for (const re of negaciones) {
      const m = texto.match(re);
      expect(
        m?.[0] ?? null,
        `el bundle niega ${tabla}.${columna}: "${m?.[0]}"`,
      ).toBeNull();
    }
  });
});
