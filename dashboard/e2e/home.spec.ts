/**
 * e2e: home page (`/`) renders without error surfaces against seeded Postgres.
 *
 * Spec motivation: unit tests mock Postgres and cannot catch SQL runtime errors.
 * This spec loads real seed data and asserts the home renders real content —
 * catching errors like `there is no parameter $1` before they reach production.
 *
 * Requires:
 *   - `init-test-db.sh` called before this suite (done in beforeAll below, or externally).
 *   - App started with `DASHBOARD_LLM_PROVIDER=e2e-stub`.
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
// Setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  const dsn = buildE2eDsn();
  const scriptPath = path.resolve(__dirname, "fixtures/init-test-db.sh");
  execSync(`${scriptPath} "${dsn}"`, { stdio: "inherit" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("home page renders without error surfaces", async ({ page }) => {
  await page.goto("/");

  // Wait for the hero section to appear (signals the page loaded)
  await page.waitForSelector('[data-testid="hero-today"]', { timeout: 30_000 });

  // No error surfaces should be visible
  await expect(page.locator('[data-testid="error-display"]')).toHaveCount(0);
  await expect(page.getByText("Detalles técnicos")).toHaveCount(0);
  await expect(page.getByText("there is no parameter")).toHaveCount(0);
  await expect(page.getByText("HTTP 500")).toHaveCount(0);
  await expect(page.getByText("Error al cargar")).toHaveCount(0);
});

test("home page hero-today renders real values (not skeleton)", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator('[data-testid="hero-today"]');
  await expect(hero).toBeVisible({ timeout: 30_000 });

  // The hero should contain a non-empty numeric value (sales total for today)
  // Assert shape, not exact figure — the synthetic seed has today's sales.
  const heroText = await hero.innerText();
  expect(heroText.trim().length).toBeGreaterThan(0);
  // Should contain a euro symbol or numeric — confirms it's not a skeleton placeholder
  expect(heroText).toMatch(/[0-9€]/);
});

test("home page period-grid renders real content", async ({ page }) => {
  await page.goto("/");

  const grid = page.locator('[data-testid="period-grid"]');
  await expect(grid).toBeVisible({ timeout: 30_000 });

  // Grid should contain cells with data (not just empty placeholders)
  const gridText = await grid.innerText();
  expect(gridText.trim().length).toBeGreaterThan(0);
});
