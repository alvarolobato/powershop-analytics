/**
 * GET /api/etl/stats
 *
 * Returns aggregated time-series data for ETL monitoring charts.
 * Uses the last 30 runs.
 *
 * Response shape:
 *   {
 *     duration_trend: [{ started_at, duration_ms, status }],
 *     rows_trend: [{ started_at, total_rows_synced }],
 *     table_durations: [{ table_name, avg_duration_ms, last_duration_ms }],
 *     success_rate: { total, success, partial, failed }
 *   }
 *
 * Error codes:
 *   500 - Database error
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { toIsoOrNull } from "@/lib/format";

export interface DurationTrendPoint {
  started_at: string;
  duration_ms: number | null;
  status: string;
}

export interface RowsTrendPoint {
  started_at: string;
  total_rows_synced: number | null;
}

export interface TableDuration {
  table_name: string;
  avg_duration_ms: number;
  last_duration_ms: number | null;
}

export interface SuccessRate {
  total: number;
  success: number;
  partial: number;
  failed: number;
}

export interface EtlStatsResponse {
  duration_trend: DurationTrendPoint[];
  rows_trend: RowsTrendPoint[];
  table_durations: TableDuration[];
  success_rate: SuccessRate;
}

const LAST_N_RUNS = 30;

export async function GET(): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    // Fetch started_at, duration_ms, status, total_rows_synced in a single query.
    // Reverse to oldest-first for charting (spread to avoid mutating the result array).
    const trendResult = await query(
      `SELECT started_at, duration_ms, status, total_rows_synced
       FROM etl_sync_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [LAST_N_RUNS],
    );

    const reversedRows = [...trendResult.rows].reverse();

    const durationTrend: DurationTrendPoint[] = reversedRows.map((row) => ({
      started_at: toIsoOrNull(row[0]) ?? "",
      duration_ms: row[1] != null ? Number(row[1]) : null,
      status: String(row[2]),
    }));

    const rowsTrend: RowsTrendPoint[] = reversedRows.map((row) => ({
      started_at: toIsoOrNull(row[0]) ?? "",
      total_rows_synced: row[3] != null ? Number(row[3]) : null,
    }));

    // Per-table average and last duration (across last N runs).
    // COALESCE ensures avg_duration_ms is 0 (not null) when all durations are null.
    const tableDurResult = await query(
      `SELECT
           t.table_name,
           COALESCE(ROUND(AVG(t.duration_ms))::int, 0) AS avg_duration_ms,
           (SELECT t2.duration_ms
            FROM etl_sync_run_tables t2
            JOIN etl_sync_runs r2 ON r2.id = t2.run_id
            WHERE t2.table_name = t.table_name
            ORDER BY r2.started_at DESC
            LIMIT 1) AS last_duration_ms
      FROM etl_sync_run_tables t
      JOIN etl_sync_runs r ON r.id = t.run_id
      WHERE r.id IN (
            SELECT id FROM etl_sync_runs
            ORDER BY started_at DESC
            LIMIT $1
          )
      GROUP BY t.table_name
      ORDER BY avg_duration_ms DESC`,
      [LAST_N_RUNS],
    );

    const tableDurations: TableDuration[] = tableDurResult.rows.map((row) => ({
      table_name: String(row[0]),
      avg_duration_ms: Number(row[1]),
      last_duration_ms: row[2] != null ? Number(row[2]) : null,
    }));

    // Success rate across last N runs
    const rateResult = await query(
      `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'success') AS success,
           COUNT(*) FILTER (WHERE status = 'partial') AS partial,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM (
            SELECT status FROM etl_sync_runs
            ORDER BY started_at DESC
            LIMIT $1
          ) sub`,
      [LAST_N_RUNS],
    );

    const rr = rateResult.rows[0] ?? [0, 0, 0, 0];
    const successRate: SuccessRate = {
      total: Number(rr[0]),
      success: Number(rr[1]),
      partial: Number(rr[2]),
      failed: Number(rr[3]),
    };

    const response: EtlStatsResponse = {
      duration_trend: durationTrend,
      rows_trend: rowsTrend,
      table_durations: tableDurations,
      success_rate: successRate,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[" + requestId + "] Error loading ETL stats:", err);
    return NextResponse.json(
      formatApiError(
        "No se pudieron cargar las estadísticas de ETL. Inténtalo de nuevo.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
