/**
 * e2e: fotos de artículo — hover, lightbox y táctil (D-068).
 *
 * Servidor real + Postgres sembrado + un `FOTOS_DIR` sintético (ver
 * e2e/fotos-fixture.ts). No depende ni de la VPN ni del share: los JPEG los
 * genera la fixture.
 *
 * Qué se comprueba, contra la app de verdad:
 *   - el hover muestra un `role="tooltip"` con una <img> que responde 200;
 *   - el click abre el lightbox y navega entre las fotos del artículo;
 *   - en móvil el toque abre el lightbox directamente;
 *   - los artículos sin foto no llevan indicador, y una tabla entera sin
 *     fotos no dispara ni una petición de imagen;
 *   - por defecto no se ve ninguna foto: solo el indicador;
 *   - no aparece ninguna superficie de error (D-041).
 *
 * Requiere que el servidor haya arrancado con el `FOTOS_DIR` de la fixture, que
 * es lo que hace `playwright.config.ts`. Un servidor reutilizado que arrancó
 * sin él hará fallar el primer test con un mensaje que lo dice.
 *
 * See: docs/skills/e2e-testing.md, D-041, D-068.
 */

import { test, expect, devices, type Page, type Request } from "@playwright/test";
import { execSync } from "child_process";
import * as path from "path";
import { FOTOS_SEMBRADAS, SIN_FOTO, sembrarFotos } from "./fotos-fixture";

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

const enLista = (codigos: string[]) => codigos.map((c) => `'${c}'`).join(", ");
const CON_Y_SIN = [...Object.keys(FOTOS_SEMBRADAS), SIN_FOTO[0]];

const SELECT_ARTICULOS = (codigos: string[]) =>
  `SELECT codigo, ccrefejofacm AS "Referencia", descripcion AS "Descripción", precio1 AS "PVP" ` +
  `FROM ps_articulos WHERE codigo IN (${enLista(codigos)}) ORDER BY codigo`;

/** Un panel con tres tablas: hover, sin fotos, y fotos pedidas explícitamente. */
const SPEC = {
  title: "e2e · Fotos de artículo",
  widgets: [
    {
      id: "con-hover",
      type: "table",
      title: "Artículos con hover",
      sql: SELECT_ARTICULOS(CON_Y_SIN),
      articulo_codigo_col: "codigo",
    },
    {
      id: "sin-fotos",
      type: "table",
      title: "Artículos sin foto",
      sql: SELECT_ARTICULOS(SIN_FOTO),
      articulo_codigo_col: "codigo",
    },
    {
      id: "fotos-pedidas",
      type: "table",
      title: "Artículos con fotos a la vista",
      sql: SELECT_ARTICULOS(CON_Y_SIN),
      articulo_codigo_col: "codigo",
      mostrar_fotos: true,
    },
  ],
};

let dashboardId = 0;
let refConFotos = "";

