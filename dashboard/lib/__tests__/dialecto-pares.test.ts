import { describe, it, expect } from "vitest";
import { KNOWLEDGE_INDEX } from "../knowledge-index";

/**
 * Ningún par de `sql-pairs.md` puede quedar etiquetado como dialecto 4D.
 *
 * El clasificador marca 4D cualquier sección con `FROM`/`JOIN` sobre una tabla
 * del ERP, y ante la duda gana 4D a propósito: una consulta 4D presentada como
 * PostgreSQL revienta en producción. El efecto secundario es que basta llamar
 * `ventas` a una CTE para que un par PostgreSQL perfectamente válido salga
 * etiquetado como no ejecutable y el modelo lo descarte.
 *
 * Pasó al añadir el par de compras contra ventas por talla (#918): la CTE se
 * llamaba `ventas`, `JOIN ventas` casó con la tabla 4D `Ventas` y el par se fue
 * a 4D sin que nada fallara. El recuento del build es la única señal, y nadie
 * lee un recuento.
 */
describe("los pares SQL son todos PostgreSQL", () => {
  const secciones = KNOWLEDGE_INDEX.filter((s) =>
    String(s.file ?? s.source ?? "").includes("sql-pairs.md"),
  );

  it("encuentra los pares en el índice", () => {
    expect(secciones.length).toBeGreaterThanOrEqual(20);
  });

  it("ninguno está etiquetado como 4D", () => {
    const malos = secciones
      .filter((s) => s.dialect === "4d")
      .map((s) => s.title ?? s.heading ?? "(sin título)");
    expect(
      malos,
      `Pares etiquetados como 4D — casi siempre por una CTE que se llama como ` +
        `una tabla del ERP (ventas, compras, articulos...). Renómbrala:\n${malos.join("\n")}`,
    ).toEqual([]);
  });
});
