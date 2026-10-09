import { describe, it, expect } from "vitest";
import { extraerTokens, MAX_TOKENS_POR_MENSAJE } from "../articulo-tokens";

describe("extraerTokens", () => {
  it("recoge referencias, modelos y códigos de una tabla markdown", () => {
    const md = [
      "| Modelo | Descripción | Unidades |",
      "|---|---|---|",
      "| I263002 | T-SHIRT M/LARGA CUELLO REDONDO | 302 |",
      "| V263428 | PANTALÓN C/BOTONES DE LADO | 290 |",
    ].join("\n");

    expect(extraerTokens(md)).toEqual(["I263002", "V263428"]);
  });

  it("no pregunta por las palabras de las descripciones", () => {
    // Sin dígito no hay token: es lo que evita mandar media descripción a la BD.
    const tokens = extraerTokens("PANTALÓN PINZAS C/CINTURÓN y CAMISA CUADROS");
    expect(tokens).toEqual([]);
  });

  it("descarta fechas e importes, que abundan en las respuestas", () => {
    expect(extraerTokens("entre 2026-10-01 y el 09/10, 0000 unidades")).toEqual([]);
  });

  it("ignora los bloques de código, donde vive el SQL de la respuesta", () => {
    const md = [
      "El más vendido es I263002.",
      "```sql",
      "SELECT ccrefejofacm, COUNT(*) FROM ps_lineas_ventas WHERE tienda = '99'",
      "```",
    ].join("\n");

    expect(extraerTokens(md)).toEqual(["I263002"]);
  });

  it("no repite un token que aparece muchas veces", () => {
    expect(extraerTokens("I263002 y otra vez I263002 y I263002")).toEqual(["I263002"]);
  });

  it("recoge también lo que va en prosa, negrita o `código`", () => {
    const md = "El **V26212484** y el **I263002** se venden juntos.";
    expect(extraerTokens(md).sort()).toEqual(["I263002", "V26212484"]);
  });

  it("NO recoge una cifra suelta, aunque pudiera ser un código", () => {
    // Los códigos de artículo son numéricos, así que una cantidad o un año
    // podrían existir como código y tener foto. Enseñarla sobre «302
    // unidades» sería absurdo, así que un candidato implícito necesita letra
    // Y dígito. Un código numérico llega por el canal explícito.
    expect(extraerTokens("Vendió 1234 unidades por 56789 euros en 2026")).toEqual([]);
  });

  it("un código numérico SÍ entra si va en un enlace explícito", () => {
    expect(extraerTokens("Mira la [BLUSA](articulo:144750).")).toEqual(["144750"]);
  });

  it("corta en el tope por mensaje", () => {
    const md = Array.from({ length: MAX_TOKENS_POR_MENSAJE + 50 }, (_, i) => `REF${1000 + i}`).join(
      " ",
    );
    expect(extraerTokens(md)).toHaveLength(MAX_TOKENS_POR_MENSAJE);
  });

  it("un texto vacío no da tokens", () => {
    expect(extraerTokens("")).toEqual([]);
  });
});
