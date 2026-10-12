/**
 * Resolver texto suelto a artículos con foto (D-068, #986).
 *
 * Un identificador puede llegar de tres sitios y significar tres cosas, y las
 * tres valen porque las tres identifican lo mismo:
 *
 *   - el `codigo` de `ps_articulos` ("144750"),
 *   - la Referencia, `ccrefejofacm` ("V26212484"),
 *   - el MODELO, que es la Referencia sin los dos últimos caracteres
 *     ("I263002", "RI4969"). Un modelo agrupa un artículo por color, así que
 *     devuelve varios: son hermanos de verdad, no una adivinanza.
 *
 * Vive aquí y no en la ruta de la API porque lo usan dos consumidores: el
 * endpoint que pinta las fotos en el navegador y la herramienta con la que el
 * LLM consulta si un artículo tiene foto.
 */

import { query } from "@/lib/db";
import { esCodigoValido, slotsDeFotos, type Slot } from "@/lib/fotos";

export interface ArticuloDeToken {
  codigo: string;
  referencia: string | null;
  descripcion: string | null;
  color: string | null;
  slots: Slot[];
}

/**
 * Forma de un identificador.
 *
 * Exige al menos un DÍGITO —todo identificador de artículo lo tiene— y nada
 * más: un código puede ser tan corto como "169", así que no cabe un mínimo de
 * longitud. El dígito es lo que descarta las palabras de una descripción
 * ("CAMISA", "PANTALON"). Esto no decide qué es un artículo: solo acota la
 * entrada. Quien decide es la base de datos.
 */
export const FORMA_TOKEN = /^(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]{1,40}$/;

/** Variantes por modelo. Uno con 40 colores no cabe en un tooltip. */
export const MAX_VARIANTES = 12;

/** Tope por petición, compartido con el cliente. */
export const MAX_LOTE_TOKENS = 200;

/**
 * Artículos que casan con cada identificador, SIN mirar todavía si tienen foto.
 *
 * Tres joins de IGUALDAD unidos, no un OR con `length()`/`left()`. El OR obliga
 * al planificador a un bucle anidado: una pasada entera por `ps_articulos` por
 * CADA token. Medido con 200 tokens contra la base real: 2.886 ms. Con joins de
 * igualdad hace un hash join por rama —tres pasadas en total, da igual cuántos
 * tokens vengan— y baja a 118 ms. Importa porque el endpoint va sin autenticar.
 */
export async function articulosDeTokens(
  tokens: string[],
): Promise<Map<string, ArticuloDeToken[]>> {
  const out = new Map<string, ArticuloDeToken[]>();
  if (tokens.length === 0) return out;
  const res = await query(
    `WITH toks AS (SELECT DISTINCT tok FROM unnest($1::text[]) AS t(tok))
     SELECT tok, codigo, ccrefejofacm, descripcion, color FROM (
         SELECT t.tok, a.codigo, a.ccrefejofacm, a.descripcion, a.color, a.anulado
           FROM ps_articulos a JOIN toks t ON t.tok = a.codigo
       UNION ALL
         SELECT t.tok, a.codigo, a.ccrefejofacm, a.descripcion, a.color, a.anulado
           FROM ps_articulos a JOIN toks t ON t.tok = a.ccrefejofacm
       UNION ALL
         -- El modelo: la Referencia sin los dos últimos caracteres.
         SELECT t.tok, a.codigo, a.ccrefejofacm, a.descripcion, a.color, a.anulado
           FROM ps_articulos a
           JOIN toks t ON t.tok = left(a.ccrefejofacm, length(a.ccrefejofacm) - 2)
     ) u
      WHERE codigo IS NOT NULL AND codigo <> ''
      ORDER BY tok, (anulado IS TRUE), ccrefejofacm, codigo`,
    [tokens],
  );
  for (const fila of res.rows as [string, string, string | null, string | null, string | null][]) {
    const [tok, codigo, referencia, descripcion, color] = fila;
    if (!esCodigoValido(codigo)) continue;
    const lista = out.get(tok) ?? [];
    if (lista.length >= MAX_VARIANTES) continue;
    if (lista.some((a) => a.codigo === codigo)) continue;
    lista.push({ codigo, referencia, descripcion, color, slots: [] });
    out.set(tok, lista);
  }
  return out;
}

export interface ResolucionToken {
  /** Artículos que casan, con sus slots de foto rellenos (puede ser `[]`). */
  articulos: ArticuloDeToken[];
}

/**
 * Identificador → artículos con sus fotos.
 *
 * A diferencia del endpoint del navegador, aquí NO se filtran los que no
 * tienen foto: quien pregunta puede necesitar justamente saber que no la hay.
 * Filtrar es cosa del consumidor.
 */
export async function resolverTokens(
  tokens: string[],
  yaMirados: Record<string, Slot[]> = {},
): Promise<Map<string, ResolucionToken>> {
  const limpios = [...new Set(tokens.filter((t) => FORMA_TOKEN.test(t)))].slice(0, MAX_LOTE_TOKENS);
  const candidatos = await articulosDeTokens(limpios);
  const sinMirar = [
    ...new Set(
      [...candidatos.values()]
        .flat()
        .map((a) => a.codigo)
        .filter((c) => !(c in yaMirados)),
    ),
  ];
  const extra = sinMirar.length > 0 ? await slotsDeFotos(sinMirar) : {};
  const out = new Map<string, ResolucionToken>();
  for (const [tok, articulos] of candidatos) {
    out.set(tok, {
      articulos: articulos.map((a) => ({
        ...a,
        slots: yaMirados[a.codigo] ?? extra[a.codigo] ?? [],
      })),
    });
  }
  return out;
}
