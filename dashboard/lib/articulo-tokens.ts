/**
 * Candidatos a identificador de artículo dentro de un texto en markdown.
 *
 * En el chat no hay spec ni nombres de columna de los que fiarse: la respuesta
 * es markdown y el identificador puede ser un código, una Referencia o un
 * «modelo» (la Referencia sin los dos últimos caracteres, que es lo que el LLM
 * suele enseñar). Así que esto NO decide qué es un artículo: recoge lo que
 * tiene forma de serlo y deja que lo diga la base de datos.
 *
 * El filtro es deliberadamente tonto y barato. Exige al menos un dígito, que
 * es lo que descarta las palabras de las descripciones ("CAMISA", "PANTALÓN")
 * sin tener que enumerarlas. Lo que se cuela da un fallo inocuo: la consulta
 * no lo reconoce y la celda se queda como estaba.
 */

/** Alfanumérico de 4 a 20 con al menos un dígito. */
const TOKEN = /\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,20}\b/g;

/**
 * Tope por mensaje. Una respuesta de chat enseña decenas de artículos, no
 * cientos; más que esto es una tabla de datos que no cabe en un tooltip.
 */
export const MAX_TOKENS_POR_MENSAJE = 200;

/**
 * Las fechas se borran ANTES de tokenizar, no después: `\b` partiría
 * "2026-10-01" en "2026", y para entonces ya no se ve que era una fecha. Y un
 * año suelto no es inocuo — si existiera el artículo con código 2026 y tuviera
 * foto, pasar el ratón por encima de un año enseñaría una foto absurda.
 */
const FECHAS = [
  /\b\d{4}-\d{1,2}(-\d{1,2})?\b/g, // 2026-10-01, 2026-10
  /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, // 09/10/2026, 09/10
];

/** Ceros a secas: ni identificador ni nada. */
const RUIDO = [/^0+$/];

function esRuido(tok: string): boolean {
  return RUIDO.some((r) => r.test(tok));
}

/**
 * Tokens distintos de un texto markdown, en orden de aparición y como mucho
 * `MAX_TOKENS_POR_MENSAJE`.
 *
 * Se salta los bloques de código cercados: ahí vive el SQL de la respuesta, y
 * sus nombres de columna y literales no son artículos.
 */
/**
 * Enlaces explícitos que pone el LLM: `[texto](articulo:144750)`.
 *
 * Es el canal sin ambigüedad, y el único que permite poner la foto sobre un
 * texto que NO es un identificador — una descripción, un modelo. Se extraen
 * aparte porque el identificador puede no tener forma de token (y porque
 * entran siempre, antes que los candidatos adivinados).
 */
const ENLACE = /\]\(\s*articulo:([^)\s]{1,40})\s*\)/gi;

/** Prefijo del esquema, compartido con el renderer. */
export const ESQUEMA_ARTICULO = "articulo:";

/** El identificador de un href `articulo:X`, o null si no es de los nuestros. */
export function idDeEnlace(href: string | undefined): string | null {
  if (!href) return null;
  const limpio = href.trim();
  if (!limpio.toLowerCase().startsWith(ESQUEMA_ARTICULO)) return null;
  const id = limpio.slice(ESQUEMA_ARTICULO.length).trim();
  return id.length > 0 && id.length <= 40 ? id : null;
}

export function extraerTokens(markdown: string): string[] {
  if (!markdown) return [];
  let limpio = markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const vistos = new Set<string>();

  // Primero los enlaces explícitos: son los que el LLM afirma, y nunca se
  // quedan fuera por el tope ni por no tener forma de identificador.
  for (const m of limpio.matchAll(ENLACE)) {
    vistos.add(m[1]);
    if (vistos.size >= MAX_TOKENS_POR_MENSAJE) return [...vistos];
  }

  for (const f of FECHAS) limpio = limpio.replace(f, " ");
  for (const m of limpio.matchAll(TOKEN)) {
    const tok = m[0];
    if (esRuido(tok)) continue;
    vistos.add(tok);
    if (vistos.size >= MAX_TOKENS_POR_MENSAJE) break;
  }
  return [...vistos];
}
