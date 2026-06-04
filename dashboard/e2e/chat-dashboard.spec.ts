/**
 * e2e: dashboard chat — Modificar tab, Analizar tab, and conversation persistence.
 *
 * Covers EC-1 (Modificar), EC-2 (Analizar), EC-3 (persistence/reload).
 *
 * All tests run against a seeded Postgres (init-test-db.sh + seed-dashboards.ts)
 * with DASHBOARD_LLM_PROVIDER=e2e-stub so no real LLM is needed.
 * The stub always replies `[e2e-stub] Respuesta a: "…"` and exercises the real
 * context-log path (context_ref event), so initial-context-toggle appears.
 *
 * See: docs/skills/e2e-testing.md, D-041, EC-1, EC-2, EC-3
 */

import { test, expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import * as path from "path";

// ---------------------------------------------------------------------------
// Setup helpers
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

let dashboardId: number;

test.beforeAll(async () => {
  // Load synthetic seed data into ps_* mirror tables
  const initScript = path.resolve(__dirname, "fixtures/init-test-db.sh");
  const dsn = buildE2eDsn();
  execSync(`${initScript} "${dsn}"`, { stdio: "inherit" });

  // Seed dashboard rows and capture the first ID
  const seedScript = path.resolve(__dirname, "seed-dashboards.ts");
  const dashboardRoot = path.resolve(__dirname, "..");
  const out = execSync(`npx tsx ${seedScript}`, {
    cwd: dashboardRoot,
    env: { ...process.env, POSTGRES_DSN: dsn },
  }).toString();

  const ids = [...out.matchAll(/→ id (\d+)/g)].map((m) => Number(m[1]));
  if (ids.length === 0) throw new Error("seed-dashboards produced no dashboard IDs");
  dashboardId = ids[0];
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** No-error-surface assertions required by D-041 */
async function assertNoErrors(page: Page) {
  await expect(page.locator('[data-testid="error-display"]')).toHaveCount(0);
  await expect(page.getByText("Detalles técnicos")).toHaveCount(0);
  await expect(page.getByText("there is no parameter")).toHaveCount(0);
  await expect(page.getByText("HTTP 500")).toHaveCount(0);
  await expect(page.getByText("Error al cargar")).toHaveCount(0);
}

/** Open the chat on a dashboard. The dashboard renders the sidebar with
 *  `hideWhenClosed` (so there is no floating "Abrir chat" toggle); the chat
 *  opens in Modificar mode via the `?tab=modify` handoff param (DashboardSurface
 *  effect: `tabParam === "modify"` → setChatOpen(true) + Modificar). */
async function openChatSidebar(page: Page) {
  await page.goto(`/dashboard/${dashboardId}?tab=modify`);
  await expect(page.locator('[data-testid="chat-sidebar"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** Type a message and press Enter to send. Returns the user message text. */
async function sendMessage(page: Page, text: string) {
  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await input.fill(text);
  await input.press("Enter");
}

/** Wait until at least one assistant bubble containing [e2e-stub] is visible. */
async function waitForStubReply(page: Page, timeout = 30_000) {
  await expect(
    page.locator('[data-testid="assistant-bubble"]').filter({ hasText: "[e2e-stub]" }),
  ).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// EC-1: Modificar tab
// ---------------------------------------------------------------------------

test("EC-1: Modificar tab — sends message, stub reply visible, context toggle available", async ({
  page,
}) => {
  await openChatSidebar(page);

  // ?tab=modify opens the chat in Modificar mode — assert it is selected
  const modTab = page.locator('[data-testid="tab-modificar"]');
  await expect(modTab).toBeVisible({ timeout: 5_000 });
  await expect(modTab).toHaveAttribute("aria-selected", "true");

  await sendMessage(page, "Prueba e2e tab Modificar");

  // User bubble appears immediately (optimistic)
  await expect(page.locator('[data-testid="user-bubble"]')).toBeVisible({ timeout: 10_000 });

  // Assistant reply from the stub
  await waitForStubReply(page);

  // Context toggle — requires context_ref SSE event to have fired
  await expect(page.locator('[data-testid="initial-context-toggle"]')).toBeVisible({
    timeout: 15_000,
  });

  // No error surfaces (D-041)
  await assertNoErrors(page);
});

// ---------------------------------------------------------------------------
// EC-2: Analizar tab
// ---------------------------------------------------------------------------

test("EC-2: Analizar tab — sends message, stub reply visible, context toggle available", async ({
  page,
}) => {
  await openChatSidebar(page);

  // Switch to Analizar tab
  const anaTab = page.locator('[data-testid="tab-analizar"]');
  await expect(anaTab).toBeVisible({ timeout: 5_000 });
  await anaTab.click();
  await expect(anaTab).toHaveAttribute("aria-selected", "true");

  await sendMessage(page, "Prueba e2e tab Analizar");

  await expect(page.locator('[data-testid="user-bubble"]')).toBeVisible({ timeout: 10_000 });

  await waitForStubReply(page);

  // Context toggle
  await expect(page.locator('[data-testid="initial-context-toggle"]')).toBeVisible({
    timeout: 15_000,
  });

  // No error surfaces
  await assertNoErrors(page);
});

// ---------------------------------------------------------------------------
// EC-3: Persistence — reload shows same messages and context toggle
// ---------------------------------------------------------------------------

test("EC-3: messages persist after page reload — same bubbles and context toggle visible", async ({
  page,
}) => {
  // openChatSidebar navigates to /dashboard/{id}?tab=modify; reloading this
  // URL triggers loadLatest("modify") which rehydrates the latest conversation
  // without any network interception.
  await openChatSidebar(page);

  const userMsg = "Mensaje de persistencia e2e";

  await sendMessage(page, userMsg);

  // User bubble appears immediately (optimistic) — assert the specific message sent
  await expect(
    page.locator('[data-testid="user-bubble"]').filter({ hasText: userMsg }),
  ).toBeVisible({ timeout: 10_000 });

  // Wait for EC-3's own stub reply specifically. The stub echoes the user message:
  // "[e2e-stub] Respuesta a: '<userMsg>'". Filtering by userMsg avoids matching
  // EC-1's pre-existing assistant bubble before EC-3's complete event has fired.
  // Only after EC-3's complete event are msgToTurn and the context toggle ready.
  await expect(
    page.locator('[data-testid="assistant-bubble"]').filter({ hasText: userMsg }),
  ).toBeVisible({ timeout: 30_000 });

  // Reload the same /dashboard/{id}?tab=modify URL — deterministic, no race.
  // We deliberately do NOT assert the context toggle BEFORE reload: that races
  // the live context_ref SSE event for this turn (and a follow-up turn on a
  // conversation EC-1 already created may not re-emit it). The toggle is
  // asserted AFTER reload below, where it is rehydrated from persisted history.
  await page.reload();

  // After reload chatOpen initialises to false then an effect sets it to true;
  // wait for the sidebar to reopen before asserting message contents.
  await expect(page.locator('[data-testid="chat-sidebar"]')).toBeVisible({
    timeout: 15_000,
  });

  // User message reappears
  await expect(
    page.locator('[data-testid="user-bubble"]').filter({ hasText: userMsg }),
  ).toBeVisible({ timeout: 20_000 });

  // EC-3's specific stub reply reappears
  await expect(
    page.locator('[data-testid="assistant-bubble"]').filter({ hasText: userMsg }),
  ).toBeVisible({ timeout: 30_000 });

  // Context toggle is still available — replayed from SSE history after reload
  await expect(page.locator('[data-testid="initial-context-toggle"]')).toBeVisible({
    timeout: 30_000,
  });

  // No error surfaces
  await assertNoErrors(page);
});
