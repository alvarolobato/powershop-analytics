import { describe, expect, it } from "vitest";
import { parseSeason } from "@/lib/seasons";

/**
 * La versión anterior sólo aceptaba `^(PV|OI)\d{2}$` y devolvía null para todo
 * lo demás. `/api/seasons` descarta los null, así que las temporadas
 * desaparecían del filtro sin un solo error — y el convenio PV/OI ni siquiera
 * es el que usan los datos.
 *
 * Los códigos de abajo están medidos contra producción el 2026-08-31 (64
 * códigos vivos), no inventados.
 */
const CODIGOS_REALES = [
  "V25", "V26", "V27", "I24", "I25", "I26",
  "74", "80", "92", "98", "99",
  "M80", "M99", "MV25", "MV26", "MI24", "MI26",
  "A91", "A99",
  "OUT", "OU", "BA", "TE", "TEKG", "TEYD",
];

describe("parseSeason — ningún código real puede desaparecer", () => {
  it.each(CODIGOS_REALES)("%s se muestra, no se descarta", (code) => {
    const s = parseSeason(code);
    expect(s).not.toBeNull();
    expect(s!.code).toBe(code.toUpperCase());
    expect(s!.label.trim().length).toBeGreaterThan(0);
  });

  it("con el parser anterior se perdían TODOS ellos", () => {
    const viejo = (c: string) => /^(PV|OI)\d{2}$/i.test(c.trim());
    expect(CODIGOS_REALES.filter(viejo)).toHaveLength(0);
    expect(CODIGOS_REALES.every((c) => parseSeason(c) !== null)).toBe(true);
  });
});

describe("etiquetas legibles donde se puede", () => {
  it("V26 es Verano 2026", () => {
    expect(parseSeason("V26")!.label).toBe("Verano 2026");
  });
  it("I25 es Invierno 2025", () => {
    expect(parseSeason("I25")!.label).toBe("Invierno 2025");
  });
  it("MV26 se marca como mayorista", () => {
    expect(parseSeason("MV26")!.label).toBe("Verano 2026 (mayorista)");
  });
  it("un código desconocido se muestra tal cual", () => {
    expect(parseSeason("TEKG")!.label).toBe("TEKG");
  });
});

describe("no se inventan rangos de fecha", () => {
  // Una temporada se vende ANTES de su año nominal: V26 registra su primera
  // venta el 2025-12-06. Un rango deducido recortaría el arranque en silencio,
  // que es la misma clase de fallo que el descarte.
  it.each(["V26", "I25", "99", "MV25", "OUT"])("%s no trae rango deducido", (c) => {
    const s = parseSeason(c)!;
    expect(s.from).toBeNull();
    expect(s.to).toBeNull();
  });

  it("PV26 sí lo trae — ahí el convenio es explícito", () => {
    const s = parseSeason("PV26")!;
    expect(s.from).toBe("2026-02-01");
    expect(s.to).toBe("2026-08-31");
  });
});

describe("bordes", () => {
  it("vacío o sólo espacios sigue siendo null", () => {
    expect(parseSeason("")).toBeNull();
    expect(parseSeason("   ")).toBeNull();
  });
  it("normaliza a mayúsculas y quita espacios", () => {
    expect(parseSeason("  v26 ")!.code).toBe("V26");
  });
});
