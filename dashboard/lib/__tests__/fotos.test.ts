/**
 * lib/fotos.ts — el único módulo que toca el filesystem de fotos (D-068).
 *
 * Todo contra un directorio sintético en tmpdir, con JPEGs generados aquí.
 * Ningún test toca la VPN ni el share.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  esCodigoValido,
  leerOriginal,
  localizarFoto,
  miniatura,
  rutaFoto,
  slotsDeFoto,
  slotsDeFotos,
} from "../fotos";

let raiz: string;
let fotosDir: string;
let cacheDir: string;
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-test-"));
  fotosDir = path.join(raiz, "espejo");
  cacheDir = path.join(raiz, "cache");
  for (const s of [1, 2, 3, 4]) fs.mkdirSync(path.join(fotosDir, String(s)), { recursive: true });
  vi.stubEnv("FOTOS_DIR", fotosDir);
  vi.stubEnv("FOTOS_CACHE_DIR", cacheDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(raiz, { recursive: true, force: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function poner(slot: number, nombre: string, contenido: Buffer = jpeg): string {
  const ruta = path.join(fotosDir, String(slot), nombre);
  fs.writeFileSync(ruta, contenido);
  return ruta;
}

describe("rutaFoto", () => {
  it("devuelve la ruta derivada del código y el slot", async () => {
    const ruta = poner(2, "144750.jpg");
    expect(await rutaFoto("144750", 2)).toBe(path.resolve(ruta));
  });

  it("null si el fichero no existe", async () => {
    expect(await rutaFoto("169", 1)).toBeNull();
  });

  it.each([
    ["con ../", "../144750"],
    ["con ../ repetido", "../../etc/passwd"],
    ["con /", "1/144750"],
    ["con \\", "..\\144750"],
    ["absoluto", "/etc/passwd"],
    ["vacío", ""],
    ["de 41 caracteres", "a".repeat(41)],
    ["solo puntos", ".."],
    ["un punto", "."],
    ["oculto", ".last-sync"],
    ["con NUL", "144750\0"],
    ["con espacio", "145815 "],
    ["con %2f sin decodificar", "..%2f144750"],
    ["con salto de línea", "144750\n"],
  ])("código %s → null", async (_nombre, codigo) => {
    poner(1, "144750.jpg");
    expect(await rutaFoto(codigo, 1)).toBeNull();
    expect(esCodigoValido(codigo)).toBe(false);
  });

  it("acepta 40 caracteres y los signos de un código real", async () => {
    const largo = "A".repeat(40);
    poner(1, `${largo}.jpg`);
    poner(1, "AB-12_3.x.jpg");
    expect(await rutaFoto(largo, 1)).not.toBeNull();
    expect(await rutaFoto("AB-12_3.x", 1)).not.toBeNull();
  });

  it.each([0, 5, -1, 1.5, NaN, 11])("slot %s → null", async (slot) => {
    poner(1, "144750.jpg");
    expect(await rutaFoto("144750", slot)).toBeNull();
  });

  it("no es un código lo que no es string", () => {
    expect(esCodigoValido(144750)).toBe(false);
    expect(esCodigoValido(null)).toBe(false);
    expect(esCodigoValido(["144750"])).toBe(false);
  });

  it("prueba .JPG y .jpeg cuando no hay .jpg", async () => {
    // Nombres distintos por extensión: en un filesystem case-insensitive
    // (APFS) `.jpg` ya encontraría el `.JPG`, y no probaría nada.
    poner(1, "200.jpeg");
    expect(await rutaFoto("200", 1)).toMatch(/200\.jpeg$/);

    poner(1, "132374.JPG");
    const ruta = await rutaFoto("132374", 1);
    expect(ruta).not.toBeNull();
    expect(ruta!.toLowerCase()).toMatch(/132374\.jpg$/);
  });

  it("un directorio con nombre de foto no es una foto", async () => {
    fs.mkdirSync(path.join(fotosDir, "1", "300.jpg"));
    expect(await rutaFoto("300", 1)).toBeNull();
  });

  it("solo atiende al nombre exacto: las variantes no cuentan", async () => {
    poner(1, "144750 (2).jpg");
    poner(2, "144750.1.jpg");
    expect(await slotsDeFoto("144750")).toEqual([]);
    // `144750.1` SÍ es un código sintácticamente válido, pero vive en su slot.
    expect(await rutaFoto("144750.1", 1)).toBeNull();
  });
});

describe("escape de directorio", () => {
  it("un fichero fuera de FOTOS_DIR es inalcanzable con un código manipulado", async () => {
    // Fichero hermano del espejo: {raiz}/secreto.jpg y {raiz}/1/secreto.jpg.
    fs.writeFileSync(path.join(raiz, "secreto.jpg"), jpeg);
    fs.mkdirSync(path.join(raiz, "1"));
    fs.writeFileSync(path.join(raiz, "1", "secreto.jpg"), jpeg);

    for (const codigo of [
      "../secreto",
      "../../secreto",
      "../../1/secreto",
      "..\\secreto",
      "%2e%2e/secreto",
      "....//secreto",
      "secreto/../../secreto",
    ]) {
      for (const slot of [1, 2, 3, 4]) {
        expect(await localizarFoto(codigo, slot), `${codigo} slot ${slot}`).toBeNull();
      }
    }
  });

  it("FOTOS_DIR con barra final o relativo no rompe el cinturón", async () => {
    poner(1, "144750.jpg");
    vi.stubEnv("FOTOS_DIR", fotosDir + path.sep);
    expect(await rutaFoto("144750", 1)).not.toBeNull();
    expect(await rutaFoto("../espejo/1/144750", 1)).toBeNull();
  });
});

describe("slotsDeFoto / slotsDeFotos", () => {
  it("devuelve los slots que existen, en orden", async () => {
    poner(1, "144750.jpg");
    poner(2, "144750.jpg");
    poner(3, "144750.jpg");
    poner(1, "132374.jpg");
    poner(4, "9.jpg");

    expect(await slotsDeFoto("144750")).toEqual([1, 2, 3]);
    expect(await slotsDeFoto("132374")).toEqual([1]);
    expect(await slotsDeFoto("9")).toEqual([4]);
    expect(await slotsDeFoto("169")).toEqual([]);
  });

  it("resuelve un lote, deduplica y da [] a los no válidos", async () => {
    poner(1, "144750.jpg");
    poner(3, "144750.jpg");
    const codigos = ["144750", "169", "144750", "../144750", ""];
    expect(await slotsDeFotos(codigos)).toEqual({
      "144750": [1, 3],
      "169": [],
      "../144750": [],
      "": [],
    });
  });

  it("aguanta un lote de 200", async () => {
    const codigos = Array.from({ length: 200 }, (_, i) => String(100000 + i));
    for (const c of codigos.slice(0, 30)) poner(1, `${c}.jpg`, Buffer.from("x"));
    const out = await slotsDeFotos(codigos);
    expect(Object.keys(out)).toHaveLength(200);
    expect(Object.values(out).filter((s) => s.length > 0)).toHaveLength(30);
  });
});

describe("sin espejo la app sigue funcionando", () => {
  it.each([
    ["no definido", undefined],
    ["vacío", ""],
    ["inexistente", "/nonexistent/fotos-que-no-existen"],
  ])("FOTOS_DIR %s → sin fotos y sin lanzar", async (_n, valor) => {
    if (valor === undefined) vi.stubEnv("FOTOS_DIR", undefined as unknown as string);
    else vi.stubEnv("FOTOS_DIR", valor);

    expect(await rutaFoto("144750", 1)).toBeNull();
    expect(await slotsDeFoto("144750")).toEqual([]);
    expect(await slotsDeFotos(["144750", "132374"])).toEqual({ "144750": [], "132374": [] });
  });

  it("FOTOS_DIR existe pero está vacío (share desmontado) → sin fotos", async () => {
    fs.rmSync(fotosDir, { recursive: true });
    fs.mkdirSync(fotosDir);
    expect(await slotsDeFoto("144750")).toEqual([]);
  });
});

describe("miniatura", () => {
  it("genera un WebP del ancho pedido y lo deja en la caché con el mtime en la clave", async () => {
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;

    const img = await miniatura(foto, "144750", 1, 256);

    expect(img.tipo).toBe("image/webp");
    const meta = await sharp(img.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(192);
    expect(fs.readdirSync(cacheDir)).toEqual([`144750-1-256-${foto.mtimeMs}.webp`]);
  });

  it("no agranda una foto más pequeña que el ancho pedido", async () => {
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    const meta = await sharp((await miniatura(foto, "144750", 1, 1024)).data).metadata();
    expect(meta.width).toBe(800);
  });

  it("la segunda vez sale de la caché, sin volver a generar", async () => {
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    await miniatura(foto, "144750", 1, 160);

    // Si saliera de sharp, este contenido plantado en la caché no volvería.
    const enCache = path.join(cacheDir, `144750-1-160-${foto.mtimeMs}.webp`);
    fs.writeFileSync(enCache, Buffer.from("de-la-cache"));

    expect((await miniatura(foto, "144750", 1, 160)).data.toString()).toBe("de-la-cache");
  });

  it("una foto sobrescrita invalida su miniatura sola", async () => {
    const ruta = poner(1, "132705.jpg");
    const vieja = (await localizarFoto("132705", 1))!;
    await miniatura(vieja, "132705", 1, 256);

    const otra = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    fs.writeFileSync(ruta, otra);
    fs.utimesSync(ruta, new Date(), new Date(vieja.mtimeMs + 60_000));
    const nueva = (await localizarFoto("132705", 1))!;

    expect(nueva.mtimeMs).not.toBe(vieja.mtimeMs);
    const meta = await sharp((await miniatura(nueva, "132705", 1, 256)).data).metadata();
    expect(meta.height).toBe(256); // la cuadrada nueva, no la 4:3 vieja
    expect(fs.readdirSync(cacheDir)).toHaveLength(2);
  });

  it("no deja temporales en la caché", async () => {
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    await Promise.all([
      miniatura(foto, "144750", 1, 256),
      miniatura(foto, "144750", 1, 256),
      miniatura(foto, "144750", 1, 512),
    ]);
    expect(fs.readdirSync(cacheDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(fs.readdirSync(cacheDir)).toHaveLength(2);
  });

  it("JPEG corrupto → sirve el original y avisa, sin lanzar ni cachear", async () => {
    const basura = Buffer.from("esto no es un jpeg");
    poner(1, "666.jpg", basura);
    const foto = (await localizarFoto("666", 1))!;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const img = await miniatura(foto, "666", 1, 256);

    expect(img.tipo).toBe("image/jpeg");
    expect(img.data.equals(basura)).toBe(true);
    expect(aviso).toHaveBeenCalled();
    expect(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []).toEqual([]);
  });

  it("con la caché no escribible sigue devolviendo la miniatura", async () => {
    // Un fichero donde debería ir el directorio: mkdir falla con ENOTDIR.
    fs.writeFileSync(cacheDir, "no soy un directorio");
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const img = await miniatura(foto, "144750", 1, 256);

    expect(img.tipo).toBe("image/webp");
    expect((await sharp(img.data).metadata()).width).toBe(256);
  });

  it("sin FOTOS_CACHE_DIR genera sin cachear", async () => {
    vi.stubEnv("FOTOS_CACHE_DIR", "");
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    expect((await miniatura(foto, "144750", 1, 256)).tipo).toBe("image/webp");
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("leerOriginal devuelve los bytes tal cual", async () => {
    poner(1, "144750.jpg");
    const foto = (await localizarFoto("144750", 1))!;
    const img = await leerOriginal(foto);
    expect(img.tipo).toBe("image/jpeg");
    expect(img.data.equals(jpeg)).toBe(true);
    expect(foto.bytes).toBe(jpeg.length);
  });
});
