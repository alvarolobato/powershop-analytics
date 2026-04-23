/**
 * Ensure explanatory dashboards exist for weekly review deep links.
 */

import { getPool } from "./db-write";
import { DashboardSpecSchema } from "./schema";
import { REVIEW_QUERIES } from "./review-queries";
import type { ReviewDashboardKey } from "./review-schema";
import { reviewDashboardDisplayName } from "./review-dashboard-links";

function pickSql(key: ReviewDashboardKey): { title: string; sql: string; format: "currency" | "number" } {
  const pick = (name: string) => {
    const q = REVIEW_QUERIES.find((r) => r.name === name);
    if (!q) throw new Error(`Missing review query ${name}`);
    return q.sql;
  };
  switch (key) {
    case "ventas_retail":
      return { title: "Ventas netas (semana cerrada)", sql: pick("ventas_semana_cerrada"), format: "currency" };
    case "canal_mayorista":
      return {
        title: "Facturación mayorista (semana cerrada)",
        sql: pick("facturacion_mayorista_semana_cerrada"),
        format: "currency",
      };
    case "stock":
      return {
        title: "Traspasos (semana cerrada)",
        sql: pick("traspasos_semana_cerrada"),
        format: "number",
      };
    case "compras":
      return {
        title: "Pedidos de compra (semana cerrada)",
        sql: pick("compras_semana_cerrada"),
        format: "number",
      };
    default:
      throw new Error("unknown dashboard key");
  }
}

function buildSpec(key: ReviewDashboardKey) {
  const { title, sql: widgetSql, format } = pickSql(key);
  const raw = {
    title: reviewDashboardDisplayName(key),
    description: "Dashboard de apoyo para la revisión semanal (enlace desde la revisión).",
    default_time_range: { preset: "last_7_days" as const },
    widgets: [
      {
        id: "review_metric",
        type: "number" as const,
        title,
        sql: widgetSql,
        format,
      },
    ],
  };
  return DashboardSpecSchema.parse(raw);
}

export async function getOrCreateReviewDashboardId(key: ReviewDashboardKey): Promise<number> {
  const name = reviewDashboardDisplayName(key);
  const spec = buildSpec(key);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [name]);
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM dashboards WHERE name = $1 LIMIT 1`,
      [name],
    );
    if (existing.rows[0]?.id != null) {
      await client.query("COMMIT");
      return existing.rows[0].id;
    }
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO dashboards (name, description, spec) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [name, spec.description ?? null, JSON.stringify(spec)],
    );
    const id = inserted.rows[0]?.id;
    if (id == null) throw new Error("INSERT dashboards did not return id");
    await client.query("COMMIT");
    return id;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}
