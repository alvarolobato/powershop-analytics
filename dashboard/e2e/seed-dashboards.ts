/**
 * Dashboard seeder for e2e tests.
 *
 * Creates the saved dashboards (review dashboards + a standard template
 * dashboard) so that `dashboards.spec.ts` can navigate to them and assert
 * they render without errors. Uses the same seeder functions the app uses —
 * no spec JSON pasted here.
 *
 * Usage (from repo root, with the dashboard package installed):
 *   cd dashboard && npx tsx e2e/seed-dashboards.ts
 *
 * Environment: reads POSTGRES_DSN or POSTGRES_HOST/PORT/USER/PASSWORD/DB,
 * same as the app itself.
 */

import { getOrCreateReviewDashboardId } from "../lib/review-dashboard-seed";
import { REVIEW_DASHBOARD_KEYS } from "../lib/review-schema";
import { sql } from "../lib/db-write";
import { TEMPLATES } from "../lib/templates";

async function main() {
  // 1. Seed review dashboards (ventas_retail, canal_mayorista, stock, compras)
  for (const key of REVIEW_DASHBOARD_KEYS) {
    const id = await getOrCreateReviewDashboardId(key);
    console.log(`review dashboard [${key}] → id ${id}`);
  }

  // 2. Seed the standard template dashboards that dashboards.spec.ts drives.
  //
  //    "stock" no estaba, y por eso un cambio que dejaba el widget
  //    `stock-traspasos-recientes` devolviendo CERO filas pasó el e2e entero:
  //    el spec afirma que no aparezca "Sin datos", pero nunca cargaba el panel
  //    que contiene ese widget. Añadirlo es lo que exige D-041 para un PR que
  //    toca el SQL de un widget existente.
  for (const slug of ["ventas", "stock"]) {
    const tmpl = TEMPLATES.find((t) => t.slug === slug);
    if (!tmpl) throw new Error(`Template '${slug}' not found`);

    const existing = await sql<{ id: number }>(
      `SELECT id FROM dashboards WHERE name = $1 LIMIT 1`,
      [tmpl.name],
    );
    if (existing.length > 0) {
      await sql(
        `UPDATE dashboards SET description = $1, spec = $2::jsonb WHERE id = $3`,
        [tmpl.description, JSON.stringify(tmpl.spec), existing[0].id],
      );
      console.log(`template dashboard [${tmpl.slug}] → id ${existing[0].id} (updated)`);
    } else {
      const created = await sql<{ id: number }>(
        `INSERT INTO dashboards (name, description, spec) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [tmpl.name, tmpl.description, JSON.stringify(tmpl.spec)],
      );
      console.log(`template dashboard [${tmpl.slug}] → id ${created[0].id} (created)`);
    }
  }

  console.log("✓ e2e dashboard seed complete");
  process.exit(0);
}

main().catch((err) => {
  console.error("seed-dashboards failed:", err);
  process.exit(1);
});
