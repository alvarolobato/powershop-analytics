import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TimeRangePresetSchema } from "@/lib/schema";
import { buildSystemPrompt } from "@/lib/llm-context/system-prompt";

/**
 * El modelo sólo puede fijar el período por defecto de un panel si sabe (a) que
 * el campo existe y (b) qué valores admite. Las dos cosas viven en el prompt, a
 * mano, así que pueden quedarse atrás en cuanto alguien añada un preset al
 * esquema — y el síntoma sería silencioso: el modelo escribiría un valor que la
 * validación rechaza, o no usaría uno nuevo por no saber que está.
 *
 * Comprobarlo a ojo no vale: revisándolo manualmente me equivoqué dos veces con
 * mis propias expresiones regulares.
 */
const PRESETS = TimeRangePresetSchema.options;

describe("el prompt enseña el período por defecto y sus valores", () => {
  const generate = buildSystemPrompt("generate", {}).stable ?? "";

  it("menciona el campo", () => {
    expect(generate).toContain("default_time_range");
  });

  it.each(PRESETS)("lista el valor «%s»", (preset) => {
    expect(generate).toContain(preset);
  });

  it("dice cuándo ponerlo, no sólo que existe", () => {
    // Un campo documentado sin criterio de uso no se usa.
    expect(generate).toMatch(/PONLO|Pon \*\*default_time_range\*\*/);
  });

  it("distingue período natural de ventana móvil", () => {
    // Es la confusión que provoca el error: pedir "la semana pasada" y recibir
    // los últimos siete días, que arrastran e incluyen hoy.
    expect(generate).toMatch(/last_week/);
    expect(generate).toMatch(/last_7_days/);
    expect(generate).toMatch(/NATURALES|naturales/);
  });

  it("el modificador también los conoce", () => {
    // Si sólo los supiera `generate`, pedir "que se abra en la semana pasada"
    // sobre un panel existente no funcionaría.
    const modify = buildSystemPrompt("modify", {}).stable ?? "";
    expect(modify).toContain("default_time_range");
    expect(modify).toContain("last_week");
  });
});
