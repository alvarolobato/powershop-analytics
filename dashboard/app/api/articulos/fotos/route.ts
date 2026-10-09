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
import { esCodigoValido, MAX_LOTE, slotsDeFoto, slotsDeFotos, type Slot } from "@/lib/fotos";

export const dynamic = "force-dynamic";

/** Una Referencia cabe de sobra; el tope solo evita cadenas absurdas. */
const MAX_LARGO_REF = 80;

/** 200 códigos + 200 referencias caben en ~25 KB. Más que esto no es un lote. */
const MAX_CUERPO_BYTES = 64 * 1024;

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
    // Se lee como texto para poder medirlo: el endpoint va sin autenticación y
    // Content-Length puede faltar o mentir.
    const texto = await request.text();
    if (texto.length > MAX_CUERPO_BYTES) return mal("Cuerpo demasiado grande.");
    body = JSON.parse(texto);
  } catch {
    return mal("Cuerpo JSON no válido.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mal("El cuerpo debe ser un objeto.");
  }

  const { codigos: codigosRaw, refs: refsRaw } = body as Record<string, unknown>;
  const codigos = listaDeTextos(codigosRaw);
  const refs = listaDeTextos(refsRaw);
  if (codigos === null) return mal("`codigos` debe ser una lista de textos.");
  if (refs === null) return mal("`refs` debe ser una lista de textos.");
  if (codigos.length > MAX_LOTE || refs.length > MAX_LOTE) {
    return mal(`Máximo ${MAX_LOTE} códigos y ${MAX_LOTE} referencias por petición.`);
  }

  const porCodigo = await slotsDeFotos(codigos);

  // Sin prototipo: las claves son texto del usuario.
  const porRef: Record<string, { codigo: string; slots: Slot[] }> = Object.create(null);
  const refsLimpias = [...new Set(refs.filter((r) => r.length > 0 && r.length <= MAX_LARGO_REF))];
  try {
    const codigoDe = await codigosDeRefs(refsLimpias);
    await Promise.all(
      Object.entries(codigoDe).map(async ([ref, codigo]) => {
        // Un código que llega de la BD pasa por la misma validación.
        if (!esCodigoValido(codigo)) return;
        porRef[ref] = { codigo, slots: porCodigo[codigo] ?? (await slotsDeFoto(codigo)) };
      }),
    );
  } catch (err) {
    console.warn(
      "[fotos] no se pudieron resolver las referencias:",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json(
    { porCodigo, porRef },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
