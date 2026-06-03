/**
 * e2e: saved dashboards render without widget error states against seeded Postgres.
 *
 * Covers: review dashboards (ventas_retail, canal_mayorista, stock, compras)
 * and one standard template dashboard (ventas). Every seeded dashboard must:
 *   - Show no ErrorDisplay (no widget SQL errors)
 *   - Show no loading skeletons after the timeout (widgets resolved)
 *   - Show no "Detalles técnicos" / "there is no parameter" / "HTTP 500"
 *
 * Spec motivation (D-041): the weekly-review dashboards shipped `there is no
 * parameter $1` to production because unit tests mocked Postgres. This spec
 * would have caught that bug — reverting the `:curr` fix makes this fail.
 *
 * Setup: seed-dashboards.ts creates the dashboard rows; init-test-db.sh loads
 * the ps_* mirror data.
 *
 * See: docs/skills/e2e-testing.md, D-041, dashboard/e2e/fixtures/README.md
 */

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildE2eDsn(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  if (process.env.POSTGRES_DSN) return process.env.POSTGRES_DSN;
  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = process.env.POSTGRES_PORT ?? "5432";
  const user = process.env.POSTGRES_USER ?? "postgres";
  const pass = process.env.POSTGRES_PASSWORD ?? "postgres";
  const db = process.env.POSTGRES_DB ?? "powershop_e2e";
  return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

// ---------------------------------------------------------------------------
// Setup — seed ps_* data and create the dashboard rows
// ---------------------------------------------------------------------------

let dashboardIds: number[] = [];

test.beforeAll(async ({ request }) => {
  // 1. Load the synthetic seed (ps_* mirror tables)
  const initScript = path.resolve(__dirname, "fixtures/init-test-db.sh");
  const dsn = buildE2eDsn();
  execSync(`${initScript} "${dsn}"`, { stdio: "inherit" });

  // 2. Seed the dashboard rows using the app's seeder script
  const seedScript = path.resolve(__dirname, "seed-dashboards.ts");
  // npx tsx resolves from the dashboard/ package root where tsx is installed
  const dashboardRoot = path.resolve(__dirname, "..");
  execSync(`npx tsx ${seedScript}`, {
    stdio: "inherit",
    cwd: dashboardRoot,
    env: { ...process.env },
  });

  // 3. Discover the created dashboard IDs
  const resp = await request.get("/api/dashboards");
  expect(resp.ok()).toBeTruthy();
  const dashboards = (await resp.json()) as Array<{ id: number; name: string }>;
  expect(dashboards.length).toBeGreaterThan(0);
  dashboardIds = dashboards.map((d) => d.id);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all seeded dashboards render without widget error states", async ({ page }) => {
  expect(dashboardIds.length).toBeGreaterThan(0);

  for (const id of dashboardIds) {
    await page.goto(`/dashboard/${id}`);

    // Wait for the page to load past the initial loading state
    // (either DashboardRenderer renders widgets, or an error surface appears)
    await page.waitForFunction(
      () => {
        const skeletons = document.querySelectorAll('[data-testid="widget-skeleton"]');
        const errors = document.querySelectorAll('[data-testid="error-display"]');
        // Page is resolved when skeletons are gone OR errors appeared
        return skeletons.length === 0 || errors.length > 0;
      },
      { timeout: 30_000 },
    );

    // No error surfaces
    await expect(page.locator('[data-testid="error-display"]')).toHaveCount(
      0,
      { message: `Dashboard id=${id}: ErrorDisplay visible — widget SQL failed` },
    );
    await expect(page.getByText("Detalles técnicos")).toHaveCount(0, {
      message: `Dashboard id=${id}: "Detalles técnicos" visible`,
    });
    await expect(page.getByText("there is no parameter")).toHaveCount(0, {
      message: `Dashboard id=${id}: positional param error visible`,
    });
    await expect(page.getByText("HTTP 500")).toHaveCount(0, {
      message: `Dashboard id=${id}: HTTP 500 visible`,
    });
    await expect(page.getByText("Error al cargar")).toHaveCount(0, {
      message: `Dashboard id=${id}: "Error al cargar" visible`,
    });

    // No lingering skeletons — all widgets resolved
    await expect(page.locator('[data-testid="widget-skeleton"]')).toHaveCount(
      0,
      { message: `Dashboard id=${id}: skeletons still present after load` },
    );
  }
});

test("seeded dashboards list page renders without errors", async ({ page }) => {
  await page.goto("/paneles");

  await expect(page.locator('[data-testid="error-display"]')).toHaveCount(0);

  // At least one dashboard card should be visible
  // (The paneles page renders dashboard names as links)
  await expect(page.locator("a[href*='/dashboard/']").first()).toBeVisible({
    timeout: 15_000,
  });
});
