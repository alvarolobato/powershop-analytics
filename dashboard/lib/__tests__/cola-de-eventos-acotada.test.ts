import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Los eventos `thinking` y `token` llevan el texto acumulado ENTERO, no el
 * incremento. Encolar uno por delta hacia una cadena de promesas que espera a
 * Postgres retiene un closure por delta, cada uno con su copia del texto:
 * memoria cuadrática en la longitud del razonamiento.
 *
 * Medido el 2026-09-01 con `modifyDashboard` sobre el panel 24: de 99 MB a
 * 3,2 GB en cuatro minutos, y el contenedor matando el proceso — el usuario
 * veía "El servidor se reinició mientras se procesaba este turno". Subir el
 * límite de 2 a 4 GB sólo retrasaba la muerte.
 */

const emitidos: Array<{ tipo: string; payload: Record<string, unknown> }> = [];

// `emitTurnEvent` es una función local del propio módulo, no importada, así que
// se intercepta lo que ELLA usa: la inserción en base de datos y la publicación
// por SSE. Mockear "@/lib/turn-events" no habría observado nada — el primer
// intento pasó sin probar nada por eso.
vi.mock("@/lib/turn-events", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    insertTurnEvent: vi.fn(
      async (_t: string, _s: number, tipo: string, payload: Record<string, unknown>) => {
        emitidos.push({ tipo, payload });
        return 1;
      },
    ),
    publish: vi.fn(),
  };
});

describe("la cola de eventos no crece con cada delta", () => {
  beforeEach(() => {
    emitidos.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("mil deltas de pensamiento NO producen mil escrituras", async () => {
    const { makeProgressHandler } = await import("@/lib/turn-background");
    let n = 0;
    const { handler, flush } = makeProgressHandler("c1", "t1", () => n++);

    for (let i = 1; i <= 1000; i++) {
      handler({ type: "model_thinking_delta", round: 1, chars: 3, totalChars: i * 3, text: "x".repeat(i * 3) });
    }
    await flush();

    const thinking = emitidos.filter((e) => e.tipo === "thinking");
    expect(thinking.length).toBeLessThan(50);
    // …pero el ÚLTIMO valor no se pierde nunca.
    expect((thinking.at(-1)!.payload as { text: string }).text).toHaveLength(3000);
  });
});
