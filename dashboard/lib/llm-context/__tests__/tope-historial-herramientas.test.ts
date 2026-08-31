import { describe, expect, it } from "vitest";
import { formatToolCallsForHistory } from "../history";

/**
 * El bloque de herramientas ya ejecutadas viaja en CADA llamada de CADA turno
 * posterior de la conversación. Cada resultado se capaba a 600 chars y el
 * historial a 10 mensajes, pero no había tope por mensaje: medido el 31/08 en
 * la conversación 39990d7e7b0b, un solo mensaje de 25.419 chars (~8,5k tokens)
 * de una exploración de 20 consultas, arrastrado para siempre.
 */
function llamadas(n: number, tam = 500) {
  return Array.from({ length: n }, (_, i) => ({
    name: `execute_query`,
    arguments: JSON.stringify({ sql: `SELECT ${i} ` + "x".repeat(tam) }),
    result: JSON.stringify({ rows: [{ v: "y".repeat(tam) }] }),
    success: true,
  })) as never;
}

describe("tope del bloque de herramientas en el historial", () => {
  it("una exploración enorme ya no viaja entera", () => {
    const salida = formatToolCallsForHistory(llamadas(20));
    expect(salida.length).toBeLessThan(6_000); // 4.000 + el marco del bloque
  });

  it("dice cuántas omitió — no miente por omisión", () => {
    const salida = formatToolCallsForHistory(llamadas(20));
    expect(salida).toMatch(/y \d+ llamada\(s\) anterior\(es\)/);
  });

  it("conserva las MÁS RECIENTES, que son las relevantes", () => {
    const salida = formatToolCallsForHistory(llamadas(20));
    expect(salida).toContain("SELECT 19");
    expect(salida).not.toContain("SELECT 0 ");
  });

  it("una conversación normal pasa intacta, sin nota de omisión", () => {
    const salida = formatToolCallsForHistory(llamadas(3, 100));
    expect(salida).not.toMatch(/omitidas por longitud/);
    expect(salida).toContain("SELECT 0 ");
    expect(salida).toContain("SELECT 2 ");
  });

  it("nunca se queda vacío: aunque una sola llamada pase del tope, la conserva", () => {
    const salida = formatToolCallsForHistory(llamadas(1, 8_000));
    expect(salida).toContain("execute_query");
  });

  it("sin llamadas devuelve vacío, como antes", () => {
    expect(formatToolCallsForHistory([] as never)).toBe("");
  });
});
