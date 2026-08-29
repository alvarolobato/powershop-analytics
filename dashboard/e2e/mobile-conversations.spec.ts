/**
 * e2e: chat on mobile — `/conversations/[id]`'s two-pane split view
 * collapses to a single pane below `md` (768px), and the `/conversations`
 * list stays usable at phone width (PR 5, mobile-improvements batch).
 *
 * `/conversations/[id]` opens a long-lived SSE connection the instant it
 * mounts — `page.goto` with `waitUntil: "networkidle"` never resolves on
 * that route. Every navigation to it in this file uses
 * `waitUntil: "load"` plus an explicit visible-marker wait instead.
 *
 * Same real-server/real-Postgres/`/api/conversations` seeding pattern as
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

const TEST_MESSAGE = "Mensaje e2e para mobile-conversations";
let convId: string;

test.beforeAll(async ({ request }) => {
  const initScript = path.resolve(__dirname, "fixtures/init-test-db.sh");
  const dsn = buildE2eDsn();
  execSync(`${initScript} "${dsn}"`, { stdio: "inherit" });

  // Global free-chat conversation (mirrors conversations-screen.spec.ts's
  // setup) with one real turn, so both the list and the detail pane have
  // real content to render.
  const convResp = await request.post("/api/conversations", {
    data: { mode: "chat", context_kind: "global", first_user_prompt: TEST_MESSAGE },
  });
  expect(convResp.ok()).toBeTruthy();
  const convBody = await convResp.json();
  convId = (convBody as { id: string }).id;
  expect(convId).toBeTruthy();

  const turnResp = await request.post(`/api/conversations/${convId}/turns`, {
    data: { content: TEST_MESSAGE },
  });
  expect(turnResp.ok()).toBeTruthy();
  const turnBody = await turnResp.json();
  const turnId = (turnBody as { turnId: string }).turnId;
  let finalStatus: string | undefined;
  for (let i = 0; i < 15; i++) {
    const poll = await request.get(`/api/conversations/${convId}/turns/${turnId}`);
    if (poll.ok()) {
      const pollBody = await poll.json();
      const status = (pollBody as { turn?: { status?: string } }).turn?.status;
      if (status === "complete" || status === "error") {
        finalStatus = status;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  expect(finalStatus).toBe("complete");
});

// `/conversations/[id]` keeps an SSE connection open forever — never
// "networkidle" on this one route. "load" + a visible marker + a fixed
// settle stands in for it.
async function gotoConversationAndSettle(page: Page, id: string): Promise<void> {
  await page.goto(`/conversations/${id}`, { waitUntil: "load" });
  await expect(page.getByTestId("message-input"), "the conversation pane rendered").toBeVisible();
  await page.waitForTimeout(1000);
}

async function clientWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.clientWidth);
}

test.describe("phone width (iPhone 13 emulation)", () => {
  const { defaultBrowserType: _defaultBrowserType, ...iPhone13 } = devices["iPhone 13"];
  test.use({ ...iPhone13 });

  test("chat collapses to a single usable pane", async ({ page }) => {
    await gotoConversationAndSettle(page, convId);
    const width = await clientWidth(page);
    expect(width, "sanity: this really is the mobile viewport").toBeLessThan(768);

    // The sidebar must be genuinely hidden (display: none via the
    // `hidden md:flex` class), not just visually squeezed — asserting
    // `display`, the real CSS property the fix controls, not a proxy.
    const sidebarDisplay = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="conversation-list-sidebar"]');
      return el ? getComputedStyle(el).display : "not-found";
    });
    expect(sidebarDisplay, "sidebar is display:none below md").toBe("none");

    const backLink = page.getByRole("link", { name: "← Conversaciones" });
    await expect(backLink, "back-to-list link is visible").toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/conversations");

    // This link is brand-new markup and renders only below `md`, i.e. only
    // on a touch screen — it has to clear the repo's 44px tap-target
    // floor.
    const backBox = await backLink.boundingBox();
    expect(backBox, "back link has a bounding box").not.toBeNull();
    if (backBox) {
      expect(
        backBox.height,
        `back-to-list link is ${backBox.height}px tall — must clear the 44px tap-target floor`,
      ).toBeGreaterThanOrEqual(44);
    }

    // No horizontal overflow on the pane itself.
    const main = await page.evaluate(() => {
      const m = document.querySelector("main.main-content")!;
      return { clientWidth: m.clientWidth, scrollWidth: m.scrollWidth };
    });
    expect(main.scrollWidth, "main.main-content has no horizontal overflow").toBeLessThanOrEqual(
      main.clientWidth + 1,
    );
  });

  test("desktop split view still renders both panes (sanity check for the md breakpoint)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await gotoConversationAndSettle(page, convId);
    const sidebarDisplay = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="conversation-list-sidebar"]');
      return el ? getComputedStyle(el).display : "not-found";
    });
    expect(sidebarDisplay, "sidebar renders at desktop width").not.toBe("none");

    const backLink = page.getByRole("link", { name: "← Conversaciones" });
    await expect(backLink, "mobile-only back link is hidden at desktop width").toBeHidden();
  });

  test("list gives the title the space the dropped columns freed", async ({ page }) => {
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId("conversations-table")).toBeVisible();
    await page.waitForTimeout(1000);

    const width = await clientWidth(page);
    const titleCell = page.getByTestId(`title-cell-${convId}`);
    await expect(titleCell, "the seeded conversation's title is visible").toBeVisible();

    // The checkbox and Acciones columns are gone from layout below `md`
    // (`hidden md:table-*`). Assert `display`, the property the change
    // actually controls — a visibility proxy would also pass if they were
    // merely squeezed to zero width, which is the bug being fixed.
    const dropped = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="conversations-table"] tbody tr')!;
      const cells = Array.from(row.querySelectorAll("td"));
      const pencil = row.querySelector('[data-testid^="rename-btn-"]');
      return {
        checkbox: getComputedStyle(cells[0]).display,
        acciones: getComputedStyle(cells[cells.length - 1]).display,
        pencil: pencil ? getComputedStyle(pencil).display : "not-found",
      };
    });
    expect(dropped.checkbox, "checkbox column is display:none on a phone").toBe("none");
    expect(dropped.acciones, "Acciones column is display:none on a phone").toBe("none");
    expect(dropped.pencil, "rename pencil is display:none on a phone").toBe("none");

    // The point of dropping them: the title gets that width. The three
    // columns were 36 + 116 + the pencil; the title should now run nearly
    // the full content box, not the ~190px it was left with.
    const box = await titleCell.boundingBox();
    expect(box, "title has a bounding box").not.toBeNull();
    if (box) {
      expect(
        box.width,
        `title is ${box.width}px of a ${width}px viewport — it should now take nearly all of it`,
      ).toBeGreaterThan(width * 0.85);
    }

    // "haz que se lea más el texto": two lines at 15px, not one at 12px.
    const text = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="conversations-table"] .conv-title-text')!;
      const cs = getComputedStyle(el);
      return {
        fontSize: parseFloat(cs.fontSize),
        clamp: cs.webkitLineClamp || cs.getPropertyValue("-webkit-line-clamp"),
        whiteSpace: cs.whiteSpace,
      };
    });
    expect(text.fontSize, `title font is ${text.fontSize}px — must be larger than the 12px desktop size`).toBeGreaterThanOrEqual(15);
    expect(text.whiteSpace, "title wraps instead of ellipsising on one line").not.toBe("nowrap");
    expect(text.clamp, "title is clamped to two lines").toBe("2");

    // The meta line replaces the Contexto / Última actividad columns that
    // are hidden at this width, so no information is simply lost.
    await expect(
      page.getByTestId(`title-meta-${convId}`),
      "phone meta line (relative time + context) is visible",
    ).toBeVisible();

    // The row is the tap target now that the icon buttons are gone.
    const rowHeight = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="conversations-table"] tbody tr')!;
      return Math.round(row.getBoundingClientRect().height);
    });
    expect(rowHeight, `row is ${rowHeight}px tall — must clear the 44px tap floor`).toBeGreaterThanOrEqual(44);

    const offenders = await page.evaluate((clientW) => {
      const bad: { tag: string; testid: string | null; right: number }[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > clientW + 1) {
          bad.push({ tag: el.tagName, testid: el.getAttribute("data-testid"), right: Math.round(rect.right) });
        }
      });
      return bad;
    }, width);
    expect(offenders, "no element extends past the document at phone width").toEqual([]);
  });

  test("tapping the title opens the conversation", async ({ page }) => {
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId("conversations-table")).toBeVisible();
    await page.waitForTimeout(600);

    await page.getByTestId(`title-cell-${convId}`).click();
    await expect(page.getByTestId("message-input"), "the conversation pane opened").toBeVisible();
    expect(page.url(), "navigated to the conversation").toContain(`/conversations/${convId}`);
  });

  test("the list's actions are reachable inside the conversation instead", async ({ page }) => {
    await gotoConversationAndSettle(page, convId);

    const strip = page.getByTestId("conv-detail-actions");
    await expect(strip, "phone action strip is rendered in the conversation").toBeVisible();

    // Every relocated action has to clear the tap floor — that was the
    // reason they could not stay as 12-22px glyphs in the list.
    for (const id of ["conv-detail-rename-btn", "conv-detail-archive-btn", "conv-detail-context-btn"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has a bounding box`).not.toBeNull();
      if (box) {
        expect(box.height, `${id} is ${box.height}px tall — must clear the 44px floor`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${id} is ${box.width}px wide — must clear the 44px floor`).toBeGreaterThanOrEqual(44);
      }
    }

    // The back link still shares this strip and keeps its own target.
    const backLink = page.getByRole("link", { name: "← Conversaciones" });
    await expect(backLink).toBeVisible();
    const backBox = await backLink.boundingBox();
    if (backBox) expect(backBox.height).toBeGreaterThanOrEqual(44);

    // Nothing in the strip may spill off a 390px viewport.
    const width = await clientWidth(page);
    const spill = await page.evaluate((w) => {
      const el = document.querySelector('[data-testid="conv-detail-actions"]')!;
      return Math.round(el.getBoundingClientRect().right) > w + 1;
    }, width);
    expect(spill, "action strip stays inside the viewport").toBe(false);
  });

  test("archive from the conversation actually archives it", async ({ page, request }) => {
    // The bounding-box test above proves the buttons EXIST at a tappable size.
    // It never clicks them: replacing onClick with a no-op left the suite
    // green. Archive is the one capability whose mobile reachability justifies
    // hiding the list's checkbox column, so it needs behavioural coverage.
    const conv = await request.post("/api/conversations", {
      data: { mode: "chat", context_kind: "global", first_user_prompt: "Archivar e2e" },
    });
    const id = ((await conv.json()) as { id: string }).id;

    await gotoConversationAndSettle(page, id);
    await page.getByTestId("conv-detail-archive-btn").click();

    // Archiving removes it from the default list, so returning to a list that
    // no longer contains it is the honest destination.
    await page.waitForURL(/\/conversations(\?|$)/, { timeout: 15_000 });

    const after = await request.get(`/api/conversations/${id}`);
    const body = (await after.json()) as { archived_at: string | null };
    expect(body.archived_at, "archived_at is set server-side, not just in the UI").not.toBeNull();

    // And it round-trips: reopen and unarchive.
    await gotoConversationAndSettle(page, id);
    await page.getByTestId("conv-detail-archive-btn").click();
    await expect
      .poll(async () => {
        const r = await request.get(`/api/conversations/${id}`);
        return ((await r.json()) as { archived_at: string | null }).archived_at;
      }, { timeout: 15_000 })
      .toBeNull();
  });

  test("open-in-context navigates to the context route", async ({ page, request }) => {
    // Pointing router.push at a wrong path also left the suite green.
    const conv = await request.post("/api/conversations", {
      data: { mode: "chat", context_kind: "home", first_user_prompt: "Contexto e2e" },
    });
    const id = ((await conv.json()) as { id: string }).id;

    await gotoConversationAndSettle(page, id);
    const btn = page.getByTestId("conv-detail-context-btn");
    await expect(btn, "non-global conversations can open in context").toBeEnabled();
    await btn.click();
    await page.waitForURL(new RegExp(`/k/${id}`), { timeout: 15_000 });
  });

  test("rename can be cancelled without writing a title", async ({ page, request }) => {
    // Seeding the box with the DISPLAY title meant an untitled conversation
    // got "Sin título" in the input, and the commit guard let it through — so
    // an accidental pencil tap permanently titled it "Sin título". A phone has
    // no Escape key, so cancel has to be a button.
    const conv = await request.post("/api/conversations", {
      data: { mode: "chat", context_kind: "global", first_user_prompt: "Cancelar e2e" },
    });
    const id = ((await conv.json()) as { id: string }).id;

    await gotoConversationAndSettle(page, id);
    await page.getByTestId("conv-detail-rename-btn").click();
    await expect(page.getByTestId("conv-detail-rename-input")).toBeVisible();
    await page.getByTestId("conv-detail-rename-cancel").click();
    await expect(page.getByTestId("conv-detail-rename-input")).toBeHidden();

    const after = await request.get(`/api/conversations/${id}`);
    const body = (await after.json()) as { title: string | null };
    expect(body.title, "cancelling must not write a title").toBeNull();
  });

  test("the rename row fits a 320px viewport", async ({ page, request }) => {
    // The ✓ button sat 18px past a 320px viewport at the old fixed width —
    // and it is the control that commits. The existing overflow assertion only
    // ran at 390px and never entered rename mode.
    await page.setViewportSize({ width: 320, height: 720 });
    const conv = await request.post("/api/conversations", {
      data: { mode: "chat", context_kind: "global", first_user_prompt: "Ancho e2e" },
    });
    const id = ((await conv.json()) as { id: string }).id;

    await gotoConversationAndSettle(page, id);
    await page.getByTestId("conv-detail-rename-btn").click();
    await expect(page.getByTestId("conv-detail-rename-input")).toBeVisible();

    const width = await clientWidth(page);
    const past = await page.evaluate((w) => {
      const save = document.querySelector('[data-testid="conv-detail-rename-save"]')!;
      const cancel = document.querySelector('[data-testid="conv-detail-rename-cancel"]')!;
      return [save, cancel].map((el) => Math.round(el.getBoundingClientRect().right)).filter((r) => r > w + 1);
    }, width);
    expect(past, "no rename control sits past a 320px viewport").toEqual([]);
  });

  test("rename works from inside the conversation", async ({ page }) => {
    await gotoConversationAndSettle(page, convId);

    await page.getByTestId("conv-detail-rename-btn").click();
    const input = page.getByTestId("conv-detail-rename-input");
    await expect(input, "rename input replaces the buttons").toBeVisible();

    const newTitle = `Renombrada e2e ${Date.now()}`;
    await input.fill(newTitle);
    await page.getByTestId("conv-detail-rename-save").click();
    await expect(input, "the strip returns to its button row").toBeHidden();

    // Falsifiable end-to-end: the new title survives a round trip to the
    // API, not just a local state update.
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId(`title-cell-${convId}`)).toHaveText(new RegExp(newTitle.slice(0, 20)));
  });
});

test.describe("desktop width — must not cost density (D-121)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("row height and Acciones column are unchanged at 1440px", async ({ page }) => {
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId("conversations-table")).toBeVisible();
    await page.waitForTimeout(600);

    // The first revision of a tap-target fix like this applies
    // `minWidth`/`minHeight: 44` unconditionally, which would push desktop
    // row height 46 -> 61px (+33%) and force the Acciones <col> 90 ->
    // 116px. Both are phone-only (`.conv-row-action-btn` /
    // `.conv-col-acciones`), so these are the exact pre-PR numbers.
    const desk = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="conversations-table"]')!;
      const row = table.querySelector("tbody tr")!;
      const tds = Array.from(row.querySelectorAll("td"));
      const btns = Array.from(row.querySelectorAll("button.conv-row-action-btn")).map((b) => ({
        w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height),
      }));
      return {
        rowHeight: Math.round(row.getBoundingClientRect().height),
        accionesWidth: Math.round(tds[tds.length - 1].getBoundingClientRect().width),
        btns,
      };
    });

    expect(desk.rowHeight, `desktop row height was ${desk.rowHeight}px — must stay at the pre-fix 46px`).toBe(46);
    expect(
      desk.accionesWidth,
      `desktop Acciones column was ${desk.accionesWidth}px — must stay at the pre-fix 90px`,
    ).toBe(90);
    expect(desk.btns.length, "row-action buttons rendered at desktop").toBeGreaterThan(0);
    for (const b of desk.btns) {
      expect(b.h, `desktop row-action button is ${b.h}px tall — the 44px phone floor must not apply here`).toBeLessThan(44);
    }
  });

  test("checkbox, pencil and Acciones columns all still render at 1440px", async ({ page }) => {
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId("conversations-table")).toBeVisible();
    await page.waitForTimeout(600);

    // The other direction of the phone guard: hiding these below `md` must
    // not leak upward. Without this, dropping `md:table-cell` from the
    // classes would still pass every phone assertion above.
    const desktop = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="conversations-table"] tbody tr')!;
      const cells = Array.from(row.querySelectorAll("td"));
      const pencil = row.querySelector('[data-testid^="rename-btn-"]');
      const text = document.querySelector('[data-testid="conversations-table"] .conv-title-text')!;
      const cs = getComputedStyle(text);
      return {
        checkbox: getComputedStyle(cells[0]).display,
        acciones: getComputedStyle(cells[cells.length - 1]).display,
        pencil: pencil ? getComputedStyle(pencil).display : "not-found",
        titleWhiteSpace: cs.whiteSpace,
        titleFontSize: parseFloat(cs.fontSize),
        metaVisible: !!document.querySelector('[data-testid^="title-meta-"]')
          && getComputedStyle(document.querySelector('[data-testid^="title-meta-"]')!).display !== "none",
      };
    });

    expect(desktop.checkbox, "checkbox column renders at desktop").not.toBe("none");
    expect(desktop.acciones, "Acciones column renders at desktop").not.toBe("none");
    expect(desktop.pencil, "rename pencil renders at desktop").not.toBe("none");

    // Desktop keeps the dense single ellipsised line — the phone's 15px
    // two-line treatment must not bleed up here.
    expect(desktop.titleWhiteSpace, "desktop title stays on one line").toBe("nowrap");
    expect(desktop.titleFontSize, `desktop title is ${desktop.titleFontSize}px — must stay at 12px`).toBe(12);
    expect(desktop.metaVisible, "phone-only meta line is hidden at desktop").toBe(false);
  });

  test("bulk-action bar stays compact at 1440px", async ({ page }) => {
    await page.goto("/conversations", { waitUntil: "networkidle" });
    await expect(page.getByTestId("conversations-table")).toBeVisible();
    await page.getByTestId("select-all-checkbox").click();
    await expect(page.getByTestId("bulk-action-bar")).toBeVisible();
    await page.waitForTimeout(400);

    for (const id of ["bulk-archive-btn", "bulk-cancel-btn"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has a bounding box`).not.toBeNull();
      if (box) {
        expect(
          box.height,
          `${id} is ${box.height}px tall at desktop — the 44px phone floor must not apply here`,
        ).toBeLessThan(44);
      }
    }
  });
});
