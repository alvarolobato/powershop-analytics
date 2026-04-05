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

const STALE_THRESHOLD_HOURS = 36;

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

    const overallStale = tables.some((t) => t.isStale);

    // stalestTable = first entry (already sorted ASC by last_sync_at)
    const stalest = tables[0];
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
