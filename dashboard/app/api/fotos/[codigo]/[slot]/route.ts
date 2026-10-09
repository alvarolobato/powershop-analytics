/**
 * GET /api/fotos/{codigo}/{slot} — bytes de una foto de artículo (D-068).
 *
 *   /api/fotos/144750/1          → original (image/jpeg)
 *   /api/fotos/144750/1?w=256    → miniatura WebP
 *
 * El código viene del usuario: se valida antes de construir ninguna ruta, y
 * `w` solo admite la lista de anchos. Todo el acceso a disco está en
 * `lib/fotos.ts`.
 *
 *   400 — código, slot o ancho no válidos
 *   404 — el artículo no tiene esa foto
 *   304 — If-None-Match coincide
 *   503 — el espejo no responde (no se sabe si la foto existe)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ANCHOS,
  esAncho,
  esCodigoValido,
  espejoCortado,
  esSlot,
  leerOriginal,
  localizarFoto,
  miniatura,
  type Ancho,
} from "@/lib/fotos";

export const dynamic = "force-dynamic";

function mal(detalle: string): NextResponse {
  return NextResponse.json({ error: detalle, code: "VALIDATION" }, { status: 400 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { codigo: string; slot: string } },
): Promise<NextResponse> {
  const { codigo } = params;
  if (!esCodigoValido(codigo)) return mal("Código de artículo no válido.");

  const slot = /^[1-4]$/.test(params.slot) ? Number(params.slot) : NaN;
  if (!esSlot(slot)) return mal("El slot debe ser 1, 2, 3 o 4.");

  let w: Ancho | null = null;
  const wRaw = request.nextUrl.searchParams.get("w");
  if (wRaw !== null) {
    const n = /^\d{1,5}$/.test(wRaw) ? Number(wRaw) : NaN;
    if (!esAncho(n)) return mal(`\`w\` debe ser uno de: ${ANCHOS.join(", ")}.`);
    w = n;
  }

  const foto = await localizarFoto(codigo, slot);
  if (!foto) {
    // Con el espejo sin responder no se sabe si la foto existe: 503, no 404.
    if (espejoCortado()) {
      return NextResponse.json(
        { error: "El espejo de fotos no responde.", code: "UNAVAILABLE" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
      );
    }
    return NextResponse.json({ error: "Sin foto.", code: "NOT_FOUND" }, { status: 404 });
  }

  const etag = `"${foto.bytes}-${foto.mtimeMs}${w ? `-w${w}` : ""}"`;
  const comunes = {
    ETag: etag,
    "Cache-Control": "public, max-age=86400",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: comunes });
  }

  let imagen;
  try {
    imagen = w ? await miniatura(foto, codigo, slot, w) : await leerOriginal(foto);
  } catch {
    // El fichero desapareció entre el stat y la lectura (rsync --delete, o el
    // share de dev desmontado).
    return NextResponse.json({ error: "Sin foto.", code: "NOT_FOUND" }, { status: 404 });
  }

  // Se pidió miniatura y salió el original (sharp falló): que nadie guarde 24 h
  // un JPEG de 500 KB como si fuera la miniatura. Sin ETag, sin caché.
  const degradada = w !== null && imagen.tipo !== "image/webp";

  return new NextResponse(new Uint8Array(imagen.data), {
    status: 200,
    headers: {
      ...(degradada ? { "Cache-Control": "no-store" } : comunes),
      "Content-Type": imagen.tipo,
      "Content-Length": String(imagen.data.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
