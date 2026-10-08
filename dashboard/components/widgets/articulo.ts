/**
 * ¿De qué artículo es cada fila de una tabla? (D-068)
 *
 * Las consultas que genera el LLM traen columnas arbitrarias. Para enseñar la
 * foto de un artículo hay que saber qué columna lo identifica. Tres capas:
 *
 *  1. El spec lo dice (`articulo_codigo_col` / `articulo_ref_col`).
 *  2. Heurística por nombre de columna, hermana de `detectFormat`.
 *  3. La descripción se ancla a su fila: recibe hover, pero resuelto por el
 *     código (o la referencia) de ESA fila.
 *
 * Una regla por encima de todas: **la descripción no identifica un artículo**.
 * No es única ("CAMISA FLORES C/CINTURON" son tres artículos distintos), así
 * que jamás activa nada por sí sola. Si la tabla no trae ni código ni
 * referencia no hay hover, y esa es la respuesta correcta: adivinar enseñaría
 * la foto de otro artículo.
 */

export interface ArticleColumns {
  /** Columna con `ps_articulos.codigo`. */
  codigoIdx: number | null;
  /** Columna con la Referencia (`ccrefejofacm`). */
  refIdx: number | null;
  /** Columna con la descripción. Nunca activa nada sola. */
  descIdx: number | null;
}

const SIN_COLUMNAS: ArticleColumns = { codigoIdx: null, refIdx: null, descIdx: null };

/** Nombres que dicen "código de artículo" sin ambigüedad. */
const CODIGO_EXPLICITO = new Set(["codigo_articulo", "cod_articulo", "articulo_codigo"]);
/** Nombres que podrían ser el código de cualquier cosa (tienda, cliente,
 *  familia…). Solo cuentan si la tabla trae además una Referencia, que es lo
 *  que demuestra que las filas son artículos. */
const CODIGO_AMBIGUO = new Set(["codigo", "cod"]);
const REFERENCIA = new Set(["referencia", "ref", "ccrefejofacm"]);
const DESCRIPCION = new Set(["descripcion", "descripcion_articulo"]);

/** "Cód. Artículo" → "cod_articulo". */
function normalizar(columna: string): string {
  return columna
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function primera(nombres: string[], candidatos: Set<string>): number | null {
  const idx = nombres.findIndex((n) => candidatos.has(n));
  return idx >= 0 ? idx : null;
}

/** Capa 2: heurística por nombre de columna. */
export function detectArticleColumns(columns: string[]): ArticleColumns {
  const nombres = columns.map(normalizar);
  const refIdx = primera(nombres, REFERENCIA);
  const codigoIdx =
    primera(nombres, CODIGO_EXPLICITO) ??
    (refIdx !== null ? primera(nombres, CODIGO_AMBIGUO) : null);
  if (codigoIdx === null && refIdx === null) return SIN_COLUMNAS;
  return { codigoIdx, refIdx, descIdx: primera(nombres, DESCRIPCION) };
}

function buscar(columns: string[], nombre: string | undefined): number | null {
  if (!nombre) return null;
  const exacta = columns.indexOf(nombre);
  if (exacta >= 0) return exacta;
  const n = normalizar(nombre);
  const idx = columns.findIndex((c) => normalizar(c) === n);
  return idx >= 0 ? idx : null;
}

/**
 * Capas 1 y 2 juntas: lo que diga el spec gana; lo que no diga (o nombre una
 * columna que no está en el resultado) lo completa la heurística.
 */
export function resolveArticleColumns(
  columns: string[],
  spec: { articulo_codigo_col?: string; articulo_ref_col?: string } = {},
): ArticleColumns {
  const codigoSpec = buscar(columns, spec.articulo_codigo_col);
  const refSpec = buscar(columns, spec.articulo_ref_col);
  const heur = detectArticleColumns(columns);

  const codigoIdx = codigoSpec ?? heur.codigoIdx;
  const refIdx = refSpec ?? heur.refIdx;
  if (codigoIdx === null && refIdx === null) return SIN_COLUMNAS;

  // Con el artículo ya identificado por el spec, la descripción se busca
  // aunque la heurística sola no hubiera encontrado nada.
  const descIdx = heur.descIdx ?? primera(columns.map(normalizar), DESCRIPCION);
  return { codigoIdx, refIdx, descIdx };
}

/** Los mismos códigos que acepta el servidor (`lib/fotos.ts`). Lo que no
 *  encaje ni se pregunta. */
const CODIGO_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,39}$/;

/** Valor de una celda como código de artículo, o `null` si no puede serlo. */
export function celdaACodigo(celda: unknown): string | null {
  if (typeof celda !== "string" && typeof celda !== "number") return null;
  const texto = String(celda).trim();
  return CODIGO_RE.test(texto) ? texto : null;
}

/** Valor de una celda como Referencia, o `null` si está vacía. */
export function celdaARef(celda: unknown): string | null {
  if (typeof celda !== "string" && typeof celda !== "number") return null;
  const texto = String(celda).trim();
  return texto.length > 0 && texto.length <= 80 ? texto : null;
}
