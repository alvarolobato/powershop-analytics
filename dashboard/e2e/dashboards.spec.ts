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
import { readFileSync } from "fs";

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

test.beforeAll(async () => {
  // 1. Load the synthetic seed (ps_* mirror tables)
  const initScript = path.resolve(__dirname, "fixtures/init-test-db.sh");
  const dsn = buildE2eDsn();
  execSync(`${initScript} "${dsn}"`, { stdio: "inherit" });

  // 2. Seed the dashboard rows using the app's seeder script
  const seedScript = path.resolve(__dirname, "seed-dashboards.ts");
  // npx tsx resolves from the dashboard/ package root where tsx is installed
  const dashboardRoot = path.resolve(__dirname, "..");
  const seederOut = execSync(`npx tsx ${seedScript}`, {
    cwd: dashboardRoot,
    env: { ...process.env, POSTGRES_DSN: dsn },
  }).toString();

  // 3. Extract only the IDs seeded by seed-dashboards.ts (lines like "→ id N")
  dashboardIds = [...seederOut.matchAll(/→ id (\d+)/g)].map((m) =>
    Number(m[1]),
  );
  expect(dashboardIds.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all seeded dashboards render without widget error states", async ({
  page,
}) => {
  expect(dashboardIds.length).toBeGreaterThan(0);

  for (const id of dashboardIds) {
    await page.goto(`/dashboard/${id}`);

    // Wait for the page to load past the initial loading state
    // (either DashboardRenderer renders widgets, or an error surface appears)
    await page.waitForFunction(
      () => {
        const skeletons = document.querySelectorAll(
          '[data-testid="widget-skeleton"]',
        );
        const errors = document.querySelectorAll(
          '[data-testid="error-display"]',
        );
        // Page is resolved when skeletons are gone OR errors appeared
        return skeletons.length === 0 || errors.length > 0;
      },
      { timeout: 30_000 },
    );

    // No error surfaces
    await expect(page.locator('[data-testid="error-display"]'), {
      message: `Dashboard id=${id}: ErrorDisplay visible — widget SQL failed`,
    }).toHaveCount(0);
    await expect(page.getByText("Detalles técnicos"), {
      message: `Dashboard id=${id}: "Detalles técnicos" visible`,
    }).toHaveCount(0);
    await expect(page.getByText("there is no parameter"), {
      message: `Dashboard id=${id}: positional param error visible`,
    }).toHaveCount(0);
    await expect(page.getByText("HTTP 500"), {
      message: `Dashboard id=${id}: HTTP 500 visible`,
    }).toHaveCount(0);
    await expect(page.getByText("Error al cargar"), {
      message: `Dashboard id=${id}: "Error al cargar" visible`,
    }).toHaveCount(0);

    // No lingering skeletons — all widgets resolved
    await expect(page.locator('[data-testid="widget-skeleton"]'), {
      message: `Dashboard id=${id}: skeletons still present after load`,
    }).toHaveCount(0);

    // Widgets must show real data — empty-state means the seeded data wasn't reached
    await expect(page.getByText("Sin datos"), {
      message: `Dashboard id=${id}: "Sin datos" empty-state visible — seeded data not loaded`,
    }).toHaveCount(0);
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

// ---------------------------------------------------------------------------
// Tráfico intragrupo (issue #922)
// ---------------------------------------------------------------------------

/**
 * El movimiento entre sociedades del propio grupo (CIF 502108150) no es venta.
 *
 * Este test es DISCRIMINANTE a propósito: el fixture siembra 12 facturas y 5
 * albaranes intragrupo, y además filas huérfanas cuyo `num_cliente` no existe
 * en `ps_clientes`. Así cada variante da un número distinto y el test no puede
 * pasar por accidente:
 *
 *   | variante                   | facturas | albaranes |
 *   |----------------------------|----------|-----------|
 *   | sin excluir nada           | 120      | 50        |
 *   | INNER JOIN + nif <> CIF    | 105      | 44        |  ← pierde huérfanos
 *   | NOT EXISTS (la correcta)   | 108      | 45        |
 *
 * Es el mismo reparto que producción, donde el INNER JOIN se llevaba por
 * delante 3 albaranes reales de 2026 (70 de 52.148 en todo el histórico).
 */
test("el tráfico intragrupo se excluye sin perder las filas huérfanas", async () => {
  const { Client } = await import("pg");
  const cli = new Client({ connectionString: buildE2eDsn() });
  await cli.connect();
  try {
    const cuenta = async (tabla: string, filtro: string) =>
      Number(
        (
          await cli.query(
            `SELECT COUNT(*)::int AS n FROM ${tabla} t WHERE ${filtro}`,
          )
        ).rows[0].n,
      );

    const NOT_EXISTS = `NOT EXISTS (SELECT 1 FROM ps_clientes ci
        WHERE ci.reg_cliente = t.num_cliente AND COALESCE(ci.nif, '') = '502108150')`;
    const CON_JOIN = `EXISTS (SELECT 1 FROM ps_clientes c
        WHERE c.reg_cliente = t.num_cliente AND COALESCE(c.nif, '') <> '502108150')`;

    for (const [tabla, sinNada, conJoin, correcto] of [
      ["ps_gc_facturas", 120, 105, 108],
      ["ps_gc_albaranes", 50, 44, 45],
    ] as const) {
      expect(await cuenta(tabla, "TRUE"), `${tabla}: total sembrado`).toBe(
        sinNada,
      );
      expect(
        await cuenta(tabla, CON_JOIN),
        `${tabla}: el JOIN pierde huérfanos`,
      ).toBe(conJoin);
      expect(await cuenta(tabla, NOT_EXISTS), `${tabla}: NOT EXISTS`).toBe(
        correcto,
      );
    }
  } finally {
    await cli.end();
  }
});

/**
 * Los abonos mayoristas se guardan en POSITIVO (issue #920), así que
 * `WHERE abono IS NOT TRUE` no resta la devolución: la ignora. Medido en
 * producción, eso inflaba la facturación mayorista un 13 % (3.677.893 € frente
 * a 3.199.868 € reales en 2026).
 *
 * El fixture siembra 44 abonos y 64 facturas normales (tras excluir el
 * intragrupo), así que excluir y netear dan cifras claramente distintas y el
 * test no puede pasar por accidente.
 */
test("los abonos mayoristas se restan, no se excluyen", async () => {
  const { Client } = await import("pg");
  const cli = new Client({ connectionString: buildE2eDsn() });
  await cli.connect();
  try {
    const SIN_INTRA = `NOT EXISTS (SELECT 1 FROM ps_clientes ci
      WHERE ci.reg_cliente = f.num_cliente AND COALESCE(ci.nif, '') = '502108150')`;
    const BASE =
      "(COALESCE(f.base1,0) + COALESCE(f.base2,0) + COALESCE(f.base3,0))";

    const { rows } = await cli.query(`
      SELECT
        COUNT(*) FILTER (WHERE f.abono IS NOT TRUE)::int             AS n_facturas,
        COUNT(*) FILTER (WHERE f.abono IS TRUE)::int                 AS n_abonos,
        COALESCE(SUM(${BASE}) FILTER (WHERE f.abono IS NOT TRUE), 0) AS excluyendo,
        COALESCE(SUM(${BASE}) FILTER (WHERE f.abono IS NOT TRUE), 0)
          - COALESCE(SUM(${BASE}) FILTER (WHERE f.abono IS TRUE), 0) AS neto
      FROM ps_gc_facturas f WHERE ${SIN_INTRA}`);
    const r = rows[0];

    // El fixture tiene abonos de sobra para discriminar.
    expect(r.n_facturas, "facturas normales sembradas").toBe(64);
    expect(r.n_abonos, "abonos sembrados").toBe(44);

    // Y las dos cifras difieren: si alguien vuelve a excluir en vez de restar,
    // el neto se igualaría al bruto y esto falla.
    expect(Number(r.neto)).toBeLessThan(Number(r.excluyendo));

    // El COALESCE del lado del abono es obligatorio: sin él, un periodo sin
    // devoluciones da `algo - NULL` = NULL. Se comprueba en un rango vacío.
    const vacio = await cli.query(`
      SELECT COALESCE(SUM(${BASE}) FILTER (WHERE f.abono IS NOT TRUE), 0)
           - COALESCE(SUM(${BASE}) FILTER (WHERE f.abono IS TRUE), 0) AS neto
      FROM ps_gc_facturas f
      WHERE ${SIN_INTRA} AND f.fecha_factura < DATE '1990-01-01'`);
    expect(
      vacio.rows[0].neto,
      "un rango sin filas debe dar 0, nunca NULL",
    ).not.toBeNull();
    expect(Number(vacio.rows[0].neto)).toBe(0);
  } finally {
    await cli.end();
  }
});

// ---------------------------------------------------------------------------
// Exportar a CSV (D-041: toda superficie visible nueva lleva su e2e)
// ---------------------------------------------------------------------------

test("las tablas ofrecen exportar a CSV y el fichero sale bien formado", async ({
  page,
}) => {
  expect(dashboardIds.length).toBeGreaterThan(0);

  // Se recoge lo que se ve en cada panel para que, si no hay donde probar, el
  // fallo diga POR QUE en vez de dejar adivinando: cuantas tablas hay, cuantas
  // tienen filas, y cuantos botones aparecen.
  const diagnostico: string[] = [];
  let probado = false;

  for (const id of dashboardIds) {
    await page.goto(`/dashboard/${id}`);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="widget-skeleton"]').length === 0 ||
        document.querySelectorAll('[data-testid="error-display"]').length > 0,
      { timeout: 30_000 },
    );

    const tablas = await page.locator("table").count();
    const filas = await page.locator("table tbody tr").count();
    const botones = page.locator('[data-testid="export-csv"]');
    const nBotones = await botones.count();
    diagnostico.push(`panel ${id}: ${tablas} tabla(s), ${filas} fila(s), ${nBotones} boton(es)`);

    if (nBotones === 0) continue;

    const primero = botones.first();
    await expect(primero).toBeVisible();
    // Discreto: presente pero atenuado hasta que el raton pasa por encima.
    expect(Number(await primero.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);

    const descarga = page.waitForEvent("download", { timeout: 15_000 });
    await primero.click();
    const fichero = await descarga;

    expect(fichero.suggestedFilename()).toMatch(/\.csv$/);

    const ruta = await fichero.path();
    expect(ruta).not.toBeNull();
    const contenido = readFileSync(ruta as string, "utf8");

    // BOM: sin el, Excel rompe los acentos.
    expect(contenido.charCodeAt(0)).toBe(0xfeff);
    // Separador `;`: con coma, Excel-es lo mete todo en una columna.
    expect(contenido.split("\r\n")[0]).toContain(";");
    // Y hay al menos una fila de datos ademas de la cabecera.
    expect(contenido.split("\r\n").length).toBeGreaterThan(1);

    probado = true;
    break;
  }

  expect(
    probado,
    "no se pudo probar la exportacion en ningun panel sembrado.\n" +
      diagnostico.join("\n"),
  ).toBe(true);
});
