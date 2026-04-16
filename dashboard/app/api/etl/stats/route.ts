import { NextResponse } from "next/server";
import { sql } from "@/lib/db-write";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

export async function GET(): Promise<NextResponse> {
  const requestId = generateRequestId();

  try {
    const [durationRows, rowsRows, tableRows, rateRows] = await Promise.all([
      sql(
        `SELECT started_at, duration_ms, status
         FROM etl_sync_runs
         ORDER BY started_at DESC
         LIMIT 30`,
      ),
      sql(
        `SELECT started_at, total_rows_synced
         FROM etl_sync_runs
         WHERE total_rows_synced IS NOT NULL
         ORDER BY started_at DESC
         LIMIT 30`,
      ),
      sql(
        `SELECT table_name,
                AVG(duration_ms)::bigint AS avg_duration_ms,
                (ARRAY_AGG(duration_ms ORDER BY started_at DESC))[1] AS last_duration_ms
         FROM etl_table_runs
         WHERE duration_ms IS NOT NULL
         GROUP BY table_name
         ORDER BY avg_duration_ms DESC
         LIMIT 20`,
      ),
      sql(
        `SELECT
           COUNT(*)::int                                        AS total,
           COUNT(*) FILTER (WHERE status = 'success')::int     AS success,
           COUNT(*) FILTER (WHERE status = 'partial')::int     AS partial,
           COUNT(*) FILTER (WHERE status = 'failed')::int      AS failed
         FROM (
           SELECT status FROM etl_sync_runs
           ORDER BY started_at DESC
           LIMIT 30
         ) recent`,
      ),
    ]);

    return NextResponse.json({
      duration_trend: (durationRows as object[]).slice().reverse(),
      rows_trend: (rowsRows as object[]).slice().reverse(),
      table_durations: tableRows,
      success_rate: (rateRows[0] as { total: number; success: number; partial: number; failed: number }) ??
        { total: 0, success: 0, partial: 0, failed: 0 },
    });
  } catch (err) {
    console.error(`[${requestId}] Error fetching ETL stats:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudieron cargar las estadísticas ETL.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
