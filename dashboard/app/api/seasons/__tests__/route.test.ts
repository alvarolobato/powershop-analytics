import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { parseSeason } from "@/lib/seasons";
import { GET } from "../route";

describe("parseSeason", () => {
  it("maps PV26 to Primavera-Verano with correct dates", () => {
    const s = parseSeason("PV26");
    expect(s).toEqual({
      code: "PV26",
      label: "Primavera-Verano 2026",
      from: "2026-02-01",
      to: "2026-08-31",
    });
  });

  it("maps OI25 to Otono-Invierno spanning two years", () => {
    const s = parseSeason("OI25");
    expect(s).toEqual({
      code: "OI25",
      label: "Otoño-Invierno 2025",
      from: "2025-09-01",
      to: "2026-01-31",
    });
  });

  // CONTRATO INVERTIDO A PROPÓSITO (2026-09-01).
  //
  // Estos tests exigían que un código no reconocido devolviera null, y la ruta
  // descarta los null. Eso es precisamente lo que hacía desaparecer del filtro
  // las temporadas reales: el parser sólo aceptaba PV##/OI##, un convenio que
  // los datos NO usan (son V26, I25, numéricos 74-99, M-prefijados, OUT, TE...).
  // El dueño lo vio como "faltan V25, I25, V26, I26, 92-99, A91-A99".
  //
  // Un código feo en el desplegable es cosmético; un código ausente es dato
  // inalcanzable. Ahora sólo lo vacío devuelve null.
  it("un prefijo desconocido se muestra tal cual, no se descarta", () => {
    expect(parseSeason("XX26")?.label).toBe("XX26");
  });

  it("un código sin año se muestra tal cual", () => {
    expect(parseSeason("PV")?.label).toBe("PV");
  });

  it("sigue devolviendo null para la cadena vacía", () => {
    expect(parseSeason("")).toBeNull();
  });

  it("un código con más dígitos se muestra tal cual", () => {
    expect(parseSeason("PV2026")?.label).toBe("PV2026");
  });

  it("is case-insensitive", () => {
    const s = parseSeason("pv26");
    expect(s).not.toBeNull();
    expect(s?.label).toBe("Primavera-Verano 2026");
  });
});

describe("GET /api/seasons", () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it("returns seasons array from DB rows", async () => {
    mockQuery.mockResolvedValue({
      columns: ["clave_temporada"],
      rows: [["PV26"], ["OI25"], ["PV25"]],
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.seasons).toHaveLength(3);
    expect(body.seasons[0]).toEqual({
      code: "PV26",
      label: "Primavera-Verano 2026",
      from: "2026-02-01",
      to: "2026-08-31",
    });
  });

  it("sólo descarta lo vacío: todo código real llega al filtro", async () => {
    mockQuery.mockResolvedValue({
      columns: ["clave_temporada"],
      rows: [["PV26"], ["XX99"], [""], ["BADCODE"]],
    });
    const res = await GET();
    const body = await res.json();
    // 3, no 1: sólo cae la cadena vacía.
    expect(body.seasons).toHaveLength(3);
    expect(body.seasons.map((s: { code: string }) => s.code)).toEqual([
      "PV26",
      "XX99",
      "BADCODE",
    ]);
  });

  it("returns empty seasons array on DB error", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.seasons).toEqual([]);
  });
});
