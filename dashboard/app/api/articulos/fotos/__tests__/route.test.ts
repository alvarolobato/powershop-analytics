/**
 * POST /api/articulos/fotos — endpoint de lote (D-068).
 * Espejo sintético en tmpdir; PostgreSQL simulado. Ningún test toca la VPN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { POST } from "../route";

let fotosDir: string;

function poner(slot: number, codigo: string): void {
  fs.writeFileSync(path.join(fotosDir, String(slot), `${codigo}.jpg`), "jpeg");
}

function peticion(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/articulos/fotos", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fotosDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-lote-"));
  for (const s of [1, 2, 3, 4]) fs.mkdirSync(path.join(fotosDir, String(s)));
  vi.stubEnv("FOTOS_DIR", fotosDir);
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ columns: ["ccrefejofacm", "codigo"], rows: [] });
  poner(1, "144750");
  poner(2, "144750");
  poner(3, "144750");
  poner(1, "132374");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(fotosDir, { recursive: true, force: true });
});

describe("POST /api/articulos/fotos", () => {
  it("lote normal: devuelve los slots de cada código sin tocar PostgreSQL", async () => {
    const res = await POST(peticion({ codigos: ["144750", "132374", "169"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      porCodigo: { "144750": [1, 2, 3], "132374": [1], "169": [] },
      porRef: {},
    });
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("refs: traduce Referencia → código con una consulta parametrizada", async () => {
    mockQuery.mockResolvedValue({
      columns: ["ccrefejofacm", "codigo"],
      rows: [
        ["V26212484", "144750"],
        ["V26000001", "169"],
      ],
    });

    const res = await POST(peticion({ refs: ["V26212484", "V26000001", "NOEXISTE"] }));

    expect(await res.json()).toEqual({
      porCodigo: {},
      porRef: {
        V26212484: { codigo: "144750", slots: [1, 2, 3] },
        V26000001: { codigo: "169", slots: [] },
      },
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ccrefejofacm = ANY($1::text[])");
    expect(params).toEqual([["V26212484", "V26000001", "NOEXISTE"]]);
    // La referencia viaja como parámetro, nunca interpolada.
    expect(sql).not.toContain("V26212484");
  });

  it("refs ambiguas: gana la primera fila, que la consulta ordena por no anulado y fecha", async () => {
    mockQuery.mockResolvedValue({
      columns: ["ccrefejofacm", "codigo"],
      rows: [
        ["V26212484", "144750"], // vigente, más reciente
        ["V26212484", "132374"], // anulado o más antiguo
      ],
    });

    const res = await POST(peticion({ refs: ["V26212484"] }));

    expect((await res.json()).porRef).toEqual({
      V26212484: { codigo: "144750", slots: [1, 2, 3] },
    });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY ccrefejofacm, \(anulado IS TRUE\), fecha_modifica DESC NULLS LAST/);
  });

  it("codigos y refs a la vez", async () => {
    mockQuery.mockResolvedValue({ columns: [], rows: [["V26212484", "144750"]] });
    const res = await POST(peticion({ codigos: ["132374"], refs: ["V26212484"] }));
    expect(await res.json()).toEqual({
      porCodigo: { "132374": [1] },
      porRef: { V26212484: { codigo: "144750", slots: [1, 2, 3] } },
    });
  });

  it("un código manipulado no es un error: simplemente no tiene foto", async () => {
    const res = await POST(peticion({ codigos: ["../1/144750", "144750"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).porCodigo).toEqual({ "../1/144750": [], "144750": [1, 2, 3] });
  });

  it("un código que llega de la BD también pasa por la validación", async () => {
    mockQuery.mockResolvedValue({ columns: [], rows: [["REFMALA", "../1/144750"]] });
    const res = await POST(peticion({ refs: ["REFMALA"] }));
    expect((await res.json()).porRef).toEqual({ REFMALA: { codigo: "../1/144750", slots: [] } });
  });

  it("cuerpo vacío → 200 sin nada", async () => {
    const res = await POST(peticion({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ porCodigo: {}, porRef: {} });
  });

  it.each([
    ["más de 200 códigos", { codigos: Array.from({ length: 201 }, (_, i) => String(i)) }],
    ["más de 200 refs", { refs: Array.from({ length: 201 }, (_, i) => `R${i}`) }],
    ["codigos no-string", { codigos: [144750] }],
    ["codigos con null", { codigos: ["144750", null] }],
    ["codigos que no es lista", { codigos: "144750" }],
    ["refs no-string", { refs: [{ ref: "V26212484" }] }],
    ["cuerpo que es una lista", ["144750"]],
    ["JSON roto", "{codigos:"],
  ])("%s → 400", async (_nombre, body) => {
    const res = await POST(peticion(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("200 exactos se aceptan", async () => {
    const res = await POST(peticion({ codigos: Array.from({ length: 200 }, (_, i) => String(i)) }));
    expect(res.status).toBe(200);
  });

  it("no acepta descripciones: la descripción no identifica un artículo", async () => {
    const res = await POST(peticion({ descripciones: ["CAMISA FLORES C/CINTURON"] }));
    expect(await res.json()).toEqual({ porCodigo: {}, porRef: {} });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("si PostgreSQL falla, los códigos se resuelven igual y las refs salen vacías", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(peticion({ codigos: ["144750"], refs: ["V26212484"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ porCodigo: { "144750": [1, 2, 3] }, porRef: {} });
  });

  it("sin espejo (FOTOS_DIR inexistente) responde 200 sin fotos", async () => {
    vi.stubEnv("FOTOS_DIR", "/nonexistent/fotos");
    const res = await POST(peticion({ codigos: ["144750", "132374"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).porCodigo).toEqual({ "144750": [], "132374": [] });
  });
});
