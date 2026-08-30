import { describe, it, expect } from "vitest";
import { netoDeAbonos } from "../sql-fragments";
import { spec as specMayorista } from "../templates/mayorista";
import { spec as specGeneral } from "../templates/general";
import { spec as specInicio } from "../templates/inicio";
import { REVIEW_QUERIES } from "../review-queries";

/**
 * Los abonos mayoristas se guardan en POSITIVO (issue #920, medido en
 * producción: 220.885 de 220.967 líneas de abono son positivas). Por eso
 * `WHERE abono IS NOT TRUE` no resta la devolución, la ignora, y la
 * facturación salía inflada un 13 %.
 *
 * El fallo que vigila este fichero es más sutil que el original: netear con
 * `FILTER` y **dejar además** el filtro de fila. El lado del abono queda
 * entonces siempre vacío, el neto vuelve a ser el bruto, y todo parece
 * correcto porque la expresión del neteo está ahí. Me pasó al escribir esto
 * mismo, en el KPI de margen de `general.ts`.
 */

const TABLAS_MAYORISTAS = /ps_gc_(facturas|albaranes|pedidos|lin_)/;

function sqlDe(spec: unknown): string[] {
  const out: string[] = [];
  const visita = (n: unknown) => {
    if (typeof n === "string") {
      if (TABLAS_MAYORISTAS.test(n) && /\bFROM\b/i.test(n)) out.push(n);
    } else if (Array.isArray(n)) n.forEach(visita);
    else if (n && typeof n === "object")
      Object.values(n as object).forEach(visita);
  };
  visita(spec);
  return out;
}

const TODAS = [specMayorista, specGeneral, specInicio, REVIEW_QUERIES].flatMap(
  sqlDe,
);

/**
 * Deja sólo los predicados de fila: quita los comentarios `--` y las cláusulas
 * `FILTER (...)`, donde `abono IS NOT TRUE` es exactamente lo que debe haber.
 *
 * Sin quitar los comentarios el guardián marcaba dos consultas correctas, por
 * la prosa que explica por qué NO llevan ese filtro.
 */
function soloPredicadosDeFila(sql: string): string {
  let out = sql.replace(/--[^\n]*/g, " ");
  let previo: string;
  do {
    previo = out;
    out = out.replace(/FILTER\s*\((?:[^()]|\([^()]*\))*\)/gi, " ");
  } while (out !== previo);
  return out;
}

describe("abonos mayoristas netos, no excluidos", () => {
  it("encuentra las consultas mayoristas", () => {
    expect(TODAS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(TODAS.map((s, i) => [i, s]))(
    "consulta %i: si netea, no filtra además el abono",
    (_i, sql) => {
      const netea =
        /FILTER\s*\(\s*WHERE\s+[\w."]*"?abono"?\s+IS\s+TRUE\s*\)/i.test(sql);
      if (!netea) return;
      // Con el neteo puesto, un filtro de fila sobre abono vacía el lado
      // negativo y devuelve el bruto disfrazado de neto.
      expect(soloPredicadosDeFila(sql)).not.toMatch(
        /\b[\w."]*"?abono"?\s+IS\s+NOT\s+TRUE/i,
      );
    },
  );
});

describe("netoDeAbonos()", () => {
  it("pone COALESCE en LOS DOS lados", () => {
    const sql = netoDeAbonos('f."total"', "f");
    // Sin el COALESCE del lado del abono, un periodo sin devoluciones da
    // `algo - NULL` = NULL y la cifra desaparece en vez de quedarse igual.
    // Es el fallo que D-057 documenta para retail.
    expect(sql.match(/COALESCE\(/g)?.length).toBe(2);
    expect(sql).toMatch(
      /COALESCE\(SUM\(.*?\) FILTER \(WHERE .*?IS NOT TRUE\), 0\)/s,
    );
    expect(sql).toMatch(
      /COALESCE\(SUM\(.*?\) FILTER \(WHERE .*?IS TRUE\), 0\)/s,
    );
  });

  it("resta, no suma", () => {
    expect(netoDeAbonos('f."total"', "f")).toContain("-");
  });

  it("cualifica el abono con el alias que se le pasa", () => {
    expect(netoDeAbonos('lf."total"', "gf")).toContain('gf."abono"');
  });
});
