"use client";

/**
 * Qué artículos de una tabla tienen foto (D-068).
 *
 * Un widget junta los códigos y referencias que muestra y pregunta UNA vez a
 * `POST /api/articulos/fotos` (troceado en lotes de 200 si hiciera falta). La
 * caché es de módulo, compartida entre widgets: el mismo artículo en tres
 * tablas cuesta una consulta, también si las tres montan a la vez.
 *
 * Solo el 16 % de los artículos tiene foto. Lo que no la tiene no pinta
 * indicador ni dispara una sola petición de imagen.
 *
 * Las fotos son un adorno: cualquier fallo (red, espejo ausente, 500) se
 * resuelve como "sin fotos", nunca como un error en pantalla.
 */

import { useEffect, useMemo, useState } from "react";

export type Slot = 1 | 2 | 3 | 4;

export interface FotosDeRef {
  codigo: string;
  slots: Slot[];
}

export interface ArticlePhotos {
  /** Slots con foto del código. `[]` si no tiene o aún no se sabe. */
  slotsDeCodigo: (codigo: string) => Slot[];
  /** Código y slots de una Referencia, o `null` si no se conoce. */
  deRef: (ref: string) => FotosDeRef | null;
}

const TTL_MS = 10 * 60 * 1000;
/** El mismo tope que aplica el servidor (`MAX_LOTE` de `lib/fotos.ts`). */
export const MAX_LOTE = 200;
export const REINTENTO_MS = 15_000;
const SIN_SLOTS: Slot[] = [];

interface Entrada<T> {
  valor: T;
  caduca: number;
}

const cacheCodigos = new Map<string, Entrada<Slot[]>>();
const cacheRefs = new Map<string, Entrada<FotosDeRef | null>>();
/** Peticiones en vuelo por clave (`c:` código, `r:` referencia). */
const enVuelo = new Map<string, Promise<boolean>>();

function vigente<T>(cache: Map<string, Entrada<T>>, clave: string): Entrada<T> | undefined {
  const e = cache.get(clave);
  return e && e.caduca > Date.now() ? e : undefined;
}

function trocear<T>(lista: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

function esSlots(v: unknown): v is Slot[] {
  return Array.isArray(v) && v.every((s) => s === 1 || s === 2 || s === 3 || s === 4);
}

/** `true` si el servidor contestó; `false` si hubo que darlo por perdido. */
async function pedirLote(codigos: string[], refs: string[]): Promise<boolean> {
  const caduca = Date.now() + TTL_MS;
  let porCodigo: Record<string, unknown> = {};
  let porRef: Record<string, unknown> = {};
  let ok = false;
  try {
    const res = await fetch("/api/articulos/fotos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigos, refs }),
    });
    if (res.ok) {
      const body = (await res.json()) as { porCodigo?: unknown; porRef?: unknown };
      if (body.porCodigo && typeof body.porCodigo === "object") {
        porCodigo = body.porCodigo as Record<string, unknown>;
      }
      if (body.porRef && typeof body.porRef === "object") {
        porRef = body.porRef as Record<string, unknown>;
      }
      ok = true;
    }
  } catch {
    // Sin red o sin servidor: sin fotos.
  }
  // Un fallo no se cachea: el hook lo reintenta.
  if (!ok) return false;

  for (const c of codigos) {
    const slots = porCodigo[c];
    cacheCodigos.set(c, { valor: esSlots(slots) ? slots : SIN_SLOTS, caduca });
  }
  for (const r of refs) {
    const v = porRef[r] as { codigo?: unknown; slots?: unknown } | undefined;
    const valor =
      v && typeof v.codigo === "string" && esSlots(v.slots)
        ? { codigo: v.codigo, slots: v.slots }
        : null;
    cacheRefs.set(r, { valor, caduca });
    if (valor) cacheCodigos.set(valor.codigo, { valor: valor.slots, caduca });
  }
  return true;
}

/** Resuelve (contra caché, en vuelo o red) todo lo pedido. Nunca rechaza.
 *  Devuelve `false` si alguna petición falló y quedó algo sin saber. */
export async function cargarFotos(codigos: string[], refs: string[]): Promise<boolean> {
  const esperas: Promise<boolean>[] = [];
  const faltanC: string[] = [];
  const faltanR: string[] = [];

  for (const c of new Set(codigos)) {
    if (vigente(cacheCodigos, c)) continue;
    const p = enVuelo.get(`c:${c}`);
    if (p) esperas.push(p);
    else faltanC.push(c);
  }
  for (const r of new Set(refs)) {
    if (vigente(cacheRefs, r)) continue;
    const p = enVuelo.get(`r:${r}`);
    if (p) esperas.push(p);
    else faltanR.push(r);
  }

  const lotesC = trocear(faltanC, MAX_LOTE);
  const lotesR = trocear(faltanR, MAX_LOTE);
  for (let i = 0; i < Math.max(lotesC.length, lotesR.length); i++) {
    const cs = lotesC[i] ?? [];
    const rs = lotesR[i] ?? [];
    const claves = [...cs.map((c) => `c:${c}`), ...rs.map((r) => `r:${r}`)];
    const p = pedirLote(cs, rs).finally(() => {
      for (const k of claves) enVuelo.delete(k);
    });
    for (const k of claves) enVuelo.set(k, p);
    esperas.push(p);
  }

  return (await Promise.all(esperas)).every(Boolean);
}

/** Solo para tests. */
export function __resetArticlePhotosCache(): void {
  cacheCodigos.clear();
  cacheRefs.clear();
  enVuelo.clear();
}

// El lector NO aplica el TTL: lo caducado se sigue enseñando hasta que la
// revalidación lo sustituya. Si lo aplicara, a los 10 minutos un simple
// reordenado de la tabla borraría todos los indicadores sin volver a pedirlos.
// El TTL solo decide cuándo `cargarFotos` vuelve a preguntar.
const LECTOR: ArticlePhotos = {
  slotsDeCodigo: (codigo) => cacheCodigos.get(codigo)?.valor ?? SIN_SLOTS,
  deRef: (ref) => cacheRefs.get(ref)?.valor ?? null,
};

/**
 * @param codigos códigos de artículo visibles en el widget
 * @param refs    referencias visibles (para las filas sin código)
 */
export function useArticlePhotos(codigos: string[], refs: string[]): ArticlePhotos {
  // Clave estable: el widget recalcula las listas en cada render.
  const clave = useMemo(
    () => JSON.stringify([[...new Set(codigos)].sort(), [...new Set(refs)].sort()]),
    [codigos, refs],
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const [cs, rs] = JSON.parse(clave) as [string[], string[]];
    if (cs.length === 0 && rs.length === 0) return;
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let reintentado = false;
    const cargar = () =>
      void cargarFotos(cs, rs).then((ok) => {
        if (!vivo) return;
        setVersion((v) => v + 1);
        // Un 500 o un corte de red al abrir el panel: UN reintento a los 15 s.
        // Si sigue fallando, queda la revalidación periódica.
        if (!ok && !reintentado) {
          reintentado = true;
          reintento = setTimeout(cargar, REINTENTO_MS);
        }
      });
    cargar();
    // Un panel abierto todo el día se entera de las fotos nuevas (y de las
    // borradas) cuando caduca la caché, sin recargar la página.
    const revalidar = setInterval(cargar, TTL_MS + 1000);
    return () => {
      vivo = false;
      clearInterval(revalidar);
      if (reintento !== null) clearTimeout(reintento);
    };
  }, [clave]);

  // Identidad nueva en cada carga: quien memorice sobre el resultado se entera.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...LECTOR }), [version]);
}
