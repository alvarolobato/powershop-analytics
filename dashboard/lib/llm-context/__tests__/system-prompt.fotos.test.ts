/**
 * Los enlaces de artículo son FORMATO de respuesta, no una regla de negocio.
 *
 * Estuvieron en `## LLM:rules` y el modelo los ignoró: una conversación de 15
 * respuestas con 67 identificadores no emitió ni un enlace, quince horas
 * después de desplegar la regla y con el registro de contexto demostrando que
 * sí le llegó. Estos tests fijan que la instrucción vive donde se obedece —
 * el preámbulo que define cómo se contesta— y no vuelve a diluirse entre las
 * sesenta reglas de dominio.
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../system-prompt";

const vars = {} as Parameters<typeof buildSystemPrompt>[1];

describe("enlaces de artículo en el preámbulo", () => {
  for (const flow of ["chat", "summary"] as const) {
    it(`el flujo ${flow} pide enlazar los artículos`, () => {
      const { stable } = buildSystemPrompt(flow, vars);
      expect(stable).toContain("articulo:");
      expect(stable).toContain("enlace");
    });

    it(`${flow}: la instrucción va en el preámbulo, no al final del prompt`, () => {
      // Lo que se diluye es una instrucción de formato perdida en mitad de
      // 168 KB de reglas de dominio. Aquí se exige que caiga en el primer
      // tercio, junto al resto del "cómo se responde".
      const { stable } = buildSystemPrompt(flow, vars);
      const pos = stable.indexOf("articulo:");
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos / stable.length).toBeLessThan(0.34);
    });
  }

  it("avisa de no inventarse identificadores", () => {
    const { stable } = buildSystemPrompt("chat", vars);
    expect(stable).toMatch(/inventado|SOLO identificadores/i);
  });
});
