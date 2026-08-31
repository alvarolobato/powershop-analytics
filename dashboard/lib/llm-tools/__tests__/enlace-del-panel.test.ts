import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * El resumen que emite `start_dashboard_generation` se guarda como mensaje de
 * asistente y se pinta con ReactMarkdown. Emitía una ruta suelta
 * ("/dashboard/22?tab=modify&continue=..."), que sale como texto plano: no se
 * puede pinchar y copiarla a mano es incómodo por la query string.
 */
describe("enlace del panel en el resumen", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  async function urlPublica() {
    const { getAppPublicUrl } = await import("@/lib/public-urls");
    return getAppPublicUrl();
  }

  it("la URL pública se lee de la configuración, no se inventa", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://power.lobato.vip");
    expect(await urlPublica()).toBe("https://power.lobato.vip");
  });

  it("le quita la barra final para no generar dobles barras", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://power.lobato.vip/");
    expect(await urlPublica()).toBe("https://power.lobato.vip");
  });

  // El formato exacto del resumen: enlace markdown con URL absoluta.
  it("el resumen lleva un enlace markdown absoluto, no una ruta suelta", () => {
    const base = "https://power.lobato.vip";
    const ruta = "/dashboard/22?tab=modify&continue=39990d7e7b0b";
    const resumen =
      `Panel "X" creado con 5 widget(s). ` +
      `[Abrir el panel](${base}${ruta}) para revisarlo y modificarlo.`;

    // clickable: sintaxis de enlace markdown
    expect(resumen).toMatch(/\[.+\]\(https:\/\/.+\)/);
    // absoluto: nada de rutas relativas sueltas
    expect(resumen).toContain("https://power.lobato.vip/dashboard/22");
    // la conversación de origen se conserva para poder seguir modificando
    expect(resumen).toContain("continue=39990d7e7b0b");
  });

  it("el fichero fuente construye la URL con getAppPublicUrl, no a mano", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../handlers/start-dashboard-generation.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("getAppPublicUrl()");
    expect(src).toMatch(/\[Abrir el panel\]\(\$\{urlAbsoluta\}\)/);
    // no debe quedar la versión antigua con la ruta suelta
    expect(src).not.toMatch(/Visita \$\{redirectUrl\}/);
  });
});
