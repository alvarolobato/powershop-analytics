/**
 * `search_knowledge` — búsqueda sobre el conocimiento operativo del repo.
 *
 * El prompt del sistema sólo puede llevar lo imprescindible (ya son ~18k
 * tokens). El resto — cientos de consultas SQL validadas repartidas en 19
 * ficheros — se consulta bajo demanda desde aquí.
 *
 * Esto existe por dos bugs reales causados por lo mismo: el PR #914 inventó un
 * join contra `BarrasAsociado` con 0 % de cobertura cuando la consulta correcta
 * llevaba tiempo escrita en `report-generation.md`, y las devoluciones se
 * ignoraron durante meses. En ambos casos la verdad estaba en el repo y fuera
 * del alcance del modelo.
 */

import { z } from "zod";
import { KNOWLEDGE_INDEX, type KnowledgeChunk } from "@/lib/knowledge-index";
import type { LlmAgenticContext } from "../types";
import { toolError, toolOk, type ToolResponseBody } from "../tool-payload";

/** Máximo de resultados devueltos: suficiente para elegir, sin inundar. */
export const MAX_RESULTS = 6;
/** Recorte por sección, para que 6 resultados no desborden la ventana. */
export const MAX_BODY = 1400;
/** Marca que separa fragmentos no contiguos dentro de una sección recortada. */
const ELLIPSIS = "\n[…]\n";

/**
 * Aviso obligatorio para las secciones en dialecto 4D.
 *
 * Buena parte del corpus (`sample-queries.md`, `report-generation.md`,
 * `stock-analysis.md`, `sql-views.md`, `4d-sql-dialect.md`) consulta el ERP
 * origen, cuyas tablas no llevan prefijo: `FROM Ventas`, `FROM CCStock`. El
 * dashboard consulta el espejo PostgreSQL (`ps_ventas`, `ps_lineas_ventas`).
 * Devolver ese SQL a pelo invita al modelo a copiar nombres de tabla que no
 * existen — precisamente el fallo (construir sobre conocimiento que parecía
 * aplicable) que esta herramienta existe para evitar.
 */
export const FOURD_WARNING =
  "[DIALECTO 4D — SQL contra el ERP origen. NO ejecutable contra el espejo PostgreSQL. " +
  "Las tablas del espejo llevan prefijo ps_ y nombres en snake_case. Úsalo como " +
  "referencia de semántica de negocio, NO copies los nombres de tabla.]\n";

/** Orden de preferencia ante empate: lo ejecutable antes que lo traducible. */
const DIALECT_RANK: Record<KnowledgeChunk["dialect"], number> = {
  postgres: 0,
  "n/a": 1,
  "4d": 2,
};

/**
 * Orden de resultados: puntuación descendente y, ante igualdad, el dialecto que
 * se puede ejecutar tal cual. Si el mismo conocimiento existe en las dos formas
 * (y `sample-queries.md` tiene 30 consultas traducidas justo para eso), el
 * modelo debe ver primero la que corre contra el espejo.
 */
export function byScoreThenDialect(
  a: { score: number; dialect: KnowledgeChunk["dialect"] },
  b: { score: number; dialect: KnowledgeChunk["dialect"] },
): number {
  const byScore = b.score - a.score;
  if (Math.abs(byScore) > 1e-9) return byScore;
  return DIALECT_RANK[a.dialect] - DIALECT_RANK[b.dialect];
}

const ArgsSchema = z.object({
  query: z.string(),
  only_sql: z.boolean().optional(),
});

/**
 * Palabras vacías: sólo las que además son *frecuentes* en el corpus, para que
 * no aporten ruido. El resto del filtrado lo hace el IDF, que es quien mide de
 * verdad si un término discrimina.
 */
const STOP = new Set([
  "de", "la", "el", "los", "las", "por", "para", "con", "que", "del", "una", "uno", "en", "y", "o", "a",
  "the", "of", "for", "and", "or", "to", "in", "how", "what", "cual", "como", "cuales",
]);

