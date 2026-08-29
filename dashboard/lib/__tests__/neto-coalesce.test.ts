/**
 * Guardián: toda resta `SUM(..) FILTER - SUM(..) FILTER` lleva COALESCE en
 * AMBOS lados.
 *
 * `SUM(x) FILTER (WHERE NOT entrada)` sobre cero filas devuelve NULL, no 0, y
 * `X - NULL` es NULL. Un periodo sin devoluciones -- lo normal en la mayoría de
 * tiendas y días -- anula la métrica entera. No da error: compila, se ejecuta y
 * devuelve blanco. Y como NULL ordena PRIMERO en `ORDER BY ... DESC`, un "top
 * tiendas" se corona con las filas vacías.
 *
 * Medido en producción sobre un solo día: 6 de 23 tiendas en NULL.
 *
 * Esta clase de fallo ya ha vuelto dos veces (una en el TypeScript, otra en las
 * MDs de conocimiento), así que se guarda en vez de confiar en la revisión.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..");

/** Ficheros donde vive SQL que el LLM copia o que la app ejecuta. */
function ficherosConSql(): string[] {
  const salida: string[] = [];
  const visitar = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".git" || e === ".next" || e === "__snapshots__") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) visitar(p);
      else if (/\.(md|ts)$/.test(e) && !/\.test\.ts$/.test(e)) salida.push(p);
    }
  };
  visitar(join(RAIZ, "docs"));
  visitar(join(RAIZ, "dashboard", "lib"));
  return salida;
}

/** Avanza hasta el índice siguiente al ')' que cierra el '(' en `i`. */
function cierraParen(s: string, i: number): number {
  let d = 0;
  for (; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return i + 1;
  }
  return -1;
}

/** Devuelve [inicio, fin) del próximo `SUM(...) FILTER (...)`, o null. */
function proximoAgregado(s: string, desde: number): [number, number] | null {
  const re = /\bSUM\s*\(/gi;
  re.lastIndex = desde;
  const m = re.exec(s);
  if (!m) return null;
  const finSum = cierraParen(s, m.index + m[0].length - 1);
  if (finSum < 0) return null;
  const filtro = /^\s*FILTER\s*\(/i.exec(s.slice(finSum));
  if (!filtro) return proximoAgregado(s, m.index + m[0].length);
  const finFiltro = cierraParen(s, finSum + filtro[0].length - 1);
  if (finFiltro < 0) return null;
  return [m.index, finFiltro];
}

function restasSinCoalesce(texto: string): string[] {
  const fallos: string[] = [];
  let i = 0;
  for (;;) {
    const a = proximoAgregado(texto, i);
    if (!a) break;
    const [ini, fin] = a;
    const guion = /^\s*-\s*/.exec(texto.slice(fin));
    if (!guion) {
      i = fin;
      continue;
    }
    const b = proximoAgregado(texto, fin + guion[0].length);
    if (!b || b[0] !== fin + guion[0].length) {
      i = fin;
      continue;
    }
    // El lado izquierdo va desnudo si justo antes no hay un COALESCE( abierto.
    const antes = texto.slice(Math.max(0, ini - 12), ini);
    if (!/COALESCE\s*\($/i.test(antes)) fallos.push(texto.slice(ini, b[1]).slice(0, 160));
    i = b[1];
  }
  return fallos;
}

describe("patrón neto de devoluciones", () => {
  it("ninguna resta SUM..FILTER queda sin COALESCE en los dos lados", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      // knowledge.ts y knowledge-index.ts son generados: su fuente son las MDs,
      // que este mismo test ya revisa. Señalarlos duplica cada fallo.
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      for (const mal of restasSinCoalesce(readFileSync(f, "utf8"))) {
        infractores.push(`${relative(RAIZ, f)}: ${mal}`);
      }
    }
    expect(
      infractores,
      `Restas sin COALESCE en ambos lados (NULL se come la métrica y ordena primero):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });

  it("detecta el patrón malo cuando se le presenta", () => {
    const malo = `SELECT SUM(v.total_si) FILTER (WHERE v.entrada) - SUM(v.total_si) FILTER (WHERE NOT v.entrada) AS neto`;
    expect(restasSinCoalesce(malo)).toHaveLength(1);
  });

  it("acepta el patrón correcto", () => {
    const bueno = `SELECT COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0) - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS neto`;
    expect(restasSinCoalesce(bueno)).toEqual([]);
  });

  it("no se queja de COUNT(*) FILTER, que devuelve 0 y no NULL", () => {
    const cuenta = `SELECT COUNT(*) FILTER (WHERE v.entrada) - COUNT(*) FILTER (WHERE NOT v.entrada) AS n`;
    expect(restasSinCoalesce(cuenta)).toEqual([]);
  });
});
