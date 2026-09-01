import { describe, expect, it } from "vitest";
import { INSTRUCTIONS, SQL_PAIRS } from "@/lib/knowledge";

/**
 * El bundle desplegado llegó a contener DOS convenios de temporada a la vez:
 *
 *   (viejo, falso) "PV = Primavera-Verano, OI = Otoño-Invierno … WHERE
 *                   p.clave_temporada = 'PV26'"
 *   (nuevo, real)  V26 / I25, numéricos 74-99, M-prefijados, OUT, TE…
 *
 * El convenio PV/OI NO EXISTE en los datos. Un modelo que siguiera esa regla
 * escribía `= 'PV26'`, obtenía cero filas y le decía al usuario que no había
 * datos de esa temporada — que es justo lo que ocurrió el 2026-09-01.
 *
 * La regla nueva (#946) se añadió SIN retirar la vieja, así que el modelo
 * recibía las dos y ganaba una u otra según el turno: funcionaba unas veces y
 * otras no, que es el peor modo de fallo posible.
 */
const TEXTO = [
  ...INSTRUCTIONS.map((i) => i.instruction),
  ...SQL_PAIRS.map((p) => `${p.question} ${p.sql}`),
].join("\n");

describe("el bundle no puede enseñar un convenio de temporada inventado", () => {
  it("no aparece ninguna clave PV##", () => {
    expect(TEXTO).not.toMatch(/\bPV\d{2}\b/);
  });

  it("no aparece ninguna clave OI##", () => {
    expect(TEXTO).not.toMatch(/\bOI\d{2}\b/);
  });

  it("no se define PV/OI como prefijos de temporada", () => {
    expect(TEXTO).not.toMatch(/PV\s*=\s*Primavera/i);
    expect(TEXTO).not.toMatch(/OI\s*=\s*Oto/i);
  });

  it("sí enseña el convenio real, medido contra producción", () => {
    const temporadas = INSTRUCTIONS.find((i) => i.instruction.startsWith("TEMPORADAS"));
    expect(temporadas).toBeDefined();
    for (const codigo of ["V26", "I25", "M80", "OUT"]) {
      expect(temporadas!.instruction).toContain(codigo);
    }
  });

  // Acotado a las reglas que enseñan a FILTRAR por temporada. Otras reglas
  // mencionan ps_temporadas como una ruta de join más entre varias, y ahí la
  // advertencia no viene a cuento.
  it("la regla de filtrar por temporada avisa de no usar INNER JOIN", () => {
    const reglas = INSTRUCTIONS.filter(
      (i) => /ps_temporadas/.test(i.instruction) && /clave_temporada/.test(i.instruction),
    );
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      // Un INNER JOIN contra el catálogo se comería en silencio las ventas
      // cuya clave moderna no esté dada de alta ahí.
      expect(r.instruction).toMatch(/LEFT JOIN|nunca INNER/i);
    }
  });
});
