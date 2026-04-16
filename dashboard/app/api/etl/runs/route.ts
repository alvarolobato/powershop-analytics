import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db-write";
import { formatApiError, generateRequestId, sanitizeErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") ?? "20", 10)));
  const offset = (page - 1) * perPage;

  try {
    const [runs, countRows] = await Promise.all([
      sql(
        `SELECT id, started_at, finished_at, duration_ms, status,
                total_tables, tables_ok, tables_failed, total_rows_synced, trigger
         FROM etl_sync_runs
         ORDER BY started_at DESC
         LIMIT $1 OFFSET $2`,
        [perPage, offset],
      ),
      sql(`SELECT COUNT(*)::int AS total FROM etl_sync_runs`),
    ]);

    return NextResponse.json({
      runs,
      total: (countRows[0] as { total: number })?.total ?? 0,
    });
  } catch (err) {
    console.error(`[${requestId}] Error fetching ETL runs:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudieron cargar las ejecuciones ETL.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
