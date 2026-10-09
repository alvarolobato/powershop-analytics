import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GET } from "../route";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(["closed", "open", "half-open"]).toContain(body.llm_circuit);
  });

  it("informa de la frescura del espejo de fotos sin alterar el status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "health-fotos-"));
    try {
      vi.stubEnv("FOTOS_DIR", dir);
      // Espejo configurado pero nunca sincronizado.
      let body = await (await GET()).json();
      expect(body.status).toBe("ok");
      expect(body.fotos).toEqual({ last_sync: null, horas: null, ficheros: null });

      const hace30h = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
      fs.writeFileSync(path.join(dir, ".last-sync.json"), JSON.stringify({ last_sync: hace30h, ficheros: 12666 }));
      body = await (await GET()).json();
      expect(body.status).toBe("ok");
      expect(body.fotos.ficheros).toBe(12666);
      expect(body.fotos.horas).toBeCloseTo(30, 0);

      fs.writeFileSync(path.join(dir, ".last-sync.json"), "{roto");
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