test.beforeAll(async ({ request }) => {
  execSync(`${path.resolve(__dirname, "fixtures/init-test-db.sh")} "${buildE2eDsn()}"`, {
    stdio: "inherit",
  });
  sembrarFotos();

  // El panel se crea por la API de la app: de paso valida que el esquema
  // (`.strict()`) acepta los campos nuevos del widget table.
  const res = await request.post("/api/dashboards", {
    data: { name: `e2e fotos ${Date.now()}`, description: "D-068", spec: SPEC },
  });
  expect(res.status(), await res.text()).toBe(201);
  dashboardId = (await res.json()).id;
  expect(dashboardId).toBeGreaterThan(0);

  // El servidor tiene que estar mirando el FOTOS_DIR de la fixture.
  const lote = await request.post("/api/articulos/fotos", {
    data: { codigos: [...Object.keys(FOTOS_SEMBRADAS), ...SIN_FOTO] },
  });
  expect(lote.status()).toBe(200);
  const { porCodigo } = await lote.json();
  expect(
    porCodigo,
    "El servidor no ve las fotos sembradas: arrancó sin el FOTOS_DIR de e2e/fotos-fixture.ts " +
      "(¿un `npm run dev` reutilizado?). Páralo y deja que Playwright lo arranque.",
  ).toMatchObject({ ...FOTOS_SEMBRADAS, [SIN_FOTO[0]]: [] });

  const refs = await request.post("/api/query", {
    data: { sql: "SELECT ccrefejofacm FROM ps_articulos WHERE codigo = 'ART00001'" },
  });
  refConFotos = (await refs.json()).rows[0][0];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Peticiones de bytes de foto que hace la página. */
function vigilarFotos(page: Page): Request[] {
  const peticiones: Request[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/fotos/")) peticiones.push(r);
  });
  return peticiones;
}

async function abrirPanel(page: Page): Promise<void> {
  const lote = page.waitForResponse(
    (r) => r.url().endsWith("/api/articulos/fotos") && r.request().method() === "POST",
  );
  await page.goto(`/dashboard/${dashboardId}`);
  await expect(page.getByText("Artículos con hover")).toBeVisible({ timeout: 30_000 });
  await lote;
  await expect(page.locator('[data-testid="widget-skeleton"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(tabla(page, "Artículos con hover").getByTestId("article-photo-trigger").first()).toBeVisible();
}

/** El widget de tabla cuyo título es `titulo`: el contenedor más cercano al
 *  encabezado que contiene una <table>. */
function tabla(page: Page, titulo: string) {
  return page
    .getByRole("heading", { name: titulo, exact: true })
    .locator("xpath=ancestor::div[.//table][1]");
}

function fila(page: Page, titulo: string, codigo: string) {
  return tabla(page, titulo).locator("tbody tr", { hasText: codigo });
}

async function sinSuperficieDeError(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="error-display"]')).toHaveCount(0);
  for (const texto of ["Detalles técnicos", "there is no parameter", "HTTP 500", "Error al cargar"]) {
    await expect(page.getByText(texto)).toHaveCount(0);
  }
}

// ---------------------------------------------------------------------------
// Escritorio
// ---------------------------------------------------------------------------

test.describe("fotos de artículo — escritorio", () => {
  test("por defecto solo hay indicador: ninguna foto a la vista y ninguna descarga", async ({ page }) => {
    const peticiones = vigilarFotos(page);
    await abrirPanel(page);

    const hover = tabla(page, "Artículos con hover");
    // Datos reales en la tabla, no un estado vacío.
    await expect(hover.locator("tbody tr")).toHaveCount(CON_Y_SIN.length);
    await expect(hover.getByText("Sin datos")).toHaveCount(0);
    await expect(hover.locator("img")).toHaveCount(0);
    await expect(hover.getByRole("columnheader", { name: "Foto" })).toHaveCount(0);

    // Con foto: código, referencia y descripción llevan indicador.
    await expect(fila(page, "Artículos con hover", "ART00001").getByTestId("article-photo-glyph")).toHaveCount(3);
    await expect(fila(page, "Artículos con hover", "ART00002").getByTestId("article-photo-glyph")).toHaveCount(3);
    // Sin foto: ninguno.
    await expect(fila(page, "Artículos con hover", SIN_FOTO[0]).getByTestId("article-photo-glyph")).toHaveCount(0);

    // Las únicas imágenes pedidas son las de la tabla que las pidió explícitamente.
    const deHover = peticiones.filter((r) => !r.url().includes("w=160"));
    expect(deHover.map((r) => r.url())).toEqual([]);

    await sinSuperficieDeError(page);
  });

  test("el hover muestra un tooltip con la foto, servida con 200 como WebP", async ({ page }) => {
    await abrirPanel(page);

    const respuesta = page.waitForResponse((r) => r.url().includes("/api/fotos/ART00001/1?w=256"));
    await fila(page, "Artículos con hover", "ART00001").getByText(refConFotos).hover();

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const res = await respuesta;
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/webp");

    const img = tooltip.locator("img");
    await expect(img).toHaveAttribute("src", "/api/fotos/ART00001/1?w=256");
    // La imagen se decodificó de verdad, no es un icono roto.
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await expect(tooltip.getByTestId("article-photo-count")).toHaveText("1/3");

    // Al apartar el ratón desaparece.
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await sinSuperficieDeError(page);
  });

  test("el tooltip no queda recortado por el contenedor de la tabla", async ({ page }) => {
    await abrirPanel(page);
    await fila(page, "Artículos con hover", "ART00001").getByText(refConFotos).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();

    const caja = (await tooltip.boundingBox())!;
    const vista = page.viewportSize()!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(vista.width);
    expect(caja.y + caja.height).toBeLessThanOrEqual(vista.height);
    // Y cuelga de <body>, no de la celda: ningún `overflow` de la tabla puede
    // recortarlo. (No se comprueba con elementsFromPoint: lleva
    // `pointer-events: none` para no robarle el ratón a la celda.)
    expect(await tooltip.evaluate((el) => el.parentElement === document.body)).toBe(true);
    expect(await tooltip.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  });

  test("el click abre el lightbox y navega entre las fotos del artículo", async ({ page }) => {
    await abrirPanel(page);
    const urlAntes = page.url();

    const grande = page.waitForResponse((r) => r.url().includes("/api/fotos/ART00001/1?w=1024"));
    await fila(page, "Artículos con hover", "ART00001").getByText(refConFotos).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect((await grande).status()).toBe(200);
    await expect(dialog).toContainText(refConFotos);
    await expect(dialog).toContainText("Artículo 00001");
    const contador = page.getByTestId("photo-lightbox-counter");
    await expect(contador).toHaveText("1/3");
    await expect
      .poll(() => dialog.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    await dialog.getByRole("button", { name: "Foto siguiente" }).click();
    await expect(contador).toHaveText("2/3");
    await expect(dialog.locator("img")).toHaveAttribute("src", "/api/fotos/ART00001/2?w=1024");

    await page.keyboard.press("ArrowRight");
    await expect(contador).toHaveText("3/3");
    await page.keyboard.press("ArrowRight");
    await expect(contador).toHaveText("1/3");
    await page.keyboard.press("ArrowLeft");
    await expect(contador).toHaveText("3/3");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Abrir la foto no es explorar la fila: el drill-down no se ha disparado.
    expect(page.url()).toBe(urlAntes);
    await sinSuperficieDeError(page);
  });

  test("con una sola foto no hay navegación; el click fuera cierra", async ({ page }) => {
    await abrirPanel(page);
    await fila(page, "Artículos con hover", "ART00002").getByText("ART00002").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Foto siguiente" })).toHaveCount(0);
    await expect(page.getByTestId("photo-lightbox-counter")).toHaveText("");

    await page.getByTestId("photo-lightbox-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });

  test("teclado: el indicador es enfocable y Enter abre el lightbox", async ({ page }) => {
    await abrirPanel(page);
    const trigger = fila(page, "Artículos con hover", "ART00001").getByTestId("article-photo-trigger").first();
    await trigger.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    // El foco entra en el diálogo y vuelve al indicador al cerrar.
    await expect(page.getByRole("button", { name: "Cerrar foto" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("una tabla sin fotos no muestra indicadores ni pide una sola imagen", async ({ page }) => {
    const peticiones = vigilarFotos(page);
    await abrirPanel(page);

    const sin = tabla(page, "Artículos sin foto");
    await expect(sin.locator("tbody tr")).toHaveCount(SIN_FOTO.length);
    await expect(sin.getByTestId("article-photo-trigger")).toHaveCount(0);
    await expect(sin.getByTestId("article-photo-glyph")).toHaveCount(0);
    await expect(sin.locator("img")).toHaveCount(0);

    // Pasar el ratón por sus celdas tampoco dispara nada.
    for (const codigo of SIN_FOTO) {
      await fila(page, "Artículos sin foto", codigo).getByText(codigo).hover();
    }
    await page.waitForTimeout(600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    for (const codigo of SIN_FOTO) {
      expect(peticiones.filter((r) => r.url().includes(`/api/fotos/${codigo}/`))).toEqual([]);
    }
    await sinSuperficieDeError(page);
  });

  test("mostrar_fotos: la columna de miniaturas aparece solo donde se pidió", async ({ page }) => {
    await abrirPanel(page);

    const pedidas = tabla(page, "Artículos con fotos a la vista");
    await expect(pedidas.getByRole("columnheader", { name: "Foto" })).toHaveCount(1);
    const mini = fila(page, "Artículos con fotos a la vista", "ART00001").locator("td img");
    await expect(mini).toHaveAttribute("src", "/api/fotos/ART00001/1?w=160");
    await expect.poll(() => mini.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    // El artículo sin foto deja la celda vacía.
    await expect(fila(page, "Artículos con fotos a la vista", SIN_FOTO[0]).locator("td img")).toHaveCount(0);

    await mini.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("photo-lightbox-counter")).toHaveText("1/3");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // En las otras dos tablas no hay columna.
    await expect(tabla(page, "Artículos con hover").getByRole("columnheader", { name: "Foto" })).toHaveCount(0);
    await sinSuperficieDeError(page);
  });
});

// ---------------------------------------------------------------------------
// Endpoint de bytes, contra el servidor real
// ---------------------------------------------------------------------------

test.describe("endpoint de fotos", () => {
  test("valida código, slot y ancho, y no sale del espejo", async ({ request }) => {
    const estado = async (ruta: string) => (await request.get(`/api/fotos/${ruta}`)).status();

    expect(await estado("ART00001/1")).toBe(200);
    expect(await estado("ART00001/1?w=512")).toBe(200);
    expect(await estado("ART00001/4")).toBe(404);
    expect(await estado(`${SIN_FOTO[0]}/1`)).toBe(404);
    expect(await estado("ART00001/1?w=999")).toBe(400);
    expect(await estado("ART00001/5")).toBe(400);
    expect(await estado("..%2F..%2F..%2Fetc%2Fpasswd/1")).toBe(400);
    expect(await estado("%2E%2E%2F1%2FART00001/1")).toBe(400);

    const original = await request.get("/api/fotos/ART00001/1");
    expect(original.headers()["content-type"]).toBe("image/jpeg");
    const etag = original.headers()["etag"];
    expect(etag).toBeTruthy();
    const cond = await request.get("/api/fotos/ART00001/1", { headers: { "If-None-Match": etag } });
    expect(cond.status()).toBe(304);
  });
});

// ---------------------------------------------------------------------------
// Móvil
// ---------------------------------------------------------------------------

test.describe("fotos de artículo — móvil (iPhone 13)", () => {
  const { defaultBrowserType: _defaultBrowserType, ...iPhone13 } = devices["iPhone 13"];
  test.use({ ...iPhone13 });

  test("no hay hover: el toque abre el lightbox directamente", async ({ page }) => {
    await abrirPanel(page);

    // El glifo se mantiene: indica que la celda es pulsable.
    const trigger = fila(page, "Artículos con hover", "ART00001").getByTestId("article-photo-trigger").first();
    await expect(trigger.getByTestId("article-photo-glyph")).toBeVisible();

    await trigger.tap();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.getByTestId("photo-lightbox-counter")).toHaveText("1/3");
    await expect
      .poll(() => dialog.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    // El lightbox cabe en la pantalla.
    const caja = (await page.getByTestId("photo-lightbox").boundingBox())!;
    const vista = page.viewportSize()!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(vista.width);

    await dialog.getByRole("button", { name: "Foto siguiente" }).tap();
    await expect(page.getByTestId("photo-lightbox-counter")).toHaveText("2/3");
    await dialog.getByRole("button", { name: "Cerrar foto" }).tap();
    await expect(dialog).toHaveCount(0);
    await sinSuperficieDeError(page);
  });
});
