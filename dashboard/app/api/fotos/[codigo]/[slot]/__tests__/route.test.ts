/**
 * GET /api/fotos/{codigo}/{slot} — endpoint de bytes (D-068).
 * Espejo sintético en tmpdir con JPEGs generados aquí. Ningún test toca la VPN.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { __resetFotos } from "@/lib/fotos";

let raiz: string;
let fotosDir: string;
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  __resetFotos();
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-bytes-"));
  fotosDir = path.join(raiz, "espejo");
  for (const s of [1, 2, 3, 4]) fs.mkdirSync(path.join(fotosDir, String(s)), { recursive: true });
  fs.writeFileSync(path.join(fotosDir, "1", "144750.jpg"), jpeg);
  vi.stubEnv("FOTOS_DIR", fotosDir);
  vi.stubEnv("FOTOS_CACHE_DIR", path.join(raiz, "cache"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(raiz, { recursive: true, force: true });
});

function pedir(codigo: string, slot: string, query = "", headers: Record<string, string> = {}) {
  const req = new NextRequest(
    `http://localhost/api/fotos/${encodeURIComponent(codigo)}/${slot}${query}`,
    { headers },
  );
  return GET(req, { params: { codigo, slot } });
}

describe("GET /api/fotos/[codigo]/[slot]", () => {
  it("sin w sirve el original como image/jpeg", async () => {
    const res = await pedir("144750", "1");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(jpeg)).toBe(true);
  });

  it("con w sirve una miniatura image/webp de ese ancho", async () => {
    const res = await pedir("144750", "1", "?w=256");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
  });

  it.each(["160", "256", "512", "1024"])("acepta w=%s", async (w) => {
    expect((await pedir("144750", "1", `?w=${w}`)).status).toBe(200);
  });

  it.each(["999", "0", "257", "2048", "-256", "256px", "", "1e3", "256.0", " 256"])(
    "w=%j → 400",
    async (w) => {
      const res = await pedir("144750", "1", `?w=${encodeURIComponent(w)}`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    },
  );

  it.each(["0", "5", "01", "1.0", "x", "-1", "1/..", ""])("slot %j → 400", async (slot) => {
    expect((await pedir("144750", slot)).status).toBe(400);
  });

  it.each(["../144750", "..", "1/144750", "a".repeat(41), "144750\0", ".oculto"])(
    "código %j → 400, sin tocar el disco",
    async (codigo) => {
      const res = await pedir(codigo, "1");
      expect(res.status).toBe(400);
    },
  );

  it("no sirve un fichero de fuera del espejo", async () => {
    fs.writeFileSync(path.join(raiz, "secreto.jpg"), jpeg);
    for (const codigo of ["../secreto", "../../secreto", "..%2fsecreto", "%2e%2e%2fsecreto"]) {
      const res = await pedir(codigo, "1");
      expect(res.status, codigo).toBe(400);
    }
  });

  it("inexistente → 404", async () => {
    expect((await pedir("169", "1")).status).toBe(404);
    expect((await pedir("144750", "2")).status).toBe(404);
    expect((await pedir("169", "1", "?w=256")).status).toBe(404);
  });

  it("ETag = bytes-mtime, e If-None-Match → 304 sin cuerpo", async () => {
    const st = fs.statSync(path.join(fotosDir, "1", "144750.jpg"));
    const res = await pedir("144750", "1");
    const etag = res.headers.get("etag")!;
    expect(etag).toBe(`"${st.size}-${Math.trunc(st.mtimeMs)}"`);

    const cond = await pedir("144750", "1", "", { "if-none-match": etag });
    expect(cond.status).toBe(304);
    expect(cond.headers.get("etag")).toBe(etag);
    expect((await cond.arrayBuffer()).byteLength).toBe(0);

    const otro = await pedir("144750", "1", "", { "if-none-match": '"viejo"' });
    expect(otro.status).toBe(200);
  });

  it("el ETag de la miniatura es distinto del del original y cambia con el ancho", async () => {
    const original = (await pedir("144750", "1")).headers.get("etag");
    const w256 = (await pedir("144750", "1", "?w=256")).headers.get("etag");
    const w512 = (await pedir("144750", "1", "?w=512")).headers.get("etag");
    expect(new Set([original, w256, w512]).size).toBe(3);

    const cond = await pedir("144750", "1", "?w=256", { "if-none-match": w256! });
    expect(cond.status).toBe(304);
  });

  it("el ETag cambia cuando la foto se sobrescribe", async () => {
    const antes = (await pedir("144750", "1")).headers.get("etag")!;
    const ruta = path.join(fotosDir, "1", "144750.jpg");
    fs.writeFileSync(ruta, Buffer.concat([jpeg, Buffer.from("x")]));

    const res = await pedir("144750", "1", "", { "if-none-match": antes });

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).not.toBe(antes);
  });

  it("JPEG corrupto con w → 200 con el original, nunca un 500", async () => {
    fs.writeFileSync(path.join(fotosDir, "2", "666.jpg"), "no soy un jpeg");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await pedir("666", "2", "?w=256");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("no soy un jpeg");
    // El original servido en lugar de la miniatura no se cachea como miniatura.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
  });

  it("con el espejo sin responder contesta 503 sin caché, no un 404", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(fs.promises, "lstat").mockImplementation(() => new Promise(() => {}));
      for (const esperado of [404, 503]) {
        const p = pedir("144750", "1", "?w=256");
        await vi.advanceTimersByTimeAsync(3100);
        const res = await p;
        // El primer timeout aún no corta: esa foto es un 404 puntual.
        expect(res.status).toBe(esperado);
        if (esperado === 503) expect(res.headers.get("cache-control")).toBe("no-store");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("un symlink en el espejo no se sirve", async () => {
    fs.writeFileSync(path.join(raiz, "config.yaml"), "secreto");
    fs.symlinkSync(path.join(raiz, "config.yaml"), path.join(fotosDir, "3", "169.jpg"));
    expect((await pedir("169", "3")).status).toBe(404);
  });

  it("sin espejo (FOTOS_DIR inexistente) → 404, no 500", async () => {
    vi.stubEnv("FOTOS_DIR", "/nonexistent/fotos");
    expect((await pedir("144750", "1")).status).toBe(404);
    expect((await pedir("144750", "1", "?w=256")).status).toBe(404);
  });
});
