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
  // OJO: no se prohíbe la cadena "PV26". Es un código que existe, y la regla
  // lo cita precisamente para advertir de que no se deduzca. Lo que se prohíbe
  // es AFIRMAR un convenio y filtrar por una clave construida a partir de él.
  it("no define PV/OI como el convenio de temporadas", () => {
    expect(TEXTO).not.toMatch(/PV\s*=\s*Primavera[- ]?Verano\s*,/i);
    expect(TEXTO).not.toMatch(/OI\s*=\s*Oto[ñn]o[- ]?Invierno\s*,/i);
  });

  it("no manda filtrar por una clave deducida del nombre", () => {
    // La forma exacta que rompió: `WHERE p.clave_temporada = 'PV26'` como
    // instrucción, sin haberla mirado en el catálogo.
    const instrucciones = INSTRUCTIONS.map((i) => i.instruction).join("\n");
    expect(instrucciones).not.toMatch(/clave_temporada\s*=\s*'PV\d{2}'/i);
    expect(instrucciones).not.toMatch(/clave_temporada\s*=\s*'OI\d{2}'/i);
  });

  // Lo importante no es que enumere los códigos de hoy —cambian— sino que
  // enseñe a NO suponer formato y a mirar el catálogo.
  it("enseña que no hay formato fijo, en vez de enumerar uno", () => {
    const t = INSTRUCTIONS.find((i) => i.instruction.startsWith("TEMPORADAS"));
    expect(t).toBeDefined();
    expect(t!.instruction).toMatch(/NO TIENE FORMATO FIJO/);
    expect(t!.instruction).toContain("ps_temporadas");
    // y que una en palabras se busca, no se construye
    expect(t!.instruction).toMatch(/ILIKE/);
  });

  it("avisa de los campos del catálogo que están vacíos", () => {
    const t = INSTRUCTIONS.find((i) => i.instruction.startsWith("TEMPORADAS"))!;
    // inicio_ventas/fin_ventas: 0 de 71 filas pobladas, medido 2026-09-01.
    expect(t.instruction).toMatch(/inicio_ventas/);
    expect(t.instruction).toMatch(/vacias|vacías/);
    // temporada_activ no marca la actual: V26=false y 92=true.
    expect(t.instruction).toMatch(/temporada_activ/);
  });

  it("no le dice al modelo que se ahorre mirar", () => {
    const t = INSTRUCTIONS.find((i) => i.instruction.startsWith("TEMPORADAS"))!;
    // La versión anterior decía "no hace falta hacer SELECT DISTINCT", que es
    // justo lo contrario de lo que hay que enseñar cuando el dominio cambia.
    expect(t.instruction).not.toMatch(/no hace falta hacer SELECT DISTINCT/i);
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
