/**
 * `fotos_de_articulo`: la herramienta que deja al asistente distinguir
 * «este artículo no tiene foto» de «las fotos no funcionan».
 *
 * Sin ella el modelo no puede saberlo: las fotos no están en la base de datos,
 * son ficheros en el espejo, y el 80 % del catálogo no tiene ninguna.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolverTokens = vi.fn();
vi.mock("@/lib/fotos-resolver", () => ({ resolverTokens: (...a: unknown[]) => resolverTokens(...a) }));

import { handleFotosDeArticulo } from "../handlers/fotos";
import { FREE_CHAT_TOOLS } from "../catalog";
import type { LlmAgenticContext } from "../types";

const ctx = { requestId: "req_test" } as LlmAgenticContext;
const art = (codigo: string, color: string, fotos: number) => ({
  codigo, referencia: "R" + codigo, descripcion: "D", color, slots: Array(fotos).fill(1),
});

// mockClear y no mockReset: mockReset deja el mock SIN implementacion, y un
// vi.fn() sin implementacion devuelve undefined — al await-earlo dentro del
// handler el fallo aparece donde no toca. Cada test fija la suya.
beforeEach(() => {
  resolverTokens.mockClear();
  resolverTokens.mockResolvedValue(new Map());
});

describe("fotos_de_articulo", () => {
  it("el chat la tiene disponible", () => {
    const nombres = FREE_CHAT_TOOLS.map((t) => t.function.name);
    expect(nombres).toContain("fotos_de_articulo");
  });

  it("dice cuántas fotos tiene cada color de un modelo", async () => {
    resolverTokens.mockResolvedValue(
      new Map([["I263002", { articulos: [art("144360", "MARINO", 1), art("144357", "NEGRO", 3)] }]]),
    );
    const r = await handleFotosDeArticulo(JSON.stringify({ identificadores: ["I263002"] }), ctx);

    expect(r.ok).toBe(true);
    const [res] = (r as { data: { resultados: unknown[] } }).data.resultados as Array<{
      identificador: string; existe: boolean; articulos: Array<{ color: string; fotos: number }>;
    }>;
    expect(res.identificador).toBe("I263002");
    expect(res.existe).toBe(true);
    expect(res.articulos).toEqual([
      { codigo: "144360", referencia: "R144360", color: "MARINO", fotos: 1 },
      { codigo: "144357", referencia: "R144357", color: "NEGRO", fotos: 3 },
    ]);
  });

  it("un artículo que existe pero no tiene foto se distingue de uno que no existe", async () => {
    // Es el caso que motiva la herramienta: sin esta diferencia el asistente
    // no puede contestar «no hay foto» con seguridad.
    resolverTokens.mockResolvedValue(
      new Map([["142419", { articulos: [art("142419", "VARIAS", 0)] }]]),
    );
    const r = await handleFotosDeArticulo(
      JSON.stringify({ identificadores: ["142419", "NOEXISTE1"] }), ctx,
    );
    const res = (r as { data: { resultados: Array<{ identificador: string; existe: boolean; articulos: Array<{ fotos: number }> }> } }).data.resultados;

    expect(res[0]).toEqual({
      identificador: "142419", existe: true,
      articulos: [{ codigo: "142419", referencia: "R142419", color: "VARIAS", fotos: 0 }],
    });
    expect(res[1]).toEqual({ identificador: "NOEXISTE1", existe: false, articulos: [] });
  });

  it("rechaza argumentos que no son una lista de textos", async () => {
    for (const malos of ['{"identificadores": 5}', '{"identificadores": [1,2]}', "no-json"]) {
      const r = await handleFotosDeArticulo(malos, ctx);
      expect(r.ok).toBe(false);
    }
    expect(resolverTokens).not.toHaveBeenCalled();
  });

  it("un fallo de base de datos no tumba el turno", async () => {
    // Se lanza DENTRO de una async, no con mockRejectedValue ni devolviendo
    // un Promise.reject ya construido: esos crean el rechazo al configurar el
    // mock, antes de que el handler lo espere, y vitest lo cuenta como
    // rechazo no gestionado aunque el handler lo capture.
    resolverTokens.mockImplementation(async () => {
      throw new Error("se cayó postgres");
    });
    const r = await handleFotosDeArticulo(JSON.stringify({ identificadores: ["169"] }), ctx);
    expect(r.ok).toBe(false);
  });

  it("acota el lote a 50", async () => {
    resolverTokens.mockResolvedValue(new Map());
    const muchos = Array.from({ length: 80 }, (_, i) => `A${i}`);
    const r = await handleFotosDeArticulo(JSON.stringify({ identificadores: muchos }), ctx);
    expect((r as { data: { resultados: unknown[] } }).data.resultados).toHaveLength(50);
    expect((resolverTokens.mock.calls[0][0] as string[]).length).toBe(50);
  });
});
