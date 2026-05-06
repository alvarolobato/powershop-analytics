/**
 * GET /api/data-health — Query ETL watermarks for data freshness.
 *
 * Returns:
 *   {
 *     tables: { name: string, lastSync: string, isStale: boolean }[],
 *     overallStale: boolean,
 *     stalestTable: { name: string, lastSync: string } | null,
 *   }
 *
 * A table is stale when last_sync_at is more than 36 hours ago.
 * If etl_watermarks does not exist or the query fails, returns empty result (graceful degradation).
 *
 * Error codes:
 *   200 — Always returns 200 (empty result on error for graceful degradation)
 */

import { NextResponse } from "next/server";
import { query, ConnectionError } from "@/lib/db";

// Always evaluate per-request — without this, Next.js 14 renders the route
// statically at build time (when Postgres is unreachable) and serves the empty
// fallback forever.
export const dynamic = "force-dynamic";

const STALE_THRESHOLD_HOURS = 36;

/**
 * Lookup-only tables that the headline freshness indicator (`stalestTable`,
 * `overallStale`) ignores.
 *
 * The hourly delta cron only runs watermark-backed syncs (ventas, stock,
 * articulos, …). These four small reference tables are full-refresh only
 * — they update on the nightly cron at 02:00 or on container restart —
 * and almost never change during business hours (catálogos: payment
 * forms, sales types; tiendas: store list; proveedores: supplier list;
 * gc_comerciales: sales reps).
 *
 * Without this filter the TopBar would report "hace 10h" purely because
 * one of these lookup tables hasn't been touched since the last full
 * sync, masking the fact that ventas/stock are minutes-fresh. The
 * `tables` array still includes them — the banner needs the full list
 * to show per-table status — but the headline is computed across the
 * transactional set only.
 */
const HEADLINE_FRESHNESS_EXCLUDED = new Set<string>([
  "catalogos",
  "tiendas",
  "proveedores",
  "gc_comerciales",
]);

export interface TableFreshness {
  name: string;
  lastSync: string;
  isStale: boolean;
}

export interface DataHealthResponse {
  tables: TableFreshness[];
  overallStale: boolean;
  stalestTable: { name: string; lastSync: string } | null;
}

const EMPTY_RESPONSE: DataHealthResponse = {
  tables: [],
  overallStale: false,
  stalestTable: null,
};

export async function GET(): Promise<NextResponse> {
  try {
    const result = await query(
      "SELECT table_name, last_sync_at, status FROM etl_watermarks ORDER BY last_sync_at ASC"
    );

    if (result.rows.length === 0) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    const now = new Date();
    const thresholdMs = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

    const tables: TableFreshness[] = result.rows.map((row) => {
      const name = String(row[0]);
      const lastSyncRaw = row[1];
      const lastSync =
        lastSyncRaw instanceof Date
          ? lastSyncRaw.toISOString()
          : String(lastSyncRaw);
      const lastSyncDate = new Date(lastSync);
      const isStale = now.getTime() - lastSyncDate.getTime() > thresholdMs;
      return { name, lastSync, isStale };
    });

    // Headline indicator (stalestTable + overallStale) reflects transactional
    // freshness only — see HEADLINE_FRESHNESS_EXCLUDED. The full `tables`
    // list is preserved above so the banner can still show every watermark.
    const headlineTables = tables.filter(
      (t) => !HEADLINE_FRESHNESS_EXCLUDED.has(t.name),
    );
    const overallStale = headlineTables.some((t) => t.isStale);

    // stalestTable = first entry of the headline set (already sorted ASC).
    // Falls back to the full set if every transactional table was excluded
    // (defensive — shouldn't happen in practice).
    const stalest = headlineTables[0] ?? tables[0];
    const stalestTable = stalest
      ? { name: stalest.name, lastSync: stalest.lastSync }
      : null;

    const response: DataHealthResponse = {
      tables,
      overallStale,
      stalestTable,
    };

    return NextResponse.json(response);
  } catch (err) {
    // If the table doesn't exist or connection fails, return empty (graceful degradation)
    const pgErr = err as { code?: string };
    const isTableMissing =
      pgErr.code === "42P01" || // undefined_table
      err instanceof ConnectionError;

    if (isTableMissing) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    // For any other error (e.g. unknown DB error in dev), also degrade gracefully
    // so the banner doesn't crash the dashboard
    console.error("[data-health] Unexpected error querying etl_watermarks:", err);
    return NextResponse.json(EMPTY_RESPONSE);
  }
}
