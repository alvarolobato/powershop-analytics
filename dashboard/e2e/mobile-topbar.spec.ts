/**
 * e2e: mobile shell — hamburger nav, dot-only sync indicator (PR 5,
 * mobile-improvements batch).
 *
 * Before this PR `TopBar.tsx` had zero responsive treatment and
 * `globals.css` had exactly one media query (`@media print`) — the header
 * was a single non-wrapping flex row that overflowed a 390px viewport by
 * ~264px on every route.
 *
 * MEASUREMENT TRAP (do not undo this): assert against
 * `document.documentElement.clientWidth`, never `window.innerWidth`. Under
 * Chromium device emulation `innerWidth` reports the layout viewport width
 * used for *zoom*, which hides the overflow — `clientWidth` is the real
 * rendered viewport (see `docs/decisions/D-*-mobile-*.md`).
 *
 * Same real-server/real-Postgres pattern as e2e/home.spec.ts and
 * e2e/conversations-screen.spec.ts. Requires the app running under
 * DASHBOARD_LLM_PROVIDER=e2e-stub with `init-test-db.sh` applied.
 *
 * See: docs/skills/e2e-testing.md, D-041.
 */

import { test, expect, devices, type Page } from "@playwright/test";
import { execSync } from "child_process";
import * as path from "path";

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

test.beforeAll(async () => {
  const dsn = buildE2eDsn();
  const scriptPath = path.resolve(__dirname, "fixtures/init-test-db.sh");
  execSync(`${scriptPath} "${dsn}"`, { stdio: "inherit" });
});

// Different page shapes behind the same shell: the redesigned home, the
// dashboard list, conversations, an admin page, and a route with no page
// content at all (404) — proving the fix is the shell, not any one page.
const ROUTES_MEASURED_OVERFLOWING = [
  "/inicio",
  "/paneles",
  "/conversations",
  "/etl",
  "/route-that-does-not-exist-mobile-shell",
];

/** Real rendered viewport (NOT window.innerWidth — see file header). */
async function documentOverflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function headerOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return 0;
    return header.scrollWidth - header.clientWidth;
  });
}

test.describe("mobile shell (iPhone 13 emulation, 390px)", () => {
  // Dropping `defaultBrowserType` keeps this on the project's single
  // chromium project while still getting the iPhone 13 viewport/isMobile/
  // hasTouch profile.
  const { defaultBrowserType: _defaultBrowserType, ...iPhone13 } = devices["iPhone 13"];
  test.use({ ...iPhone13 });

  test("header does not overflow the viewport, on every measured route", async ({ page }) => {
    for (const route of ROUTES_MEASURED_OVERFLOWING) {
      await page.goto(route);
      // document.documentElement.clientWidth — never window.innerWidth,
      // which reports ~653 under emulation regardless of the real 390px
      // viewport.
      expect(
        await page.evaluate(() => document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(400);
      expect(await headerOverflowPx(page), `header overflow on ${route}`).toBeLessThanOrEqual(0);
      expect(await documentOverflowPx(page), `document overflow on ${route}`).toBeLessThanOrEqual(
        0,
      );
    }
  });

  test("mobile header collapses to hamburger", async ({ page }) => {
    await page.goto("/inicio");

    // Freshness dot still renders (nothing hides it on mobile — item 1
    // scoped the collapse to nav/admin/avatar only). Assert on the
    // wrapper's own child rather than a colour, since the dot's exact
    // colour depends on unrelated freshness state.
    const dot = page.locator('header span[style*="border-radius: 50%"]').first();
    await expect(dot).toBeVisible();

    // Hamburger is present with the required a11y attributes and hit area.
    const hamburger = page.getByRole("button", { name: "Menú" });
    await expect(hamburger).toBeVisible();
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    const box = await hamburger.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    // Desktop-only chrome is gone: inline nav, Admin link, avatar.
    await expect(page.getByRole("link", { name: "Inicio", exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeHidden();
    await expect(page.getByLabel("Avatar de usuario")).toBeHidden();

    await expect(page.locator('[data-testid="error-display"]')).toHaveCount(0);
  });

  test("hamburger menu navigates, closes on link tap, Wren stays reachable", async ({ page }) => {
    await page.goto("/inicio");
    const hamburger = page.getByRole("button", { name: "Menú" });
    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator("#mobile-nav-panel");
    await expect(panel).toBeVisible();

    const rows = ["Inicio", "Paneles", "Conversaciones", "Revisión", "Wren", "Admin"] as const;
    for (const label of rows) {
      const row = panel.getByRole("link", { name: label, exact: true });
      await expect(row).toBeVisible();
      const box = await row.boundingBox();
      expect(box?.height, `${label} row hit area`).toBeGreaterThanOrEqual(44);
    }

    await panel.getByRole("link", { name: "Conversaciones", exact: true }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    // Menu closed itself on navigation.
    await expect(page.locator("#mobile-nav-panel")).toHaveCount(0);
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
  });

  test("menu closes on outside tap and on Escape", async ({ page }) => {
    await page.goto("/inicio");
    const hamburger = page.getByRole("button", { name: "Menú" });

    await hamburger.click();
    await expect(page.locator("#mobile-nav-panel")).toBeVisible();
    // Tap below the panel, outside both the panel and the button.
    await page.mouse.click(195, 700);
    await expect(page.locator("#mobile-nav-panel")).toHaveCount(0);

    await hamburger.click();
    await expect(page.locator("#mobile-nav-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-nav-panel")).toHaveCount(0);
  });
});

test.describe("desktop (>=768px) — unchanged", () => {
  // No device override: the project's own Desktop Chrome viewport
  // (playwright.config.ts) applies.
  test("wordmark, inline nav, full sync text, admin link and avatar all show; hamburger absent", async ({
    page,
  }) => {
    await page.goto("/inicio");

    await expect(page.getByText("Powershop", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inicio", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Paneles", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Conversaciones", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByLabel("Avatar de usuario")).toBeVisible();

    await expect(page.getByRole("button", { name: "Menú" })).toBeHidden();
    await expect(page.locator("#mobile-nav-panel")).toHaveCount(0);

    expect(await headerOverflowPx(page)).toBeLessThanOrEqual(0);
  });
});
