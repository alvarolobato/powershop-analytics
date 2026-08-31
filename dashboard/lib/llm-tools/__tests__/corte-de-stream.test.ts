import { describe, expect, it } from "vitest";
import { esCorteTransitorioDeStream, conCausa } from "../runner";

/**
 * El turno 7 del 31/08 murió con `GENERATE_FAILED: terminated` tras 168 s y
 * 20 tool calls correctas: el stream se cortó en la ronda 10 y no había ningún
 * reintento a mitad de stream, así que se perdieron diez rondas ya pagadas.
 */
describe("esCorteTransitorioDeStream", () => {
  it("reconoce el 'terminated' de undici que mató al turno 7", () => {
    expect(esCorteTransitorioDeStream(new TypeError("terminated"))).toBe(true);
  });

  it("mira dentro de cause, que es donde undici pone el detalle", () => {
    const e = new TypeError("fetch failed", {
      cause: new Error("other side closed"),
    });
    expect(esCorteTransitorioDeStream(e)).toBe(true);
  });

  it("baja varios niveles de cause", () => {
    const raiz = new Error("ECONNRESET");
    const medio = new Error("socket error", { cause: raiz });
    const arriba = new TypeError("fetch failed", { cause: medio });
    expect(esCorteTransitorioDeStream(arriba)).toBe(true);
  });

  it.each([
    "socket hang up",
    "premature close",
    "EPIPE",
    "UND_ERR_SOCKET",
  ])("reconoce %s", (msg) => {
    expect(esCorteTransitorioDeStream(new Error(msg))).toBe(true);
  });

  // Lo importante del clasificador es lo que NO reintenta: un error de
  // aplicación reintentado es dinero quemado y un fallo que tarda el triple
  // en aparecer.
  it.each([
    "LLM_EMPTY: The model returned empty content.",
    "DB_ERROR: Failed to save the dashboard.",
    "400 Bad Request",
    "Daily budget exceeded",
    "TOOL_TIMEOUT",
    "Exceeded maximum tool rounds (40).",
  ])("NO reintenta un error de aplicación: %s", (msg) => {
    expect(esCorteTransitorioDeStream(new Error(msg))).toBe(false);
  });

  it("no se traga cosas que no son Error", () => {
    expect(esCorteTransitorioDeStream("terminated")).toBe(false);
    expect(esCorteTransitorioDeStream(null)).toBe(false);
    expect(esCorteTransitorioDeStream(undefined)).toBe(false);
  });
});

describe("conCausa", () => {
  it("saca a la superficie el cause que undici esconde", () => {
    const e = new TypeError("fetch failed", { cause: new Error("terminated") });
    expect(conCausa(e)).toBe("fetch failed (causa: terminated)");
  });

  it("no repite el mensaje cuando cause dice lo mismo", () => {
    const e = new Error("terminated", { cause: new Error("terminated") });
    expect(conCausa(e)).toBe("terminated");
  });

  it("aguanta un error sin cause", () => {
    expect(conCausa(new Error("pelado"))).toBe("pelado");
  });
});
