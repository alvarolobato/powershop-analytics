/**
 * Guardia: el conocimiento operativo tiene que ser ALCANZABLE por el LLM.
 *
 * Este es el fallo de fondo de agosto de 2026, y no fue de conocimiento sino de
 * distribución. La consulta correcta para resolver la talla de una venta
 * llevaba tiempo escrita en `docs/skills/report-generation.md`, pero ese
 * fichero no está en `docs/knowledge-sources.yml`, así que el modelo nunca la
 * vio. Un PR entero (#914) se construyó sobre una hipótesis que un `grep`
 * habría refutado, y el mismo agujero mantuvo el bug de devoluciones vivo
 * durante meses.
 *
 * Un fichero con SQL operativo tiene que llegar al modelo por una de dos vías:
 *   1. el bundle del prompt   -> listado en knowledge-sources.yml
 *   2. la tool search_knowledge -> listado en build-knowledge-index.mjs
 *
 * Si no está en ninguna, el conocimiento existe y es invisible. Esta prueba
 * falla en ese caso y obliga a decidir conscientemente: exponerlo, o marcarlo
 * como deliberadamente fuera de alcance.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const DOCS = join(ROOT, "docs");

/**
 * Ficheros con SQL que NO tienen por qué llegar al modelo, cada uno con su
 * razón. Añadir algo aquí debe ser una decisión, no un descuido — por eso el
 * motivo es obligatorio.
 */
const FUERA_DE_ALCANCE: Record<string, string> = {
  // Los cuatro de abajo son herramienta para consultar el ERP ORIGEN: sintaxis
  // del dialecto 4D, tablas de sistema `_USER_*`, catálogo de vistas. El modelo
  // consulta el espejo PostgreSQL y no puede ejecutar nada de eso; servírselo
  // sólo le da ocasión de copiar `FROM Ventas`. Son para el ETL y para quien
  // explora el origen.
  "docs/skills/4d-sql-dialect.md": "referencia del dialecto del ERP origen",
  "docs/skills/data-access.md": "cómo conectar al ERP origen (p4d, SOAP)",
  "docs/schema-discovery.md": "exploración del esquema del ERP origen",
  "docs/sql-views.md": "catálogo de vistas del ERP origen",
  "docs/deployment/production.md": "guía de instalación, no consultas de negocio",
  "docs/deployment/getting-started.md": "puesta en marcha local",
  "docs/ai-factory.md": "proceso interno de la fábrica de agentes",
  "docs/issue-format.md": "convenciones de issues",
  "docs/skills/testing-patterns.md": "patrones de test, el SQL es ilustrativo",
  "docs/skills/e2e-testing.md": "infraestructura de e2e",
  "docs/skills/systematic-debugging.md": "metodología, el SQL es ilustrativo",
  "docs/skills/release.md": "procedimiento de release",
  "docs/skills/prod-deploy.md": "procedimiento de despliegue",
  "docs/skills/cli.md": "arquitectura del CLI",
  "docs/skills/agent-efficiency.md": "meta-proceso",
  "docs/skills/skills.md": "índice de skills",
  "docs/skills/dashboard-app.md": "arquitectura de la app",
  "docs/skills/dashboard-redesign.md": "sistema de diseño",
  "docs/skills/llm-context.md": "arquitectura del módulo LLM",
};

function mdsConSql(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) {
      mdsConSql(p, acc);
      continue;
    }
    if (!nombre.endsWith(".md")) continue;
    const texto = readFileSync(p, "utf8");
    // "SQL operativo" = al menos dos consultas contra tablas reales. Una sola
    // suele ser un ejemplo de prosa; dos o más es material de consulta.
    const consultas = (texto.match(/\bSELECT\b[\s\S]{0,600}?\bFROM\b/gi) ?? []).length;
    const tablas = (
      texto.match(/\b(ps_[a-z_]+|LineasVentas|Ventas|Articulos|Exportaciones|CCStock|BarrasAsociado)\b/g) ?? []
    ).length;
    if (consultas >= 2 && tablas >= 5) acc.push(relative(ROOT, p));
  }
  return acc;
}

describe("todo el SQL operativo llega al LLM", () => {
  it("no hay ficheros con consultas fuera del alcance del modelo", () => {
    const manifiesto = readFileSync(join(DOCS, "knowledge-sources.yml"), "utf8");
    const indexScript = join(ROOT, "dashboard", "scripts", "build-knowledge-index.mjs");
    const indice = existsSync(indexScript) ? readFileSync(indexScript, "utf8") : "";

    const invisibles = mdsConSql(DOCS).filter((f) => {
      if (f in FUERA_DE_ALCANCE) return false;
      return !manifiesto.includes(f) && !indice.includes(f);
    });

    expect(
      invisibles,
      "Estos ficheros tienen SQL operativo que el LLM NUNCA verá. Añádelos a " +
        "docs/knowledge-sources.yml (bundle) o a build-knowledge-index.mjs " +
        "(tool search_knowledge), o decláralos en FUERA_DE_ALCANCE con su motivo.",
    ).toEqual([]);
  });

  it("los ficheros que motivaron el fallo siguen alcanzables", () => {
    // Regresión explícita: éstos son los que estaban invisibles en agosto.
    const manifiesto = readFileSync(join(DOCS, "knowledge-sources.yml"), "utf8");
    const indice = readFileSync(join(ROOT, "dashboard", "scripts", "build-knowledge-index.mjs"), "utf8");
    const alcanzable = (f: string) => manifiesto.includes(f) || indice.includes(f);

    expect(alcanzable("docs/skills/report-generation.md"), "el de la talla").toBe(true);
    expect(alcanzable("docs/sample-queries.md"), "el recetario de 64 consultas").toBe(true);
    expect(alcanzable("docs/data-dictionary.md"), "el glosario").toBe(true);
  });

  it("cada excepción declara por qué lo es", () => {
    for (const [fichero, motivo] of Object.entries(FUERA_DE_ALCANCE)) {
      expect(motivo.length, `${fichero} sin motivo`).toBeGreaterThan(10);
    }
  });
});