/** Minúsculas sin acentos: el corpus mezcla "análisis"/"analisis", "tallas"/"talla". */
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function tokenize(q: string): string[] {
  const seen = new Set<string>();
  for (const t of fold(q).split(/[^a-z0-9_]+/)) {
    if (t.length > 2 && !STOP.has(t)) seen.add(t);
  }
  return [...seen];
}

/** Ocurrencias no solapadas de `needle` en `hay`. */
function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

interface FoldedChunk {
  chunk: KnowledgeChunk;
  heading: string;
  body: string;
}

/**
 * El índice es un módulo generado y constante en tiempo de ejecución, así que
 * plegamos a minúsculas una sola vez por proceso en vez de en cada búsqueda.
 */
let foldedCache: FoldedChunk[] | null = null;
function folded(): FoldedChunk[] {
  if (!foldedCache) {
    foldedCache = KNOWLEDGE_INDEX.map((chunk) => ({
      chunk,
      heading: fold(chunk.heading),
      body: fold(chunk.body),
    }));
  }
  return foldedCache;
}

/** Frecuencia documental por término, memoizada: el corpus no cambia. */
const dfCache = new Map<string, number>();
function documentFrequency(term: string): number {
  const hit = dfCache.get(term);
  if (hit !== undefined) return hit;
  let n = 0;
  for (const f of folded()) {
    if (f.body.includes(term) || f.heading.includes(term)) n += 1;
  }
  dfCache.set(term, n);
  return n;
}

/** Sólo para tests: invalida las cachés cuando se sustituye el índice. */
export function __resetKnowledgeCaches(): void {
  foldedCache = null;
  dfCache.clear();
}

/**
 * Puntuación TF-IDF con tres sesgos deliberados.
 *
 * Dos mecanismos hacen el trabajo, y `knowledge-scoring.test.ts` los fija por
 * separado sobre un corpus controlado:
 *
 * 1. **IDF** — un término raro pesa más que uno repetido por medio corpus. Con
 *    una puntuación por frecuencia a secas, "ventas por talla" devuelve las seis
 *    secciones que más repiten "ventas" y la única que sabe de tallas
 *    (`report-generation.md`) se queda fuera: el fallo que motivó la tool.
 * 2. **Cobertura** — cubrir 2 de 2 términos multiplica por 1; cubrir 1 de 2, por
 *    0,5. Evita que una sección monotemática gane por acumulación.
 *
 * Encima de ambos: el encabezado pesa más que el cuerpo (es lo que describe la
 * sección) y tener SQL suma un poco, porque quien pregunta casi siempre quiere
 * una consulta.
 */
export function scoreChunk(f: FoldedChunk, terms: string[]): number {
  const n = folded().length;
  let score = 0;
  let matched = 0;
  for (const term of terms) {
    const inHeading = f.heading.includes(term);
    const tf = countOccurrences(f.body, term);
    if (!inHeading && tf === 0) continue;
    matched += 1;
    const idf = Math.log(1 + n / (1 + documentFrequency(term)));
    score += idf * ((inHeading ? 4 : 0) + Math.min(tf, 6) * 0.7);
  }
  if (matched === 0) return 0;
  score *= matched / terms.length;
  if (f.chunk.hasSql) score *= 1.15;
  return score;
}

/**
 * Trocea una sección en bloques: cada valla ```…``` entera por un lado, la prosa
 * entre vallas por otro. Un SELECT partido por la mitad no le sirve a nadie.
 */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  const lines = body.split("\n");
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length) blocks.push(buf.join("\n"));
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        buf.push(line);
        flush();
        inFence = false;
      } else {
        flush();
        buf.push(line);
        inFence = true;
      }
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Recorte por relevancia, no por posición.
 *
 * Cortar a pelo por `slice(0, MAX_BODY)` es lo que rompía el caso que motivó la
 * herramienta: en "Step 6: Product performance" la consulta por talla vive en el
 * carácter 1854 de 2498, o sea justo detrás del corte. Aquí se puntúan los
 * bloques, se conservan los mejores y se devuelven en su orden original, de modo
 * que el fragmento que hizo ganar a la sección siempre viaja con ella.
 */
