// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { presetToDateRange } from "@/lib/time-range";
import { CURRENT_PRESETS, PREVIOUS_PRESETS } from "@/components/DateRangePicker";
import { TimeRangePresetSchema } from "@/lib/schema";
import { substituteDateParams } from "@/lib/date-params";
import { vi, afterEach } from "vitest";

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


describe("lo que llega al SQL, que es donde estaba el bug", () => {
  afterEach(() => vi.useRealTimers());

  /**
   * `presetToDateRange` construye medianoches LOCALES y `toDateStr` extraía con
   * getters UTC. En Madrid la medianoche del lunes son las 22:00Z del domingo,
   * así que la "semana anterior" llegaba al SQL como
   * `BETWEEN '2026-08-23' AND '2026-08-30'` — domingo a domingo, OCHO días.
   *
   * El test anterior sólo comparaba objetos `Date`, así que no lo veía.
   */
  function sqlDe(preset: Parameters<typeof presetToDateRange>[0]) {
    const r = presetToDateRange(preset);
    return substituteDateParams("SELECT 1 WHERE f BETWEEN :curr_from AND :curr_to", {
      curr: r,
    });
  }

  it("semana anterior llega como lunes-domingo, no domingo-domingo", () => {
    // Miércoles 2026-08-26: la semana anterior es del lunes 17 al domingo 23.
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    expect(sqlDe("last_week")).toContain("'2026-08-17' AND '2026-08-23'");
  });

  it("un domingo no devuelve la semana en curso", () => {
    // Domingo 2026-08-30 -> semana anterior = lunes 17 a domingo 23.
    vi.setSystemTime(new Date(2026, 7, 30, 12, 0, 0));
    expect(sqlDe("last_week")).toContain("'2026-08-17' AND '2026-08-23'");
  });

  it("el mes anterior no se desborda al mes de antes", () => {
    // 1 de marzo: el mes anterior es febrero completo.
    vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0));
    expect(sqlDe("last_month")).toContain("'2026-02-01' AND '2026-02-28'");
  });

  it("en enero, el trimestre anterior es el Q4 del año pasado", () => {
    vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
    expect(sqlDe("last_quarter")).toContain("'2025-10-01' AND '2025-12-31'");
  });

  it("el año anterior son sus 365 días", () => {
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
    expect(sqlDe("last_year")).toContain("'2025-01-01' AND '2025-12-31'");
  });
});
