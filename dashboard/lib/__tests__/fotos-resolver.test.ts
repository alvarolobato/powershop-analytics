/**
 * `resolverTokens` NO filtra los artículos sin foto: la herramienta del chat
 * necesita justo eso para decir «existe, pero no tiene foto». El filtro es
 * del endpoint del navegador; si se mueve aquí, la herramienta empezaría a
 * contestar «no existe» para el 80 % del catálogo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { query, slotsDeFotos } = vi.hoisted(() => ({
  query: vi.fn(),
  slotsDeFotos: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query }));
vi.mock("@/lib/fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fotos")>()),
  slotsDeFotos,
}));

import { resolverTokens } from "@/lib/fotos-resolver";

beforeEach(() => {
  query.mockReset();
  slotsDeFotos.mockReset();
  // Un modelo con dos colores: uno con foto y otro sin ninguna.
  query.mockResolvedValue({
    rows: [
      ["I263002", "144357", "I26300201", "PARKA", "NEGRO"],
      ["I263002", "144360", "I26300202", "PARKA", "MARINO"],
    ],
  });
});

describe("resolverTokens", () => {
  it("devuelve también los artículos sin foto, con slots vacíos", async () => {
    slotsDeFotos.mockResolvedValue({ "144357": [1, 2] });

    const r = await resolverTokens(["I263002"]);

    const arts = r.get("I263002")!.articulos;
    expect(arts.map((a) => [a.codigo, a.slots])).toEqual([
      ["144357", [1, 2]],
      ["144360", []],
    ]);
  });

  it("no vuelve a mirar en disco lo que el llamador ya miró", async () => {
    slotsDeFotos.mockResolvedValue({ "144360": [] });

    const r = await resolverTokens(["I263002"], { "144357": [3] });

    expect(slotsDeFotos).toHaveBeenCalledWith(["144360"]);
    expect(r.get("I263002")!.articulos[0].slots).toEqual([3]);
  });
});
