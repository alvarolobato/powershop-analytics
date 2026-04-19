/**
 * POST /api/etl/run
 *
 * Requests a manual ETL sync by inserting a row into etl_manual_trigger.
 * Returns 409 if a non-stale sync is already running (started < 4h ago).
 * A run started more than 4 hours ago is treated as stale and does not block.
 * Deduplicates pending triggers: if one already exists, returns it directly.
 *
 * Response codes:
 *   202 { trigger_id: number }                                — trigger inserted
 *   202 { trigger_id: number, already_queued: true }          — pending trigger exists
 *   409 { error: "already_running", run_id: number }          — sync already active
 *   503 { error: "db_error" }                                 — database unreachable
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { sql } from "@/lib/db-write";

const STALE_RUN_HOURS = 4;

export async function POST(): Promise<NextResponse> {
  try {
    const activeResult = await query(
      `SELECT id, started_at
       FROM etl_sync_runs
       WHERE status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`,
    );

    if (activeResult.rows.length > 0) {
      const [runId, startedAt] = activeResult.rows[0];
      const startedAtDate = startedAt instanceof Date ? startedAt : new Date(String(startedAt));
      const staleThreshold = new Date(Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000);

      if (startedAtDate >= staleThreshold) {
        return NextResponse.json(
          { error: "already_running", run_id: Number(runId) },
          { status: 409 },
        );
      }
    }

    const pendingResult = await query(
      `SELECT id FROM etl_manual_trigger WHERE status = 'pending' LIMIT 1`,
    );
    if (pendingResult.rows.length > 0) {
      const [pendingId] = pendingResult.rows[0];
      return NextResponse.json(
        { trigger_id: Number(pendingId), already_queued: true },
        { status: 202 },
      );
    }

    const rows = await sql<{ id: number }>(
      `INSERT INTO etl_manual_trigger (status) VALUES ('pending') RETURNING id`,
    );

    const triggerId = Number(rows[0]?.id);
    if (!triggerId) {
      return NextResponse.json({ error: "db_error" }, { status: 503 });
    }
    return NextResponse.json({ trigger_id: triggerId }, { status: 202 });
  } catch (err) {
    console.error("[etl/run] trigger failed:", err);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}
