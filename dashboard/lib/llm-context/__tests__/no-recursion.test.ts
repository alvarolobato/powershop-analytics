import { describe, expect, it } from "vitest";
import { toolsForFlow } from "../tools";
import { LLM_FLOWS, type LlmFlow } from "../types";

/**
 * Un flujo de dashboard no puede disponer de la herramienta que arranca
 * otra generación de dashboard: cada llamada crea un turno de seguimiento
 * que a su vez podría volver a llamarla.
 *
 * El handler ya lo pide por texto ("NO vuelvas a llamar a
 * start_dashboard_generation en este turno"), pero una instrucción en el
 * prompt no es una garantía — el catálogo sí.
 */
const FLUJOS_DE_CHAT: LlmFlow[] = ["chat", "summary"];

function nombres(flow: LlmFlow): string[] {
  return toolsForFlow(flow).map((t) => t.function.name);
}

describe("toolsForFlow — sin recursión de generación", () => {
  const flujosDeDashboard = (LLM_FLOWS as readonly LlmFlow[]).filter(
    (f) => !FLUJOS_DE_CHAT.includes(f),
  );

  it("cubre todos los flujos declarados (si se añade uno nuevo, este test lo ve)", () => {
    expect(flujosDeDashboard.length).toBeGreaterThan(0);
    expect([...flujosDeDashboard, ...FLUJOS_DE_CHAT].sort()).toEqual([...LLM_FLOWS].sort());
  });

  it.each(flujosDeDashboard)("%s no puede lanzar otra generación", (flow) => {
    expect(nombres(flow)).not.toContain("start_dashboard_generation");
  });

  it.each(FLUJOS_DE_CHAT)("%s sí la conserva — es su vía de entrada", (flow) => {
    expect(nombres(flow)).toContain("start_dashboard_generation");
  });

  it("quitarla no se lleva por delante el resto del catálogo", () => {
    const deChat = nombres("chat");
    const deGenerate = nombres("generate");
    expect(deGenerate).toContain("execute_query");
    expect(deGenerate).toContain("describe_ps_table");
    // generate conserva las de escritura que chat no tiene
    expect(deGenerate.length).toBeGreaterThan(deChat.length - 1);
  });
});
