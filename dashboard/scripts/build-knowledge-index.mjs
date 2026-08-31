#!/usr/bin/env node
/**
 * Compila un índice buscable de TODO el conocimiento operativo del repo.
 *
 * Existe porque el bundle de `knowledge.ts` sólo puede llevar lo imprescindible
 * — ya son ~18k tokens en cada llamada — mientras que el repo contiene cientos
 * de consultas SQL validadas repartidas en ficheros que el LLM nunca ha visto.
 * Ese hueco causó dos bugs reales: PR #914 inventó un join contra
 * `BarrasAsociado` con 0 % de cobertura cuando la consulta correcta llevaba
 * tiempo escrita en `report-generation.md`, y las devoluciones se ignoraron
 * durante meses.
 *
 * El bundle lleva lo que NO se puede fallar; este índice lleva la cola larga y
 * se consulta bajo demanda con la tool `search_knowledge`.
 *
 * La salida (`dashboard/lib/knowledge-index.ts`) es GENERADA: no se edita a
 * mano, y `lib/__tests__/knowledge-index-drift.test.ts` falla si el fichero
 * commiteado no coincide con lo que producen los MDs de origen.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUTPUT = join(ROOT, "dashboard/lib/knowledge-index.ts");

// Ficheros de referencia: valiosos, demasiado grandes para el prompt.
export const SOURCES = [
  "docs/sample-queries.md",
  "docs/skills/report-generation.md",
  "docs/stock-analysis.md",
  "docs/wholesale-retail-split.md",
  "docs/data-dictionary.md",
  "docs/etl-sync-strategy.md",
  "docs/architecture/overview.md",
  "docs/architecture/sales.md",
  "docs/architecture/purchasing.md",
  "docs/architecture/stock-logistics.md",
  "docs/architecture/products.md",
  "docs/architecture/customers.md",
  "docs/architecture/wholesale.md",
  "docs/architecture/stores-hr.md",
  "docs/dashboard/sql-pairs.md",
  "DECISIONS.md",
];

// Deliberadamente FUERA del indice: `4d-sql-dialect.md`, `data-access.md`,
// `schema-discovery.md` y `sql-views.md`. Documentan como consultar el ERP
// origen -- sintaxis del dialecto 4D, tablas de sistema `_USER_*`, catalogo de
// vistas. Eso es herramienta para el ETL y para quien explora el origen; el
// modelo consulta el espejo PostgreSQL y no puede ejecutar nada de eso.
// Servirselo solo le da ocasion de copiar `FROM Ventas`.

// ── Dialecto ────────────────────────────────────────────────────────────────
// Varios de los MDs de origen (`sample-queries.md`, `report-generation.md`,
// `stock-analysis.md`, `schema-discovery.md`, `sql-views.md`) contienen SQL
// contra el ERP 4D, NO contra el espejo PostgreSQL que consulta el dashboard.
// Devolver `FROM Ventas` sin avisar hace que el modelo escriba tablas que no
// existen — la misma clase de fallo (construir sobre conocimiento que parecía
// aplicable) que la herramienta existe para evitar. Se etiqueta en el índice y
// el handler lo canta en voz alta.

/** Tablas y vistas del ERP 4D: sin prefijo, CamelCase, vistas `*_SQL` / `*_BI`. */
const FOURD_TABLES = [
  "Ventas", "LineasVentas", "Articulos", "CCStock", "Exportaciones", "Clientes",
  "Traspasos", "Compras", "LineasCompras", "Facturas", "Tiendas", "BarrasAsociado",
  "Proveedores", "Familias", "Temporadas",
].join("|");
// `\b` protege el espejo: en `ps_ventas` no hay frontera de palabra antes de
// `ventas` (el `_` es carácter de palabra), así que `ps_*` nunca cuenta como 4D.
const FOURD_FROM_RE = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:${FOURD_TABLES}|\\w+_(?:SQL|BI))\\b`, "i");
/** Tablas de sistema de 4D: sólo existen en el ERP. */
const FOURD_SYSTEM_RE = /\b_USER_(?:TABLES|COLUMNS|VIEWS|INDEXES|CONSTRAINTS|INDEX_COLUMNS)\b/i;
/** El espejo: todo lo consultable desde el dashboard lleva prefijo `ps_`. */
const POSTGRES_RE = /\bps_[a-z][a-z0-9_]*\b/;
/** Una valla ```sql: si hay SQL y no hay `ps_`, la seccion es del ERP. */
// Solo la valla explicita. La alternativa `SELECT ... FROM` era perezosa e
// insensible a mayusculas, asi que enlazaba un `SELECT 1;` de un ejemplo de
// bash con un "From Python" en prosa catorce lineas mas abajo y marcaba la
// seccion como 4D.
const SQL_FENCE_RE = /```sql\b/i;

/**
 * Etiqueta el dialecto de una sección. Ante la duda gana `4d`: una consulta 4D
 * presentada como PostgreSQL rompe en producción, mientras que una PostgreSQL
 * marcada de más sólo cuesta una línea de aviso.
 */
export function detectDialect(body) {
  if (FOURD_FROM_RE.test(body) || FOURD_SYSTEM_RE.test(body)) return "4d";
  if (POSTGRES_RE.test(body)) return "postgres";
  // Regla por defecto, y la que de verdad hace el trabajo: si la seccion trae
  // SQL y NO menciona ninguna tabla del espejo, es del ERP.
  //
  // La lista blanca de arriba no basta y no puede bastar: cubria 15 tablas y
  // dejaba fuera todo el mayorista, asi que 28 secciones con `FROM GCFacturas`,
  // `FROM GCAlbaranes`, `FROM PagosVentas`... salian como "n/a" y se le
  // entregaban al modelo SIN el aviso de dialecto — justo el fallo que el
  // etiquetado existe para evitar. Cualquier tabla nueva del ERP reproducia el
  // problema.
  //
  // Invertirlo es robusto porque el espejo es lo unico con prefijo `ps_`. Una
  // seccion sin tablas (`SELECT CURRENT_DATE`) se marca 4D de mas, y eso cuesta
  // una linea de aviso; al reves rompe consultas en produccion.
  if (SQL_FENCE_RE.test(body)) return "4d";
  return "n/a";
}

/** Trocea un MD por encabezados, quedándose con las secciones que aportan algo. */
export function chunk(path, text) {
  const out = [];
  const lines = text.split("\n");
  let heading = "(inicio)";
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (!body) return;
    // Sólo indexamos secciones con SQL o con densidad de nombres de tabla:
    // el resto es prosa que no ayuda a escribir una consulta.
    const hasSql = /\bSELECT\b[\s\S]{0,600}?\bFROM\b/i.test(body) ||
      (SQL_FENCE_RE.test(body) && POSTGRES_RE.test(body));
    const tableRefs = (body.match(/\b(ps_[a-z_]+|LineasVentas|Ventas|Articulos|Exportaciones|BarrasAsociado|CCStock|Clientes|Traspasos)\b/g) || []).length;
    if (hasSql || tableRefs >= 3) {
      const clipped = body.slice(0, 4000);
      out.push({ source: path, heading, body: clipped, hasSql, dialect: detectDialect(clipped) });
    }
  };
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) { flush(); heading = line.replace(/^#+\s*/, "").trim(); buf = []; }
    else buf.push(line);
  }
  flush();
  return out;
}

/** Recorre `SOURCES` y devuelve todas las secciones indexables. */
export function buildChunks({ warn = true } = {}) {
  const chunks = [];
  for (const rel of SOURCES) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) {
      if (warn) console.warn(`[knowledge-index] falta ${rel}`);
      continue;
    }
    chunks.push(...chunk(rel, readFileSync(p, "utf8")));
  }
  return chunks;
}

/** Serializa el módulo TS. Pura: el test de drift la compara con el fichero. */
export function renderModule(chunks) {
  const withSql = chunks.filter((c) => c.hasSql).length;
  const fourD = chunks.filter((c) => c.dialect === "4d").length;
  const banner = `// GENERADO por dashboard/scripts/build-knowledge-index.mjs — NO editar a mano.
