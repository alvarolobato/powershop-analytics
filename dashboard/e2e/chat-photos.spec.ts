/**
 * e2e: fotos de artículo en el CHAT (D-068, #986).
 *
 * El chat no pinta widgets: pinta markdown. Así que no hay spec ni nombres de
 * columna de los que fiarse y la detección va al revés — se recogen los
 * candidatos del texto, se le pregunta a la base de datos cuáles son artículos
 * con foto, y solo esos se decoran.
 *
 * Lo que se comprueba contra la app de verdad:
 *   - un identificador de artículo con foto, escrito en prosa, queda decorado
 *     y al pasar el ratón enseña una <img> que responde 200;
 *   - el click abre el lightbox;
 *   - un artículo SIN foto no lleva indicador, y un texto sin artículos no
 *     dispara ni una petición de imagen;
 *   - no aparece ninguna superficie de error (D-041).
 *
 * El proveedor `e2e-stub` responde haciendo eco del mensaje del usuario, así
 * que mandar «ART00001» basta para que la respuesta del asistente lo lleve.
 * Ni LLM real ni VPN ni share: las fotos las genera `e2e/fotos-fixture.ts`.
 *
 * See: docs/skills/e2e-testing.md, D-041, D-068.
 */

import { test, expect, type Page, type Request } from "@playwright/test";
import { FOTOS_SEMBRADAS, SIN_FOTO, sembrarFotos } from "./fotos-fixture";

const BASE = `http://localhost:${process.env.DASHBOARD_PORT ?? "4000"}`;
const CON_FOTO = Object.keys(FOTOS_SEMBRADAS)[0]; // ART00001, 3 slots
const SIN = SIN_FOTO[0]; // ART00003, ninguna

/** Crea una conversación con su primer mensaje y la abre. */
async function conversacionCon(page: Page, texto: string): Promise<void> {
  const res = await page.request.post(`${BASE}/api/conversations`, {
    data: { mode: "chat", first_user_prompt: texto },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  await page.goto(`${BASE}/conversations/${id}`);
  // El stub contesta al instante haciendo eco.
  await page.waitForSelector('[data-testid="assistant-bubble"]', { timeout: 30_000 });
}

function sinSuperficieDeError(page: Page) {
  return expect(page.locator('[data-testid="route-error"], [data-testid="error-display"]')).toHaveCount(
    0,
  );
}

test.beforeAll(() => {
  sembrarFotos();
});

test("un artículo con foto citado en el chat queda decorado y la enseña", async ({ page }) => {
  await conversacionCon(page, `El más vendido es ${CON_FOTO} este mes.`);

  const burbuja = page.locator('[data-testid="assistant-bubble"]').last();
  const trigger = burbuja.locator('[data-testid="article-photo-trigger"]').first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await expect(trigger).toContainText(CON_FOTO);

  // Por defecto no se ve ninguna foto: solo el indicador.
  await expect(burbuja.locator("img")).toHaveCount(0);

  await trigger.hover();
  const tooltip = page.locator('[data-testid="article-photo-tooltip"]');
  await expect(tooltip).toBeVisible({ timeout: 15_000 });

  const img = tooltip.locator("img");
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  expect(src).toContain(`/api/fotos/${CON_FOTO}/`);
  const resp = await page.request.get(`${BASE}${src}`);
  expect(resp.status()).toBe(200);

  await sinSuperficieDeError(page);
});

test("al hacer click se amplía", async ({ page }) => {
  await conversacionCon(page, `Dame la ficha de ${CON_FOTO}.`);

  const trigger = page
    .locator('[data-testid="assistant-bubble"]')
    .last()
    .locator('[data-testid="article-photo-trigger"]')
    .first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  const lightbox = page.locator('[data-testid="photo-lightbox"]');
  await expect(lightbox).toBeVisible();
  // ART00001 tiene 3 fotos sembradas.
  await expect(page.locator('[data-testid="photo-lightbox-counter"]')).toContainText(
    `1/${FOTOS_SEMBRADAS[CON_FOTO].length}`,
  );

  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await sinSuperficieDeError(page);
});

test("un artículo sin foto no lleva indicador", async ({ page }) => {
  await conversacionCon(page, `Qué sabes de ${SIN}.`);

  const burbuja = page.locator('[data-testid="assistant-bubble"]').last();
  await expect(burbuja).toContainText(SIN);
  await expect(burbuja.locator('[data-testid="article-photo-trigger"]')).toHaveCount(0);
  await sinSuperficieDeError(page);
});

test("un texto sin artículos no pide ninguna imagen", async ({ page }) => {
  const peticiones: string[] = [];
  page.on("request", (r: Request) => {
    if (r.url().includes("/api/fotos/")) peticiones.push(r.url());
  });

  await conversacionCon(page, "Las ventas suben respecto al mes pasado.");
  await page.waitForTimeout(1500);

  expect(peticiones).toEqual([]);
  await sinSuperficieDeError(page);
});
