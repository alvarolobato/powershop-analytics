import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GET } from "../route";
import { __resetFotos } from "@/lib/fotos";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(["closed", "open", "half-open"]).toContain(body.llm_circuit);
  });

  it("el cuerpo contiene literalmente lo que busca el healthcheck de Docker", async () => {
    // docker-compose: wget ... | grep -qF '"status":"ok"'
    expect(await (await GET()).text()).toContain('"status":"ok"');
  });

  it("informa de la frescura del espejo de fotos sin alterar el status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-fotos-"));
    try {
      __resetFotos();
      vi.stubEnv("FOTOS_DIR", dir);
      // Espejo configurado pero nunca sincronizado.
      let body = await (await GET()).json();
      expect(body.status).toBe("ok");
      expect(body.fotos).toEqual({ last_sync: null, horas: null, ficheros: null });

      const hace30h = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
      fs.writeFileSync(path.join(dir, ".last-sync.json"), JSON.stringify({ last_sync: hace30h, ficheros: 12666 }));
      // La lectura se cachea 60 s (la sonda llama cada 15): sin reset seguiría viendo "nunca".
      expect((await (await GET()).json()).fotos.last_sync).toBeNull();
      __resetFotos();
      body = await (await GET()).json();
      expect(body.status).toBe("ok");
      expect(body.fotos.ficheros).toBe(12666);
      expect(body.fotos.horas).toBeCloseTo(30, 0);

      fs.writeFileSync(path.join(dir, ".last-sync.json"), "{roto");
      __resetFotos();
      expect((await (await GET()).json()).fotos.last_sync).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sin espejo configurado, fotos es null", async () => {
    vi.stubEnv("FOTOS_DIR", "");
    expect((await (await GET()).json()).fotos).toBeNull();
    vi.unstubAllEnvs();
  });
});
