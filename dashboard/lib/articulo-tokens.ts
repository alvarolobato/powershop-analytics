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
export function extraerTokens(markdown: string): string[] {
  if (!markdown) return [];
  let limpio = markdown.replace(/```[\s\S]*?(?:```|$)/g, " ");
  for (const f of FECHAS) limpio = limpio.replace(f, " ");
  const vistos = new Set<string>();
  for (const m of limpio.matchAll(TOKEN)) {
    const tok = m[0];
    if (esRuido(tok)) continue;
    vistos.add(tok);
    if (vistos.size >= MAX_TOKENS_POR_MENSAJE) break;
  }
  return [...vistos];
}
