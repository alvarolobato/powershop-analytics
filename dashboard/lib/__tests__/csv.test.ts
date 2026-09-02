import { describe, expect, it } from "vitest";
import { aCsv, escaparCelda, nombreDeFichero } from "@/lib/csv";

/**
 * El objetivo no es un CSV canónico: es un fichero que al abrirlo con doble
 * clic en un Excel español se vea bien y con los números sumables. De ahí el
 * `;`, los decimales con coma y el BOM.
 */
describe("escaparCelda", () => {
  it("los decimales van con coma, que es lo que Excel-es lee como número", () => {
    expect(escaparCelda(1234.56)).toBe("1234,56");
  });

  it("no mete separador de millares: Excel lo leería como texto", () => {
    expect(escaparCelda(1234567.89)).toBe("1234567,89");
    expect(escaparCelda(1234567.89)).not.toContain(".");
  });

  it("entrecomilla si el valor lleva el separador", () => {
    expect(escaparCelda("LUCAS; FASHION")).toBe('"LUCAS; FASHION"');
  });

  it("duplica las comillas internas, como manda el RFC", () => {
    expect(escaparCelda('talla "U"')).toBe('"talla ""U"""');
  });

  it("entrecomilla los saltos de línea", () => {
    expect(escaparCelda("linea1\nlinea2")).toBe('"linea1\nlinea2"');
  });

  it("nulo y vacío se quedan vacíos, no como 'null'", () => {
    expect(escaparCelda(null)).toBe("");
    expect(escaparCelda(undefined)).toBe("");
  });

  it("NaN e Infinity no ensucian la celda", () => {
    expect(escaparCelda(NaN)).toBe("");
    expect(escaparCelda(Infinity)).toBe("");
  });

  // --- Lo que los tests no cubrían y por eso el bug llegó a producción ---
  //
  // Postgres devuelve NUMERIC y BIGINT como TEXTO. Los tests de arriba sólo
  // alimentaban `number` de JS, así que pasaban en vacío justo en el caso
  // central: con datos reales el CSV salía con punto decimal y el Excel
  // español lo leía como texto no sumable.
  it("un decimal que llega COMO TEXTO también se convierte", () => {
    // Lo que devuelve de verdad /api/query para total_si.
    expect(escaparCelda("12.20")).toBe("12,20");
    expect(escaparCelda("0.00")).toBe("0,00");
    expect(escaparCelda("53246.93")).toBe("53246,93");
  });

  it("un negativo en texto también", () => {
    expect(escaparCelda("-1234.56")).toBe("-1234,56");
  });

  it("un entero en texto se deja como está: convertirlo no cambia nada", () => {
    expect(escaparCelda("43")).toBe("43");
  });

  it("una referencia con pinta de número NO se toca", () => {
    // `ccrefejofacm` y códigos similares: si se tratasen como número, Excel
    // podría comerse ceros a la izquierda o pasarlos a notación científica.
    expect(escaparCelda("V26490995")).toBe("V26490995");
    expect(escaparCelda("0012")).toBe("0012");
    expect(escaparCelda("1.2.3")).toBe("1.2.3");
    expect(escaparCelda("12,20")).toBe("12,20");
  });

  it("un texto normal no se toca", () => {
    expect(escaparCelda("LUCAS FASHION")).toBe("LUCAS FASHION");
  });
});

describe("aCsv", () => {
  it("cabecera y filas, separadas por ; y CRLF", () => {
    const csv = aCsv(["Proveedor", "Ventas"], [["LUCAS", 53246.93]]);
    expect(csv).toContain("Proveedor;Ventas");
    expect(csv).toContain("LUCAS;53246,93");
    expect(csv).toContain("\r\n");
  });

  it("empieza por BOM, o Excel rompe los acentos", () => {
    const csv = aCsv(["Descripción"], [["Chaqueta punto lúrex"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("una tabla vacía sigue exportando la cabecera", () => {
    expect(aCsv(["a", "b"], [])).toBe("\uFEFFa;b");
  });

  it("una fila TAL CUAL la devuelve /api/query", () => {
    // Medido: los NUMERIC llegan como string, el COUNT(*)::int como number.
    const csv = aCsv(
      ["Referencia", "Importe", "Unidades", "Tickets"],
      [["V26490995", "12.20", "1.00", 43]],
    );
    expect(csv.split("\r\n")[1]).toBe("V26490995;12,20;1,00;43");
  });

  it("un caso real del panel de rentabilidad", () => {
    const csv = aCsv(
      ["Proveedor", "Temporada", "Ventas Netas", "Margen %"],
      [
        ["LUCAS FASHION", "V26", 53246.93, 66.2],
        ["CHLOE&LUCAS S.L", "V26", null, null],
      ],
    );
    const lineas = csv.split("\r\n");
    expect(lineas[0]).toBe("﻿Proveedor;Temporada;Ventas Netas;Margen %");
    expect(lineas[1]).toBe("LUCAS FASHION;V26;53246,93;66,2");
    expect(lineas[2]).toBe("CHLOE&LUCAS S.L;V26;;");
  });
});

describe("nombreDeFichero", () => {
  const fecha = new Date("2026-09-01T10:00:00Z");

  it("quita acentos y espacios", () => {
    expect(nombreDeFichero("Rentabilidad por Proveedor", fecha)).toBe(
      "rentabilidad-por-proveedor-2026-09-01.csv",
    );
  });

  it("quita lo que Windows no admite en un nombre", () => {
    expect(nombreDeFichero('Ventas / Margen: "2026"', fecha)).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("un título vacío no produce un nombre roto", () => {
    expect(nombreDeFichero("", fecha)).toBe("datos-2026-09-01.csv");
  });

  it("un título larguísimo se recorta", () => {
    const n = nombreDeFichero("x".repeat(200), fecha);
    expect(n.length).toBeLessThan(80);
  });
});
