"use client";

/**
 * Resuelve texto suelto del chat contra artículos con foto (D-068, #986).
 *
 * Hermano de `use-article-photos`, para el otro escenario: allí hay un widget
 * con columnas declaradas, aquí hay markdown. Se pregunta por lotes y se
 * cachea por token, así que el mismo artículo en diez mensajes cuesta una
 * consulta.
 *
 * Un token puede devolver VARIOS artículos: un «modelo» agrupa un artículo por
 * color. No es una ambigüedad que haya que resolver, es el grupo real, y el
 * lightbox los enseña seguidos.
 */

import { useEffect, useMemo, useState } from "react";
import type { Slot } from "./use-article-photos";

export interface ArticuloConFoto {
  codigo: string;
  referencia: string | null;
  descripcion: string | null;
  color: string | null;
  slots: Slot[];
}

/** Token → artículos con foto. Un token sin fotos NO aparece. */
export type FotosPorToken = Record<string, ArticuloConFoto[]>;

const TTL_MS = 10 * 60 * 1000;
const MAX_LOTE = 200;

interface Entrada {
  articulos: ArticuloConFoto[];
  caduca: number;
}

/** Caché de módulo: compartida por todos los mensajes de la conversación. */
const cache = new Map<string, Entrada>();
/** Peticiones en vuelo, para que dos mensajes con el mismo token no pregunten dos veces. */
const enVuelo = new Map<string, Promise<void>>();

export function __resetArticlePhotoTokensCache(): void {
  cache.clear();
  enVuelo.clear();
}

async function pedirLote(tokens: string[]): Promise<void> {
  const caduca = Date.now() + TTL_MS;
  try {
    const res = await fetch("/api/articulos/fotos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const datos = (await res.json()) as { porToken?: FotosPorToken };
    const porToken = datos.porToken ?? {};
    // Se cachean TODOS los pedidos, también los que no son artículos: si no,
    // cada render volvería a preguntar por las mismas palabras para nada.
    for (const tok of tokens) {
      cache.set(tok, { articulos: porToken[tok] ?? [], caduca });
    }
  } catch {
    // Las fotos son un adorno. Un fallo se cachea en corto para no machacar
    // la API en bucle, y el siguiente intento lo resuelve.
    const pronto = Date.now() + 15_000;
    for (const tok of tokens) {
      if (!cache.has(tok)) cache.set(tok, { articulos: [], caduca: pronto });
    }
  }
}

/** Pide lo que falte o esté caducado. Devuelve true si algo cambió en la caché. */
export async function cargarTokens(tokens: string[]): Promise<boolean> {
  const ahora = Date.now();
  const faltan = tokens.filter((t) => {
    const e = cache.get(t);
    return (!e || e.caduca <= ahora) && !enVuelo.has(t);
  });
  if (faltan.length === 0) return false;

  const lotes: string[][] = [];
  for (let i = 0; i < faltan.length; i += MAX_LOTE) lotes.push(faltan.slice(i, i + MAX_LOTE));

  await Promise.all(
    lotes.map((lote) => {
      const p = pedirLote(lote).finally(() => {
        for (const t of lote) enVuelo.delete(t);
      });
      for (const t of lote) enVuelo.set(t, p);
      return p;
    }),
  );
  return true;
}

function leer(tokens: string[]): FotosPorToken {
  const out: FotosPorToken = {};
  for (const t of tokens) {
    const e = cache.get(t);
    // Solo lo que tiene foto: el consumidor decora exactamente lo que puede enseñar.
    if (e && e.articulos.length > 0) out[t] = e.articulos;
  }
  return out;
}

/**
 * Mapa token → artículos con foto para los tokens dados. Vacío mientras carga,
 * así que el texto se pinta de inmediato y las fotos aparecen cuando llegan.
 */
export function useArticlePhotoTokens(tokens: string[]): FotosPorToken {
  const clave = tokens.join(" ");
  const estables = useMemo(() => (clave ? clave.split(" ") : []), [clave]);
  const [mapa, setMapa] = useState<FotosPorToken>({});

  useEffect(() => {
    if (estables.length === 0) {
      setMapa({});
      return;
    }
    let vivo = true;
    // Lo que ya este en cache se pinta sin esperar a la red: el mismo articulo
    // visto en el mensaje anterior no parpadea.
    setMapa(leer(estables));
    cargarTokens(estables).then(() => {
      if (vivo) setMapa(leer(estables));
    });
    return () => {
      vivo = false;
    };
  }, [estables]);

  return mapa;
}
