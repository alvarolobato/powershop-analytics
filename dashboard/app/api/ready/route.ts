/**
 * GET /api/ready — Readiness: PostgreSQL connectivity + ETL data freshness summary.
 *
 * Intended for orchestrators (Docker health with start_period, k8s readiness).
 * Returns 503 when Postgres is unreachable. When connected, returns 200 with
 * freshness derived from `etl_watermarks` (same staleness window as /api/data-health).
 */

import { NextResponse } from "next/server";
import { query, ConnectionError } from "@/lib/db";

const STALE_THRESHOLD_HOURS = 36;

export async function GET(): Promise<NextResponse> {
  try {
    await query("SELECT 1");

    const wm = await query(
      "SELECT table_name, last_sync_at FROM etl_watermarks ORDER BY last_sync_at ASC",
    );

    if (wm.rows.length === 0) {
      return NextResponse.json({
        status: "ready",
        postgres: "ok",
        watermarks: 0,
        overall_stale: false,
        stalest_table: null as string | null,
      });
    }

    const now = new Date();
    const thresholdMs = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
    let overallStale = false;
    let stalest: { name: string; last_sync: string } | null = null;

    for (const row of wm.rows) {
      const name = String(row[0]);
      const lastSyncRaw = row[1];
      const lastSync =
        lastSyncRaw instanceof Date
          ? lastSyncRaw.toISOString()
          : String(lastSyncRaw);
      const lastSyncDate = new Date(lastSync);
      const isStale = now.getTime() - lastSyncDate.getTime() > thresholdMs;
      if (isStale) overallStale = true;
      if (!stalest) stalest = { name, last_sync: lastSync };
    }

    return NextResponse.json({
      status: "ready",
      postgres: "ok",
      watermarks: wm.rows.length,
      overall_stale: overallStale,
      stalest_table: stalest?.name ?? null,
    });
  } catch (err) {
    if (err instanceof ConnectionError) {
      return NextResponse.json(
        { status: "not_ready", postgres: "error", detail: String(err.message) },
        { status: 503 },
      );
    }
    const pgErr = err as { code?: string };
    if (pgErr.code === "42P01") {
      return NextResponse.json({
        status: "ready",
        postgres: "ok",
        watermarks: 0,
        overall_stale: false,
        stalest_table: null,
        note: "etl_watermarks missing",
      });
    }
    console.error("[ready] Unexpected error:", err);
    return NextResponse.json(
      { status: "not_ready", postgres: "error" },
      { status: 503 },
    );
  }
}
