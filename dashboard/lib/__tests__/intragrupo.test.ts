import { describe, it, expect } from "vitest";
import { CIF_INTRAGRUPO, sinIntragrupo } from "../sql-fragments";
import { spec as specMayorista } from "../templates/mayorista";
import { spec as specGeneral } from "../templates/general";
import { spec as specInicio } from "../templates/inicio";
import { REVIEW_QUERIES } from "../review-queries";

/**
 * El tráfico intragrupo no es venta (issue #922).
 *
 * Antes de esto la regla estaba documentada y la aplicaban 2 de ~26 consultas;
 * el resto sumaba ~29.900 € de movimiento interno de 2026 como facturación.
 *
 * Este guardián es estático a propósito: mira el SQL que las plantillas
 * producen de verdad, así que una consulta nueva que olvide la exclusión lo
 * rompe sin necesidad de levantar una base. La comprobación de que además
 * DEVUELVE lo correcto vive en el e2e contra el fixture sembrado, que trae
 * clientes intragrupo y filas huérfanas justamente para poder distinguirlo.
 */

/** Tablas mayoristas cuyas filas representan movimiento con un cliente. */
const TABLAS_MAYORISTAS = /ps_gc_(facturas|albaranes|pedidos)/;

type Consulta = { origen: string; sql: string };

function consultasDe(nombre: string, spec: unknown): Consulta[] {
  const out: Consulta[] = [];
  const visita = (nodo: unknown, ruta: string) => {
    if (typeof nodo === "string") {
      if (TABLAS_MAYORISTAS.test(nodo) && /\bFROM\b/i.test(nodo)) {
        out.push({ origen: `${nombre}${ruta}`, sql: nodo });
      }
      return;
    }
    if (Array.isArray(nodo)) {
      nodo.forEach((n, i) => visita(n, `${ruta}[${i}]`));
      return;
    }
    if (nodo && typeof nodo === "object") {
      for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
        visita(v, `${ruta}.${k}`);
      }
    }
  };
  visita(spec, "");
  return out;
}

const TODAS: Consulta[] = [
  ...consultasDe("mayorista", specMayorista),
  ...consultasDe("general", specGeneral),
  ...consultasDe("inicio", specInicio),
  ...consultasDe("review-queries", REVIEW_QUERIES),
];

describe("tráfico intragrupo excluido de toda consulta mayorista", () => {
  it("encuentra las consultas mayoristas (si no, el guardián no vigila nada)", () => {
    // Sin esta comprobación, un cambio que rompiese `consultasDe` dejaría el
    // test pasando sobre una lista vacía -- verde por no mirar nada.
    expect(TODAS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(TODAS.map((c) => [c.origen, c.sql]))(
    "%s excluye el CIF intragrupo",
    (_origen, sql) => {
      expect(sql).toContain(CIF_INTRAGRUPO);
      expect(sql).toMatch(/NOT\s+EXISTS/i);
    },
  );

  it.each(TODAS.map((c) => [c.origen, c.sql]))(
    "%s no une ps_clientes con INNER JOIN",
    (_origen, sql) => {
      // Un INNER JOIN a ps_clientes descarta en silencio las filas cuyo
      // num_cliente no existe: 70 albaranes de 52.148 en producción, 3 de
      // ellos en 2026. Medido 2026-08-30.
      const inner =
        /(?<!LEFT\s)(?<!OUTER\s)\bJOIN\s+"?(?:public"?\.)?"?ps_clientes\b/i;
      expect(sql).not.toMatch(inner);
    },
  );
});

describe("sinIntragrupo()", () => {
  it("filtra por NIF y nunca por nombre", () => {
    const f = sinIntragrupo("f");
    expect(f).toContain(CIF_INTRAGRUPO);
    expect(f).toContain('ci."nif"');
    expect(f).not.toMatch(/nombre/i);
  });

  it("usa NOT EXISTS, no NOT IN (que se rompe con un NULL)", () => {
    expect(sinIntragrupo("f")).toMatch(/NOT\s+EXISTS/i);
    expect(sinIntragrupo("f")).not.toMatch(/NOT\s+IN/i);
  });

  it("correlaciona con el alias que se le pasa", () => {
    expect(sinIntragrupo("ga")).toContain('ga."num_cliente"');
    expect(sinIntragrupo("gf")).toContain('gf."num_cliente"');
  });
});
