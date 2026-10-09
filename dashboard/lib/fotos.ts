/**
 * Fotos de artículo — el único módulo que toca el sistema de ficheros (D-068).
 *
 * No hay tabla de fotos: la ruta se deriva del código del artículo,
 *
 *     {FOTOS_DIR}/{slot}/{codigo}.jpg        slot 1..4 = 1ª..4ª foto
 *
 * y saber si existe es un `lstat()` sobre el espejo local. Dos reglas que no se
 * negocian:
 *
 *  - Nunca se lista un directorio. Solo acceso directo por ruta derivada.
 *  - Nada del usuario llega a una ruta sin pasar antes por `CODIGO_RE`.
 *
 * Si `FOTOS_DIR` no está definido, no existe o no contesta (el espejo solo
 * vive en producción), todo aquí responde "no hay foto" y la app sigue
 * funcionando sin ellas.
 */

import { promises as fs } from "fs";
import path from "path";

/** Slots válidos: 1..4 = 1ª..4ª foto del artículo. */
export const SLOTS = [1, 2, 3, 4] as const;
export type Slot = (typeof SLOTS)[number];

/** Anchos de miniatura admitidos. Cualquier otro se rechaza: sin esta lista
 *  cualquiera podría forzar la generación de tamaños infinitos. */
export const ANCHOS = [160, 256, 512, 1024] as const;
export type Ancho = (typeof ANCHOS)[number];

/** Máximo de códigos (o de referencias) por petición de lote. El cliente
 *  trocea con el mismo número (`lib/use-article-photos.ts`); un test los ata. */
export const MAX_LOTE = 200;

/** Códigos aceptables. Excluye `/`, `\` y todo lo que pueda escapar del
 *  directorio. */
const CODIGO_RE = /^[A-Za-z0-9._-]{1,40}$/;

/** El share mezcla mayúsculas en la extensión. En el espejo de producción
 *  (APFS, case-insensitive) la primera basta; no se da por garantizado. */
const EXTENSIONES = [".jpg", ".JPG", ".jpeg", ".JPEG"] as const;

/** Tope de un `stat`. Sobre disco local tarda microsegundos; un montaje SMB
 *  colgado (solo en dev) no falla, se queda esperando, y sin tope la petición
 *  no terminaría nunca. */
const STAT_TIMEOUT_MS = 3000;

/** Miniaturas generándose a la vez. Los endpoints van sin autenticación: sin
 *  tope, pedir muchas distintas de golpe ocuparía toda la CPU. */
const MAX_GENERANDO = 3;

/** `stat` simultáneos por lote. Sobre disco local sobra; sobre un share SMB
 *  montado en dev los metadatos no paralelizan y más hilos solo encolan. */
const CONCURRENCIA = 16;

export interface Foto {
  ruta: string;
  bytes: number;
  mtimeMs: number;
}

export interface Imagen {
  data: Buffer;
  tipo: "image/webp" | "image/jpeg";
}

export function esCodigoValido(codigo: unknown): codigo is string {
  // El punto inicial no aporta nada y descarta ".", ".." y los ocultos.
  return typeof codigo === "string" && CODIGO_RE.test(codigo) && !codigo.startsWith(".");
}

export function esSlot(slot: unknown): slot is Slot {
  return typeof slot === "number" && (SLOTS as readonly number[]).includes(slot);
}

export function esAncho(w: unknown): w is Ancho {
  return typeof w === "number" && (ANCHOS as readonly number[]).includes(w);
}

function fotosDir(): string | null {
  const dir = process.env.FOTOS_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

function cacheDir(): string | null {
  const dir = process.env.FOTOS_CACHE_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

/**
 * Deja de ESPERAR una llamada de disco pasado el tope (no la cancela: Node no
 * puede). Basta para que una petición no se quede colgada si `FOTOS_DIR` cae
 * sobre un montaje que no contesta, cosa que solo puede pasar en dev: el
 * espejo de producción es disco local.
 */
function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let terminada = false;
  const vigilada = promesa.finally(() => {
    terminada = true;
  });
  // Si llega después del tope, que su rechazo no quede sin manejar.
  vigilada.catch(() => {});
  const tope = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Si el bucle de eventos estuvo bloqueado, este timer salta antes que el
      // callback de una llamada que ya había terminado. Una vuelta más al
      // bucle y, si está resuelta, no es un timeout.
      setImmediate(() => {
        if (!terminada) reject(new Error("timeout"));
      });
    }, ms);
  });
  return Promise.race([vigilada, tope]).finally(() => clearTimeout(timer));
}