export function excerpt(
  body: string,
  terms: string[],
  maxBody: number = MAX_BODY,
): { content: string; truncated: boolean } {
  if (body.length <= maxBody) return { content: body, truncated: false };

  const blocks = splitBlocks(body).map((text, order) => {
    const f = fold(text);
    let hits = 0;
    for (const term of terms) hits += countOccurrences(f, term);
    return { text, order, hits };
  });

  const chosen: typeof blocks = [];
  let used = 0;
  const ranked = [...blocks].sort((a, b) => b.hits - a.hits || a.order - b.order);
  for (const block of ranked) {
    const cost = block.text.length + (chosen.length ? ELLIPSIS.length : 0);
    if (used + cost > maxBody) continue;
    chosen.push(block);
    used += cost;
  }

  // Ningún bloque cabe entero (una sola valla enorme): recorte duro, pero
  // centrado en el primer término encontrado en vez de en el carácter 0.
  if (chosen.length === 0) {
    const f = fold(body);
    let at = -1;
    for (const term of terms) {
      const i = f.indexOf(term);
      if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    const from = at === -1 ? 0 : Math.max(0, at - Math.floor(maxBody / 3));
    const slice = body.slice(from, from + maxBody);
    return { content: from > 0 ? `[…]\n${slice}`.slice(0, maxBody) : slice, truncated: true };
  }

  chosen.sort((a, b) => a.order - b.order);
  const parts: string[] = [];
  let prev = -1;
  for (const block of chosen) {
    if (prev !== -1 && block.order !== prev + 1) parts.push(ELLIPSIS.trim());
    parts.push(block.text);
    prev = block.order;
  }
  return { content: parts.join("\n"), truncated: true };
}

export async function handleSearchKnowledge(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: z.infer<typeof ArgsSchema>;
  try {
    args = ArgsSchema.parse(JSON.parse(rawArgs || "{}"));
  } catch (err) {
    console.error(`[${ctx.requestId}] search_knowledge invalid args:`, err);
    return toolError(
      "INVALID_ARGS",
      "search_knowledge requires a 'query' string describing what you need (e.g. 'ventas por talla').",
      ctx,
    );
  }

  const query = args.query.trim();
  if (!query) {
    return toolError(
      "EMPTY_QUERY",
      "The 'query' parameter cannot be empty: describe what you need (e.g. 'ventas por talla').",
      ctx,
    );
  }

  const terms = tokenize(query);
  if (terms.length === 0) {
    return toolError(
      "NO_SEARCHABLE_TERMS",
      `The query ${JSON.stringify(query)} has no searchable terms (words must be longer than 2 characters).`,
      ctx,
    );
  }

  const onlySql = args.only_sql === true;
  const pool = onlySql ? folded().filter((f) => f.chunk.hasSql) : folded();

  const ranked = pool
    .map((f) => ({ f, score: scoreChunk(f, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      byScoreThenDialect(
        { score: a.score, dialect: a.f.chunk.dialect },
        { score: b.score, dialect: b.f.chunk.dialect },
      ),
    )
    .slice(0, MAX_RESULTS);

  console.info(
    `[${ctx.requestId}] search_knowledge q=${JSON.stringify(query)} only_sql=${onlySql} -> ${ranked.length}/${pool.length}`,
  );

  return toolOk({
    query,
    terms,
    searched: pool.length,
    results: ranked.map((r) => {
      const isFourD = r.f.chunk.dialect === "4d";
      // El aviso se descuenta del presupuesto, no se suma encima: así el tope
      // por sección sigue siendo MAX_BODY mire quien lo mire.
      const budget = isFourD ? MAX_BODY - FOURD_WARNING.length : MAX_BODY;
      const { content, truncated } = excerpt(r.f.chunk.body, terms, budget);
      return {
        source: r.f.chunk.source,
        heading: r.f.chunk.heading,
        has_sql: r.f.chunk.hasSql,
        dialect: r.f.chunk.dialect,
        truncated,
        content: isFourD ? FOURD_WARNING + content : content,
      };
    }),
  });
}
