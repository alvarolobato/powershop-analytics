import { defineConfig, devices } from "@playwright/test";
import { E2E_FOTOS_CACHE_DIR, E2E_FOTOS_DIR } from "./e2e/fotos-fixture";

const PORT = process.env.DASHBOARD_PORT ?? "4000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Expects an already-running dev server. Use `npm run dev` to start it.
  webServer: {
    command: `npm run dev`,
    // Fotos de artículo (D-068): el espejo real solo existe en producción, así
    // que el servidor de e2e mira un directorio sintético que siembra
    // e2e/article-photos.spec.ts. Se suma al entorno heredado, no lo sustituye.
    // Con `reuseExistingServer`, un servidor ya levantado conserva SU entorno:
    // para ese spec tiene que haber arrancado con este mismo FOTOS_DIR.
    env: {
      FOTOS_DIR: E2E_FOTOS_DIR,
      FOTOS_CACHE_DIR: E2E_FOTOS_CACHE_DIR,
    },
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