/** Solo para tests. */
export function __resetFotos(): void {
  estadoCache = null;
}

/** Localiza la foto en el espejo. `null` si el código o el slot no son
 *  válidos, o si no existe. Nunca lanza. */
export async function localizarFoto(codigo: string, slot: number): Promise<Foto | null> {
  // 1. Validación. Nada sin validar pasa de aquí.
  if (!esCodigoValido(codigo) || !esSlot(slot)) return null;
  const raiz = fotosDir();
  if (!raiz) return null;

  for (const ext of EXTENSIONES) {
    // 2. La ruta se compone solo con valores ya validados.
    const ruta = path.resolve(path.join(raiz, String(slot), codigo + ext));
    // 3. Cinturón redundante: la ruta resuelta cae dentro del espejo.
    if (!ruta.startsWith(raiz + path.sep)) return null;
    try {
      // lstat, no stat: un enlace simbólico dentro del espejo NO es una foto.
      // El cinturón de arriba es léxico y no vería adónde apunta.
      const st = await conTope(fs.lstat(ruta), STAT_TIMEOUT_MS);
      if (st.isFile()) return { ruta, bytes: st.size, mtimeMs: Math.trunc(st.mtimeMs) };
    } catch (err) {
      // ENOENT es lo normal (el 84 % de los artículos no tiene foto). Cualquier
      // otro error (share desmontado, permisos) también es "no hay foto".
      // Un timeout no: si el disco no contesta, no se insiste con las otras
      // extensiones.
      if (err instanceof Error && err.message === "timeout") return null;
    }
  }
  return null;
}

/** Ruta absoluta de la foto, o `null` si el código/slot no son válidos o no
 *  existe. Prueba `.jpg`, `.JPG`, `.jpeg` y `.JPEG`. */
export async function rutaFoto(codigo: string, slot: number): Promise<string | null> {
  return (await localizarFoto(codigo, slot))?.ruta ?? null;
}

/** Slots que existen en disco para un código. `[]` si ninguno. */
export async function slotsDeFoto(codigo: string): Promise<Slot[]> {
  if (!esCodigoValido(codigo)) return [];
  const hay = await Promise.all(SLOTS.map((s) => localizarFoto(codigo, s)));
  return SLOTS.filter((_, i) => hay[i] !== null);
}

/** Igual, para muchos códigos; lo usa el endpoint de lote. Los códigos no
 *  válidos se descartan: no se consultan ni se devuelven. */
export async function slotsDeFotos(codigos: string[]): Promise<Record<string, Slot[]>> {
  const unicos = [...new Set(codigos)].filter(esCodigoValido);
  // Sin prototipo: las claves vienen del usuario y "__proto__" o "constructor"
  // son códigos sintácticamente válidos.
  const out: Record<string, Slot[]> = Object.create(null);
  let siguiente = 0;
  async function obrero(): Promise<void> {
    while (siguiente < unicos.length) {
      const codigo = unicos[siguiente++];
      out[codigo] = await slotsDeFoto(codigo);
    }
  }
  // Cada código lanza 4 stat a la vez, así que los obreros son un cuarto.
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCIA / SLOTS.length) }, obrero));
  return out;
}

export interface EstadoEspejo {
  /** Última sincronización correcta (ISO 8601), o `null` si no hay marcador. */
  last_sync: string | null;
  /** Horas desde entonces. `null` si no hay marcador. */
  horas: number | null;
  ficheros: number | null;
}

/**
 * Frescura del espejo, leída del marcador que escribe `sync-fotos.sh` solo
 * cuando termina bien. `null` si no hay espejo configurado. Es lo único que
 * hace visible un job nocturno que lleva semanas fallando: sin esto el espejo
 * se congela y nadie lo nota. Un fichero concreto, sin listar nada.
 */
let estadoCache: { raiz: string; hasta: number; valor: EstadoEspejo } | null = null;

export async function estadoEspejo(): Promise<EstadoEspejo | null> {
  const raiz = fotosDir();
  if (!raiz) return null;
  // El healthcheck llama cada 15 s: el marcador cambia una vez al día.
  if (estadoCache && estadoCache.raiz === raiz && estadoCache.hasta > Date.now()) {
    return estadoCache.valor;
  }
  const valor = await leerEstadoEspejo(raiz);
  estadoCache = { raiz, hasta: Date.now() + 60_000, valor };
  return valor;
}

