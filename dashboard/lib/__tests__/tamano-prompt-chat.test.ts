import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/llm-context/system-prompt";

/**
 * El chat tiene PROHIBIDO emitir una especificación de dashboard — los paneles
 * salen por `start_dashboard_generation` (D-032). Aun así heredaba el bloque de
 * conocimiento completo de `generate`, con sus ejemplos JSON por tipo de widget
 * y su formato de salida: medido el 31/08 sobre el payload real, el 86 % del
 * prompt de chat era material de construir dashboards.
 *
 * No es sólo peso: es una contradicción que empuja al modelo a fabricar paneles
 * cuando le piden cifras — que es exactamente lo que pasó.
 */
describe("el prompt de chat no lleva el manual de fabricar paneles", () => {
  const chat = buildSystemPrompt("chat", {}).stable ?? "";
  const generate = buildSystemPrompt("generate", {}).stable ?? "";

  it("generate SÍ lleva los ejemplos de widgets — los necesita", () => {
    expect(generate).toContain("kpi_row");
    expect(generate.length).toBeGreaterThan(100_000);
  });

  it("chat no lleva los ejemplos JSON por tipo de widget", () => {
    // La marca del bloque OUTPUT_FORMAT / WIDGET_TYPES de generate.
    expect(chat).not.toContain('"widgets": [');
  });

  it("chat es sensiblemente más corto que generate", () => {
    expect(chat.length).toBeLessThan(generate.length);
    const ahorro = generate.length - chat.length;
    expect(ahorro).toBeGreaterThan(10_000);
  });

  it("pero conserva lo que necesita para responder con datos", () => {
    // Semánticas caras de aprender que NO se pueden perder (D-057, D-060).
    expect(chat).toContain("ps_lineas_ventas");
    expect(chat).toContain("FILTER");
    // y saber que puede ofrecer un panel
    expect(chat).toContain("start_dashboard_generation");
  });

  it("summary hereda el mismo bloque reducido, no el de generate", () => {
    const summary = buildSystemPrompt("summary", {}).stable ?? "";
    expect(summary).not.toContain('"widgets": [');
  });
});
