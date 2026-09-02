import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `default_time_range` existía en el esquema, se validaba, y las revisiones
 * semanales lo sembraban — pero NADIE lo leía. `defaultTimeRangeToDateRange`
 * sólo aparecía en su propio test.
 *
 * El panel abría siempre en el mes actual, fijado a fuego en
 * `getDefaultDashboardDateRange`, así que el informe semanal del dueño se abría
 * mostrando septiembre entero. Lo reportó con una captura: "No me sale semana
 * anterior".
 *
 * Es una superficie que no se puede probar cómodamente sin montar la página
 * entera, así que se comprueba el contrato en el fuente: que el período del
 * spec se lea y se aplique, y que la precedencia siga siendo la correcta.
 */
const fuente = readFileSync(
  fileURLToPath(new URL("../DashboardSurface.tsx", import.meta.url)),
  "utf8",
);
const bloque = fuente.slice(fuente.indexOf("aplicadoRangoDelSpec"));

describe("el período por defecto de la definición se aplica", () => {
  it("se lee del spec del panel", () => {
    expect(fuente).toMatch(/dashboard\?\.spec\?\.default_time_range\?\.preset/);
  });

  it("se convierte a un rango de fechas de verdad", () => {
    expect(fuente).toContain("presetToDateRange(preset)");
  });

  it("y se aplica al estado, no sólo se calcula", () => {
    expect(bloque).toContain("setDateRange(rango)");
    expect(bloque).toContain("setComparisonRange");
  });

  it("el enlace profundo de una revisión sigue mandando sobre el spec", () => {
    // Si no, abrir un enlace de la revisión semanal con su rango en la URL
    // acabaría mostrando otro período distinto.
    expect(bloque).toContain("if (appliedUrlRange.current) return;");
  });

  it("sólo se aplica una vez, para no pisar lo que elija el usuario", () => {
    expect(bloque).toContain("if (aplicadoRangoDelSpec.current) return;");
  });

  it("un panel sin período fijado sigue abriendo en el mes actual", () => {
    // Cambiarlo movería el período de TODOS los paneles guardados sin que
    // nadie lo hubiera pedido.
    expect(fuente).toContain("if (!preset) return;");
    expect(fuente).toContain("getDefaultDashboardDateRange()");
  });

  it("se reinicia al cambiar de panel", () => {
    expect(bloque).toMatch(/aplicadoRangoDelSpec\.current = false;/);
  });
});