async function leerEstadoEspejo(raiz: string): Promise<EstadoEspejo> {
  const vacio: EstadoEspejo = { last_sync: null, horas: null, ficheros: null };
  try {
    const texto = await conTope(fs.readFile(path.join(raiz, ".last-sync.json"), "utf8"), STAT_TIMEOUT_MS);
    const j = JSON.parse(texto.slice(0, 1000)) as { last_sync?: unknown; ficheros?: unknown };
    const t = typeof j.last_sync === "string" ? Date.parse(j.last_sync) : NaN;
    if (!Number.isFinite(t)) return vacio;
    return {
      last_sync: new Date(t).toISOString(),
      horas: Math.max(0, Math.round((Date.now() - t) / 360_000) / 10),
      ficheros: typeof j.ficheros === "number" ? j.ficheros : null,
    };
  } catch {
    return vacio;
  }
}

/** Tope de la lectura de un original (~280 KB de media). */
const LECTURA_TIMEOUT_MS = 15_000;

export async function leerOriginal(foto: Foto): Promise<Imagen> {
  return { data: await conTope(fs.readFile(foto.ruta), LECTURA_TIMEOUT_MS), tipo: "image/jpeg" };
}

/** Miniaturas en curso: dos peticiones de la misma no la generan dos veces. */
const enCurso = new Map<string, Promise<Imagen>>();

let cacheAvisada = false;

let generando = 0;
const enEspera: (() => void)[] = [];

async function conTurno<T>(tarea: () => Promise<T>): Promise<T> {
  if (generando >= MAX_GENERANDO) {
    // Quien espera HEREDA el turno del que termina (no se decrementa y se
    // vuelve a incrementar): así nadie puede colarse entre medias.
    await new Promise<void>((r) => enEspera.push(r));
  } else {
    generando++;
  }
  try {
    return await tarea();
  } finally {
    const siguiente = enEspera.shift();
    if (siguiente) siguiente();
    else generando--;
  }
}

async function generar(foto: Foto, destino: string | null, w: Ancho): Promise<Imagen> {
  let data: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    data = await sharp(foto.ruta)
      // Aplica la orientación EXIF antes de tirar los metadatos.
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    // JPEG corrupto, o sharp sin binario para esta plataforma. Nunca un 500
    // por una miniatura: se sirve el original.
    console.warn(
      `[fotos] no se pudo generar la miniatura de ${path.basename(foto.ruta)} (w=${w}); se sirve el original:`,
      err instanceof Error ? err.message : err,
    );
    return leerOriginal(foto);
  }

  if (destino) {
    // Escritura atómica: temporal + rename. Si el proceso muere a mitad nunca
    // queda un WebP truncado que luego se sirva como válido.
    const tmp = `${destino}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, destino);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      if (!cacheAvisada) {
        cacheAvisada = true;
        console.warn(
          "[fotos] la caché de miniaturas no es escribible; se generan en cada petición:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return { data, tipo: "image/webp" };
}

/**
 * Miniatura WebP del ancho pedido, generándola y cacheándola si hace falta.
 *
 * La clave de caché lleva el mtime del original: una foto sobrescrita invalida
 * su miniatura sola, sin job de limpieza. Si no se puede generar devuelve el
 * JPEG original.
 */
export async function miniatura(
  foto: Foto,
  codigo: string,
  slot: Slot,
  w: Ancho,
): Promise<Imagen> {
  // `codigo` vuelve a validarse: acaba en un nombre de fichero.
  if (!esCodigoValido(codigo) || !esSlot(slot) || !esAncho(w)) return leerOriginal(foto);

  const dir = cacheDir();
  const destino = dir ? path.join(dir, `${codigo}-${slot}-${w}-${foto.mtimeMs}.webp`) : null;
  if (destino) {
    try {
      return { data: await fs.readFile(destino), tipo: "image/webp" };
    } catch {
      // No está en caché: se genera.
    }
  }

  const clave = destino ?? `${foto.ruta}|${w}|${foto.mtimeMs}`;
  let pendiente = enCurso.get(clave);
  if (!pendiente) {
    pendiente = conTurno(() => generar(foto, destino, w)).finally(() => enCurso.delete(clave));
    enCurso.set(clave, pendiente);
  }
  return pendiente;
}
