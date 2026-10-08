import { describe, expect, it } from "vitest";
import {
  celdaACodigo,
  celdaARef,
  detectArticleColumns,
  resolveArticleColumns,
} from "../articulo";

const NADA = { codigoIdx: null, refIdx: null, descIdx: null };

describe("detectArticleColumns", () => {
  it.each<[string, string[], ReturnType<typeof detectArticleColumns>]>([
    ["referencia sola", ["Referencia", "Unidades"], { codigoIdx: null, refIdx: 0, descIdx: null }],
    ["ref", ["ref", "uds"], { codigoIdx: null, refIdx: 0, descIdx: null }],
    ["ccrefejofacm", ["ccrefejofacm"], { codigoIdx: null, refIdx: 0, descIdx: null }],
    [
      "código + referencia + descripción",
      ["Código", "Referencia", "Descripción", "Importe"],
      { codigoIdx: 0, refIdx: 1, descIdx: 2 },
    ],
    [
      "sin acentos y en otro orden",
      ["descripcion", "referencia", "codigo"],
      { codigoIdx: 2, refIdx: 1, descIdx: 0 },
    ],
    ["cod + ref", ["cod", "ref"], { codigoIdx: 0, refIdx: 1, descIdx: null }],
    ["codigo_articulo solo", ["codigo_articulo", "Stock"], { codigoIdx: 0, refIdx: null, descIdx: null }],
    ["Cód. Artículo", ["Cód. Artículo", "Stock"], { codigoIdx: 0, refIdx: null, descIdx: null }],
    ["cod_articulo + descripción", ["cod_articulo", "Descripción"], { codigoIdx: 0, refIdx: null, descIdx: 1 }],
    [
      "el explícito gana al ambiguo",
      ["codigo", "codigo_articulo", "referencia"],
      { codigoIdx: 1, refIdx: 2, descIdx: null },
    ],
  ])("%s", (_nombre, columnas, esperado) => {
    expect(detectArticleColumns(columnas)).toEqual(esperado);
  });

  it("la descripción sola no activa nada", () => {
    expect(detectArticleColumns(["Descripción", "Unidades"])).toEqual(NADA);
    expect(detectArticleColumns(["descripcion"])).toEqual(NADA);
  });

  it("un 'codigo' sin referencia no es de artículo: puede ser de tienda, cliente o familia", () => {
    expect(detectArticleColumns(["Código", "Tienda", "Ventas"])).toEqual(NADA);
    // Ni con descripción: una tabla de familias también trae código + descripción.
    expect(detectArticleColumns(["Código", "Descripción"])).toEqual(NADA);
  });

  it("no se deja engañar por nombres que solo contienen la palabra", () => {
    expect(detectArticleColumns(["Referencia pedido", "Código postal", "Preferencia"])).toEqual(NADA);
    expect(detectArticleColumns(["Tienda", "Ventas"])).toEqual(NADA);
    expect(detectArticleColumns([])).toEqual(NADA);
  });
});

describe("resolveArticleColumns", () => {
  it("el spec gana a la heurística", () => {
    const cols = ["id_interno", "Modelo", "Descripción"];
    expect(resolveArticleColumns(cols, { articulo_codigo_col: "id_interno" })).toEqual({
      codigoIdx: 0,
      refIdx: null,
      descIdx: 2,
    });
    expect(resolveArticleColumns(cols, { articulo_ref_col: "Modelo" })).toEqual({
      codigoIdx: null,
      refIdx: 1,
      descIdx: 2,
    });
  });

  it("el spec legitima un 'codigo' que la heurística sola rechazaría", () => {
    expect(resolveArticleColumns(["Código", "Descripción"], { articulo_codigo_col: "Código" })).toEqual({
      codigoIdx: 0,
      refIdx: null,
      descIdx: 1,
    });
  });

  it("el nombre del spec casa aunque cambien mayúsculas o acentos", () => {
    expect(resolveArticleColumns(["Código", "x"], { articulo_codigo_col: "codigo" }).codigoIdx).toBe(0);
  });

  it("si el spec nombra una columna que no está, cae en la heurística", () => {
    expect(
      resolveArticleColumns(["Referencia", "Uds"], { articulo_codigo_col: "no_existe" }),
    ).toEqual({ codigoIdx: null, refIdx: 0, descIdx: null });
  });

  it("sin spec y sin heurística, nada", () => {
    expect(resolveArticleColumns(["Tienda", "Ventas"])).toEqual(NADA);
    expect(resolveArticleColumns(["Descripción"], {})).toEqual(NADA);
  });
});

describe("celdaACodigo / celdaARef", () => {
  it("acepta lo que acepta el servidor", () => {
    expect(celdaACodigo("144750")).toBe("144750");
    expect(celdaACodigo(144750)).toBe("144750");
    expect(celdaACodigo(" 169 ")).toBe("169");
    expect(celdaACodigo("AB-12_3.x")).toBe("AB-12_3.x");
  });

  it.each([null, undefined, "", "  ", "../144750", "1/2", "a b", ".oculto", "a".repeat(41), {}, [], true])(
    "rechaza %j",
    (v) => {
      expect(celdaACodigo(v)).toBeNull();
    },
  );

  it("una referencia es cualquier texto no vacío y razonable", () => {
    expect(celdaARef(" V26212484 ")).toBe("V26212484");
    expect(celdaARef("")).toBeNull();
    expect(celdaARef(null)).toBeNull();
    expect(celdaARef("x".repeat(81))).toBeNull();
  });
});