// Regenerar con \`npm run build:knowledge\` (lo ejecuta también el prebuild).
// Fuente: ${SOURCES.length} ficheros. ${chunks.length} secciones (${withSql} con SQL,
// ${fourD} en dialecto 4D del ERP origen, no ejecutables contra el espejo PostgreSQL).
// Se consulta con la tool \`search_knowledge\`; no va en el prompt del sistema.
`;
  return `${banner}
export interface KnowledgeChunk {
  source: string;
  heading: string;
  body: string;
  hasSql: boolean;
  /**
   * "4d"       — SQL contra el ERP origen (tablas sin prefijo: Ventas, CCStock).
   *              NO ejecutable contra el espejo; sirve como semantica de negocio.
   * "postgres" — SQL contra el espejo (tablas ps_*). Ejecutable tal cual.
   * "n/a"      — prosa, glosario o decisiones sin SQL de ninguno de los dos.
   */
  dialect: "4d" | "postgres" | "n/a";
}

export const KNOWLEDGE_INDEX: KnowledgeChunk[] = ${JSON.stringify(chunks, null, 2)};
`;
}

/** ¿Están todos los MDs de origen disponibles? (falso dentro del build Docker). */
export function sourcesAvailable() {
  return SOURCES.every((rel) => existsSync(join(ROOT, rel)));
}

function main() {
  const chunks = buildChunks();
  writeFileSync(OUTPUT, renderModule(chunks));
  const withSql = chunks.filter((c) => c.hasSql).length;
  const byDialect = chunks.reduce((acc, c) => ({ ...acc, [c.dialect]: (acc[c.dialect] ?? 0) + 1 }), {});
  console.log(
    `[knowledge-index] ${chunks.length} secciones de ${SOURCES.length} ficheros ` +
    `(${withSql} con SQL; dialecto: ${JSON.stringify(byDialect)})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
