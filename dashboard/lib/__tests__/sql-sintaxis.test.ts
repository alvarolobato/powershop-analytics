import { describe, it, expect } from "vitest";
import { TEMPLATES } from "../templates";
import { REVIEW_QUERIES } from "../review-queries";

/**
 * Comprobaciones de sintaxis sobre el SQL que producen las plantillas.
 *
 * No sustituyen a ejecutarlo contra una base — eso lo hace el e2e — pero
 * cubren el hueco que dejó pasar un `WHERE AND ...` a una PR: 2.576 tests en
 * verde y ninguno miraba el SQL, porque todos mockean Postgres. Lo vio
 * Copilot, no la suite.
 *
 * El fallo aparece al quitar un predicado de un `WHERE x AND y` y dejarse el
 * `AND` colgando, que es exactamente lo que pasa al reescribir filtros en
 * masa.
 */

type Consulta = { origen: string; sql: string };

function consultasDe(nombre: string, spec: unknown): Consulta[] {
  const out: Consulta[] = [];
  const visita = (n: unknown, ruta: string) => {
    if (typeof n === "string") {
      if (/\bSELECT\b/i.test(n) && /\bFROM\b/i.test(n))
        out.push({ origen: `${nombre}${ruta}`, sql: n });
      return;
    }
    if (Array.isArray(n))
      return n.forEach((x, i) => visita(x, `${ruta}[${i}]`));
    if (n && typeof n === "object")
      for (const [k, v] of Object.entries(n as Record<string, unknown>))
        visita(v, `${ruta}.${k}`);
  };
  visita(spec, "");
  return out;
}

const TODAS: Consulta[] = [
  ...TEMPLATES.flatMap((t) => consultasDe(t.slug, t.spec)),
  ...consultasDe("review-queries", REVIEW_QUERIES),
];

/** Quita comentarios `--`, donde estas palabras aparecen en prosa. */
const limpia = (sql: string) => sql.replace(/--[^\n]*/g, " ");

describe("sintaxis del SQL de las plantillas", () => {
  it("encuentra las consultas", () => {
    expect(TODAS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(TODAS.map((c) => [c.origen, c.sql]))(
    "%s: sin conectores colgando",
    (_o, sql) => {
      const s = limpia(sql);
      // WHERE / ON / HAVING seguidos directamente de AND u OR
      expect(s, "WHERE/ON/HAVING seguido de AND u OR").not.toMatch(
        /\b(WHERE|ON|HAVING)\s+(AND|OR)\b/i,
      );
      // dos conectores seguidos
      expect(s, "AND/OR duplicados").not.toMatch(/\b(AND|OR)\s+(AND|OR)\b/i);
      // AND/OR justo antes de una palabra que cierra la cláusula
      expect(s, "AND/OR antes de GROUP/ORDER/LIMIT").not.toMatch(
        /\b(AND|OR)\s+(GROUP|ORDER|LIMIT|UNION)\b/i,
      );
      // WHERE vacío al final de la consulta
      expect(s.trimEnd(), "WHERE sin predicado").not.toMatch(/\bWHERE\s*$/i);
    },
  );

  it.each(TODAS.map((c) => [c.origen, c.sql]))(
    "%s: paréntesis equilibrados",
    (_o, sql) => {
      const s = limpia(sql).replace(/'[^']*'/g, "''");
      let n = 0;
      for (const ch of s) {
        if (ch === "(") n++;
        else if (ch === ")") n--;
        expect(n, "un cierre sin apertura").toBeGreaterThanOrEqual(0);
      }
      expect(n, "paréntesis sin cerrar").toBe(0);
    },
  );
});
