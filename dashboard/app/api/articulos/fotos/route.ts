/**
 * POST /api/articulos/fotos — qué fotos existen para un lote de artículos (D-068).
 *
 * Acepta: { codigos?: string[], refs?: string[] }      máx. 200 de cada
 * Devuelve: {
 *   porCodigo: { "144750": [1, 2, 3] },                slots que existen
 *   porRef:    { "V26212484": { codigo: "144750", slots: [1, 2, 3] } }
 * }
 *
 * `codigos` son solo `stat` sobre el espejo local: no toca PostgreSQL. Los que
 * no tienen forma de código de artículo se descartan y no aparecen en la respuesta.
 * `refs` necesita una consulta para traducir Referencia → código.
 *
 * No existe `descripciones[]` y no debe existir: la descripción no identifica
 * un artículo, y adivinar por ella enseñaría la foto de otro.
 *
 * Las fotos son un adorno: si el espejo o la BD fallan, la respuesta es un 200
 * sin fotos, nunca un error que el widget tenga que pintar.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { esCodigoValido, MAX_LOTE, slotsDeFotos, type Slot } from "@/lib/fotos";

export const dynamic = "force-dynamic";

/** Una Referencia cabe de sobra; el tope solo evita cadenas absurdas. */
const MAX_LARGO_REF = 80;

/** 200 códigos + 200 referencias caben en ~25 KB. Más que esto no es un lote. */
const MAX_CUERPO_BYTES = 64 * 1024;

/**
 * Lee el cuerpo como texto, cortando en cuanto pasa del tope. `null` si se
 * pasa. No se fía de Content-Length, que puede faltar (chunked) o mentir, y no
 * carga en memoria más de lo que acepta: el endpoint va sin autenticación.
 */
async function leerCuerpo(request: NextRequest): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > MAX_CUERPO_BYTES) return null;
  if (!request.body) return "";
  const lector = request.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CUERPO_BYTES) {
      await lector.cancel().catch(() => {});
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString("utf8");
}

function mal(detalle: string): NextResponse {
  return NextResponse.json({ error: detalle, code: "VALIDATION" }, { status: 400 });
}

/** `undefined` → []. Cualquier otra cosa que no sea string[] → null. */
function listaDeTextos(valor: unknown): string[] | null {
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) return null;
  if (!valor.every((v) => typeof v === "string")) return null;
  return valor as string[];
}

/**
 * Forma de un identificador de artículo suelto, para el modo `tokens`.
 *
 * Alfanumérico, de 4 a 20, y con AL MENOS UN DÍGITO. El dígito es lo que deja
 * fuera las palabras de las descripciones ("CAMISA", "PANTALON"), que si no
 * llegarían a la consulta por centenares. No pretende acertar qué es un
 * identificador: solo evita preguntar por lo que seguro que no lo es. Quien
 * decide es la base de datos.
 */
const FORMA_TOKEN = /^(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,20}$/;

/** Variantes devueltas por un modelo. Un modelo con 40 colores no cabe en un tooltip. */
const MAX_VARIANTES = 12;

export interface ArticuloDeToken {
  codigo: string;
  referencia: string | null;
  descripcion: string | null;
  color: string | null;
  slots: Slot[];
}

/**
 * Resuelve texto suelto contra la BD: código, Referencia, o MODELO.
 *
 * El modelo es la Referencia sin los dos últimos caracteres y es lo que el
 * chat suele enseñar ("I263002" por "I26300201"). Agrupa varios artículos, uno
 * por color, así que un token puede devolver varias fotos: son hermanos de
 * verdad, no una adivinanza.
 */
