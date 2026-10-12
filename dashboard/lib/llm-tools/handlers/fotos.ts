/**
 * Herramienta `fotos_de_articulo` (D-068, #986).
 *
 * Existe para que el asistente pueda distinguir «este artículo no tiene foto»
 * de «las fotos no funcionan». Sin ella el modelo no tiene forma de saberlo:
 * las fotos no están en la base de datos, son ficheros en el espejo, y el 80 %
 * del catálogo no tiene ninguna. El usuario veía respuestas sin fotos y no
 * podía saber si era falta de datos o una avería.
 */

import { resolverTokens } from "@/lib/fotos-resolver";
import type { LlmAgenticContext } from "../types";
import { toolError, toolOk, type ToolResponseBody } from "../tool-payload";

/** Tope por llamada: el modelo pregunta por unos pocos, no por el catálogo. */
const MAX_IDS = 50;

interface Args {
  identificadores?: unknown;
}

export async function handleFotosDeArticulo(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: Args;
  try {
    args = JSON.parse(rawArgs || "{}") as Args;
  } catch {
    return toolError("VALIDATION", "Argumentos no válidos: se esperaba JSON.", ctx);
  }
  const ids = args.identificadores;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    return toolError("VALIDATION", "`identificadores` debe ser una lista de textos.", ctx);
  }
  if (ids.length === 0) return toolOk({ resultados: [] });

  try {
    const resuelto = await resolverTokens(ids.slice(0, MAX_IDS));
    const resultados = ids.slice(0, MAX_IDS).map((id) => {
      const r = resuelto.get(id);
      if (!r || r.articulos.length === 0) {
        return { identificador: id, existe: false, articulos: [] };
      }
      return {
        identificador: id,
        existe: true,
        articulos: r.articulos.map((a) => ({
          codigo: a.codigo,
          referencia: a.referencia,
          color: a.color,
          fotos: a.slots.length,
        })),
      };
    });
    return toolOk({ resultados });
  } catch (err) {
    console.warn(
      "[fotos_de_articulo] no se pudo resolver:",
      err instanceof Error ? err.message : err,
    );
    return toolError("DB", "No se pudo consultar las fotos.", ctx);
  }
}
