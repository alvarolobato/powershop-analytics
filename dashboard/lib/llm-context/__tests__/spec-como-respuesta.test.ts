import { describe, it, expect } from "vitest";
import { looksLikeDashboardSpecInsteadOfAnswer } from "../history";

/**
 * Un JSON de dashboard no es una respuesta.
 *
 * El 2026-08-31 el usuario escribió "Rentabilidad proveedor Lucas fashion
 * temporada v26" — un TEMA, sin verbo ni pregunta. El modelo lo leyó como
 * "hazme un panel de esto": hizo 20 consultas correctas y contestó con 11 KB
 * de especificación de dashboard pegada en el texto. El turno se guardó como
 * `complete` y el usuario no vio ningún resultado, dos veces.
 *
 * A la tercera escribió "No quiero un dashboard, quiero El resultado" y obtuvo
 * las cifras en 71 s. O sea que el sistema sabía la respuesta; falló la FORMA.
 *
 * Es poco frecuente —2 de 148 respuestas de chat— pero silencioso, que es lo
 * que lo hace caro: no hay error, sólo un muro de JSON.
 */
describe("una especificación de dashboard no puede pasar por respuesta", () => {
  const SPEC = `He verificado los datos. Este es el dashboard:
\`\`\`json
{"title":"Rentabilidad V26","widgets":[{"id":"w1","type":"kpi_row","items":[{"label":"Ventas","sql":"SELECT 1"}]}]}
\`\`\``;

  it("marca el spec pegado en el texto", () => {
    expect(looksLikeDashboardSpecInsteadOfAnswer(SPEC, false)).toBe(true);
  });

  it("NO marca la respuesta buena que el usuario acabó recibiendo", () => {
    const buena =
      "## Rentabilidad — LUCAS FASHION · V26\n\n| Métrica | Valor |\n|---|---|\n" +
      "| Ventas netas | 53.210,28 € |\n| Margen % | 66,2 % |\n| Sell-through | 68,5 % |";
    expect(looksLikeDashboardSpecInsteadOfAnswer(buena, false)).toBe(false);
  });

  it("NO marca hablar de widgets en prosa", () => {
    // Sólo buscar `widgets` marcaría respuestas correctas: cabe en una frase.
    const prosa =
      "El panel de ventas tiene 4 widgets y uno de ellos es un kpi_row.";
    expect(looksLikeDashboardSpecInsteadOfAnswer(prosa, false)).toBe(false);
  });

  it("NO marca al modelo explicando el panel que la herramienta acaba de generar", () => {
    // Si llamó a start_dashboard_generation, citar el spec es legítimo: la
    // herramienta lo produjo y él lo está comentando.
    expect(looksLikeDashboardSpecInsteadOfAnswer(SPEC, true)).toBe(false);
  });

  it("tolera texto vacío", () => {
    expect(looksLikeDashboardSpecInsteadOfAnswer("", false)).toBe(false);
  });
});
