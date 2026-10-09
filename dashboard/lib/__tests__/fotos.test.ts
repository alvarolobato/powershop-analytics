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
  __resetFotos,
  espejoCortado,
  estadoEspejo,
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
  __resetFotos();
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

    poner(2, "201.JPEG");
    expect(await rutaFoto("201", 2)).toMatch(/201\.jpeg$/i);

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

describe("enlaces simbólicos", () => {
  it("un symlink dentro del espejo que apunta fuera NO es una foto", async () => {
    // El cinturón de ruta es léxico: sin lstat, esto serviría el fichero de fuera.
    const secreto = path.join(raiz, "config.yaml");
    fs.writeFileSync(secreto, "admin_api_key: secreto");
    fs.symlinkSync(secreto, path.join(fotosDir, "1", "169.jpg"));

    expect(await localizarFoto("169", 1)).toBeNull();
    expect(await slotsDeFoto("169")).toEqual([]);
  });

  it("tampoco un symlink a otra foto del propio espejo", async () => {
    poner(1, "144750.jpg");
    fs.symlinkSync(path.join(fotosDir, "1", "144750.jpg"), path.join(fotosDir, "2", "144750.jpg"));
    expect(await slotsDeFoto("144750")).toEqual([1]);
  });

  it("que FOTOS_DIR sea él mismo un symlink sí vale (un volumen externo enlazado)", async () => {
    poner(1, "144750.jpg");
    const enlace = path.join(raiz, "enlace-al-espejo");
    fs.symlinkSync(fotosDir, enlace);
    vi.stubEnv("FOTOS_DIR", enlace);
    expect(await slotsDeFoto("144750")).toEqual([1]);
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

  it("resuelve un lote, deduplica y descarta los no válidos", async () => {
    poner(1, "144750.jpg");
    poner(3, "144750.jpg");
    const codigos = ["144750", "169", "144750", "../144750", "", "x".repeat(5000)];
    expect({ ...(await slotsDeFotos(codigos)) }).toEqual({ "144750": [1, 3], "169": [] });
  });

  it("claves como __proto__ o constructor no tocan el prototipo del resultado", async () => {
    poner(1, "constructor.jpg");
    const out = await slotsDeFotos(["__proto__", "constructor", "toString"]);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.keys(out).sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(out["constructor"]).toEqual([1]);
    expect(out["__proto__"]).toEqual([]);
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

describe("espejo que no responde", () => {
  it("tras dos stat colgados deja de tocar el disco un rato, en vez de agotar el pool de hilos", async () => {
    poner(1, "144750.jpg");
    vi.useFakeTimers();
    try {
      // Un montaje colgado no falla: no contesta nunca.
      const lstat = vi.spyOn(fs.promises, "lstat").mockImplementation(() => new Promise(() => {}));

      // Un timeout: "no lo sé" para esa foto, pero todavía no corta.
      const primera = localizarFoto("144750", 1);
      await vi.advanceTimersByTimeAsync(3100);
      expect(await primera).toBeNull();
      expect(lstat).toHaveBeenCalledTimes(1); // no insiste con las otras extensiones
      expect(espejoCortado()).toBe(false);

      // El segundo seguido, sí.
      const segunda = localizarFoto("132374", 1);
      await vi.advanceTimersByTimeAsync(3100);
      expect(await segunda).toBeNull();
      expect(lstat).toHaveBeenCalledTimes(2);
      expect(espejoCortado()).toBe(true);

      // Un lote entero, y el estado del espejo: ni una llamada más a disco.
      const leer = vi.spyOn(fs.promises, "readFile");
      expect({ ...(await slotsDeFotos(["144750", "132374", "169"])) }).toEqual({
        "144750": [],
        "132374": [],
        "169": [],
      });
      expect(await estadoEspejo()).toEqual({ last_sync: null, horas: null, ficheros: null });
      expect(lstat).toHaveBeenCalledTimes(2);
      expect(leer).not.toHaveBeenCalled();

      // Pasado el corte, vuelve a mirar (y el espejo ya responde).
      lstat.mockRestore();
      leer.mockRestore();
      await vi.advanceTimersByTimeAsync(30_001);
      expect(espejoCortado()).toBe(false);
      expect(await slotsDeFoto("144750")).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un único stat lento no corta el espejo", async () => {
    poner(1, "144750.jpg");
    vi.useFakeTimers();
    try {
      const real = fs.promises.lstat;
      let llamadas = 0;
      vi.spyOn(fs.promises, "lstat").mockImplementation(((...a: Parameters<typeof real>) =>
        ++llamadas === 1 ? new Promise(() => {}) : real(...a)) as typeof real);

      const p = localizarFoto("144750", 1);
      await vi.advanceTimersByTimeAsync(3100);
      await vi.runAllTimersAsync();
      await p;

      expect(espejoCortado()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un bucle de eventos bloqueado no se confunde con un disco colgado", async () => {
    // Regresión de la revisión: tras 3 s de bloqueo (una pausa de GC, un
    // render pesado) el timer salta ANTES que el callback de un lstat que ya
    // había terminado. Sin la comprobación, eso abría el corte con el disco sano.
    poner(1, "144750.jpg");
    const p = localizarFoto("144750", 1);
    const hasta = Date.now() + 3200;
    while (Date.now() < hasta) {
      /* bloquea el hilo */
    }
    expect(await p).not.toBeNull();
    expect(espejoCortado()).toBe(false);
  });

  it("el estado del espejo no cachea un 'no lo sé'", async () => {
    fs.writeFileSync(path.join(fotosDir, ".last-sync.json"), JSON.stringify({ last_sync: "2026-10-08T01:10:00Z", ficheros: 7 }));
    vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z") });
    try {
      const leer = vi.spyOn(fs.promises, "readFile").mockImplementation((() => new Promise(() => {})) as never);
      const p = estadoEspejo();
      await vi.advanceTimersByTimeAsync(3100);
      expect((await p)!.last_sync).toBeNull();

      // En cuanto el disco contesta, se ve el dato real: no hay un minuto de "nunca sincronizado".
      leer.mockRestore();
      expect((await estadoEspejo())!.ficheros).toBe(7);
    } finally {
      vi.useRealTimers();
    }
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

  it("no genera más de 3 miniaturas a la vez", async () => {
    // Endpoint sin autenticación: pedir muchas distintas de golpe no debe
    // lanzar tantas conversiones como peticiones.
    const codigos = Array.from({ length: 12 }, (_, i) => String(300 + i));
    for (const c of codigos) poner(1, `${c}.jpg`);
    const fotos = await Promise.all(codigos.map((c) => localizarFoto(c, 1)));

    let enVuelo = 0;
    let pico = 0;
    const real = fs.promises.writeFile;
    vi.spyOn(fs.promises, "writeFile").mockImplementation(async (...args) => {
      // La escritura ocurre dentro del turno de generación.
      enVuelo++;
      pico = Math.max(pico, enVuelo);
      await new Promise((r) => setTimeout(r, 15));
      try {
        return await real(...(args as Parameters<typeof real>));
      } finally {
        enVuelo--;
      }
    });

    const out = await Promise.all(codigos.map((c, i) => miniatura(fotos[i]!, c, 1, 160)));

    expect(out.every((o) => o.tipo === "image/webp")).toBe(true);
    expect(pico).toBeGreaterThan(0);
    expect(pico).toBeLessThanOrEqual(3);
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