async function articulosDeTokens(tokens: string[]): Promise<Map<string, ArticuloDeToken[]>> {
  const out = new Map<string, ArticuloDeToken[]>();
  if (tokens.length === 0) return out;
  const res = await query(
    `SELECT t.tok, a.codigo, a.ccrefejofacm, a.descripcion, a.color
       FROM unnest($1::text[]) AS t(tok)
       JOIN ps_articulos a
         ON a.codigo = t.tok
         OR a.ccrefejofacm = t.tok
         OR (length(a.ccrefejofacm) = length(t.tok) + 2
             AND left(a.ccrefejofacm, length(t.tok)) = t.tok)
      WHERE a.codigo IS NOT NULL AND a.codigo <> ''
      ORDER BY t.tok, (a.anulado IS TRUE), a.ccrefejofacm, a.codigo`,
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

/**
 * Referencia → código. Es prácticamente 1:1 (42.962 referencias para 42.982
 * filas); si una referencia da varios códigos gana el no anulado con
 * `fecha_modifica` más reciente.
 */
async function codigosDeRefs(refs: string[]): Promise<Record<string, string>> {
  if (refs.length === 0) return {};
  const res = await query(
    `SELECT ccrefejofacm, codigo
       FROM ps_articulos
      WHERE ccrefejofacm = ANY($1::text[])
        AND codigo IS NOT NULL AND codigo <> ''
      ORDER BY ccrefejofacm, (anulado IS TRUE), fecha_modifica DESC NULLS LAST, codigo`,
    [refs],
  );
  const out: Record<string, string> = Object.create(null);
  for (const [ref, codigo] of res.rows as [string, string][]) {
    if (!(ref in out)) out[ref] = codigo;
  }
  return out;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    const texto = await leerCuerpo(request);
    if (texto === null) return mal("Cuerpo demasiado grande.");
    body = JSON.parse(texto);
  } catch {
    return mal("Cuerpo JSON no válido.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mal("El cuerpo debe ser un objeto.");
  }

  const {
    codigos: codigosRaw,
    refs: refsRaw,
    tokens: tokensRaw,
  } = body as Record<string, unknown>;
  const codigos = listaDeTextos(codigosRaw);
  const refs = listaDeTextos(refsRaw);
  const tokens = listaDeTextos(tokensRaw);
  if (codigos === null) return mal("`codigos` debe ser una lista de textos.");
  if (refs === null) return mal("`refs` debe ser una lista de textos.");
  if (tokens === null) return mal("`tokens` debe ser una lista de textos.");
  if (codigos.length > MAX_LOTE || refs.length > MAX_LOTE || tokens.length > MAX_LOTE) {
    return mal(`Máximo ${MAX_LOTE} elementos por lista y petición.`);
  }

  const porCodigo = await slotsDeFotos(codigos);

  // Sin prototipo: las claves son texto del usuario.
  const porRef: Record<string, { codigo: string; slots: Slot[] }> = Object.create(null);
  const refsLimpias = [...new Set(refs.filter((r) => r.length > 0 && r.length <= MAX_LARGO_REF))];
  try {
    const codigoDe = await codigosDeRefs(refsLimpias);
    // Un código que llega de la BD pasa por la misma validación, y los que no
    // venían ya en `codigos` se miran en UN lote, con su tope de concurrencia.
    const pares = Object.entries(codigoDe).filter(([, codigo]) => esCodigoValido(codigo));
    const faltan = pares.map(([, codigo]) => codigo).filter((c) => !(c in porCodigo));
    const extra = faltan.length > 0 ? await slotsDeFotos(faltan) : {};
    for (const [ref, codigo] of pares) {
      porRef[ref] = { codigo, slots: porCodigo[codigo] ?? extra[codigo] ?? [] };
    }
  } catch (err) {
    console.warn(
      "[fotos] no se pudieron resolver las referencias:",
      err instanceof Error ? err.message : err,
    );
  }

  // Modo `tokens`: texto suelto del chat, donde no hay nombres de columna de
  // los que fiarse. Solo salen los que la BD reconoce Y ademas tienen foto: el
  // cliente decora exactamente lo que va a poder enseñar.
  const porToken: Record<string, ArticuloDeToken[]> = Object.create(null);
  const tokensLimpios = [...new Set(tokens.filter((t) => FORMA_TOKEN.test(t)))];
  try {
    const candidatos = await articulosDeTokens(tokensLimpios);
    const sinMirar = [
      ...new Set(
        [...candidatos.values()].flat().map((a) => a.codigo).filter((c) => !(c in porCodigo)),
      ),
    ];
    const extra = sinMirar.length > 0 ? await slotsDeFotos(sinMirar) : {};
    for (const [tok, articulos] of candidatos) {
      const conFoto = articulos
        .map((a) => ({ ...a, slots: porCodigo[a.codigo] ?? extra[a.codigo] ?? [] }))
        .filter((a) => a.slots.length > 0);
      if (conFoto.length > 0) porToken[tok] = conFoto;
    }
  } catch (err) {
    console.warn(
      "[fotos] no se pudieron resolver los tokens:",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ porCodigo, porRef, porToken });
}
