// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { presetToDateRange } from "@/lib/time-range";
import { CURRENT_PRESETS, PREVIOUS_PRESETS } from "@/components/DateRangePicker";
import { TimeRangePresetSchema } from "@/lib/schema";

/**
 * El selector de fechas ya sabía elegir "Semana anterior", pero una definición
 * de cuadro de mandos no podía pedirlo: el esquema sólo tenía `today`,
 * `last_7_days`, `last_30_days`, `current_month`, `last_month` y
 * `year_to_date`. El dueño lo pidió para su informe semanal.
 *
 * El riesgo de tener los períodos en dos sitios es que diverjan, así que aquí
 * se comprueba que dan EXACTAMENTE el mismo rango.
 */
const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function delSelector(label: string) {
  const p = [...CURRENT_PRESETS, ...PREVIOUS_PRESETS].find((x) => x.label === label);
  if (!p) throw new Error(`el selector no ofrece "${label}"`);
  return p.range();
}

describe("los períodos de la definición coinciden con los del selector", () => {
  it.each([
    ["last_week", "Semana anterior"],
    ["current_week", "Semana actual"],
    ["last_month", "Mes anterior"],
    ["current_month", "Mes actual"],
    ["last_quarter", "Trimestre anterior"],
    ["current_quarter", "Trimestre actual"],
    ["last_year", "Año anterior"],
    ["today", "Hoy"],
    ["yesterday", "Ayer"],
  ] as const)("%s == «%s»", (preset, label) => {
    const a = presetToDateRange(preset);
    const b = delSelector(label);
    expect(mismoDia(a.from, b.from), `inicio de ${preset}`).toBe(true);
    expect(mismoDia(a.to, b.to), `fin de ${preset}`).toBe(true);
  });
});

describe("semana anterior es la semana CERRADA, no los últimos 7 días", () => {
  it("va de lunes a domingo", () => {
    const r = presetToDateRange("last_week");
    expect(r.from.getDay(), "debe empezar en lunes").toBe(1);
    expect(r.to.getDay(), "debe acabar en domingo").toBe(0);
  });

  it("cubre siete días completos", () => {
    const r = presetToDateRange("last_week");
    // De lunes 00:00:00 a domingo 23:59:59 son 6 días y casi 24 horas.
    const horas = (r.to.getTime() - r.from.getTime()) / 3_600_000;
    expect(horas).toBeGreaterThan(6 * 24);
    expect(horas).toBeLessThan(7 * 24);
  });

  it("NO incluye hoy, a diferencia de last_7_days", () => {
    const semana = presetToDateRange("last_week");
    const siete = presetToDateRange("last_7_days");
    const hoy = new Date();
    expect(semana.to.getTime()).toBeLessThan(new Date(hoy.toDateString()).getTime());
    expect(mismoDia(siete.to, hoy), "last_7_days sí llega hasta hoy").toBe(true);
  });
});

describe("el esquema", () => {
  it("acepta los períodos nuevos", () => {
    for (const p of ["last_week", "current_week", "yesterday", "last_quarter", "last_year"]) {
      expect(TimeRangePresetSchema.safeParse(p).success, p).toBe(true);
    }
  });

  it("sigue rechazando lo que no existe", () => {
    expect(TimeRangePresetSchema.safeParse("la_semana_pasada").success).toBe(false);
  });
});
