/**
 * GET /api/etl/runs?page=1&per_page=20
 *
 * Returns a paginated list of ETL sync runs ordered by started_at DESC.
 *
 * Response shape:
 *   { runs: EtlSyncRun[], total: number, page: number, per_page: number }
 *
 * Error codes:
 *   400 -- Invalid pagination parameters
 *   500 -- Database error
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

export interface EtlSyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  total_tables: number | null;
  tables_ok: number | null;
  tables_failed: number | null;
  total_rows_synced: number | null;
  trigger: string;
}

export interface EtlRunsResponse {
  runs: EtlSyncRun[];
  total: number;
  page: number;
  per_page: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

  const { searchParams } = request.nextUrl;

  // Parse pagination params
  const rawPage = searchParams.get("page") ?? String(DEFAULT_PAGE);
  const rawPerPage = searchParams.get("per_page") ?? String(DEFAULT_PER_PAGE);

  // Strict integer validation: reject partial inputs like "1abc" or "5.5"
  if (!/^\d+$/.test(rawPage)) {
    return NextResponse.json(
      formatApiError(
        "El parámetro page debe ser un entero positivo.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }
  const page = parseInt(rawPage, 10);
  if (page < 1) {
    return NextResponse.json(
      formatApiError(
        "El parámetro page debe ser un entero positivo.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  if (!/^\d+$/.test(rawPerPage)) {
    return NextResponse.json(
      formatApiError(
        "El parámetro per_page debe ser un entero entre 1 y " + MAX_PER_PAGE + ".",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }
  const perPage = parseInt(rawPerPage, 10);
  if (perPage < 1 || perPage > MAX_PER_PAGE) {
    return NextResponse.json(
      formatApiError(
        "El parámetro per_page debe ser un entero entre 1 y " + MAX_PER_PAGE + ".",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const offset = (page - 1) * perPage;

  try {
    // Get total count
    const countResult = await query("SELECT COUNT(*) FROM etl_sync_runs");
    const total = Number(countResult.rows[0][0]);

    // Get paginated rows
    const runsResult = await query(
      `SELECT id, started_at, finished_at, duration_ms, status,
              total_tables, tables_ok, tables_failed, total_rows_synced, trigger
       FROM etl_sync_runs
       ORDER BY started_at DESC
       LIMIT $1 OFFSET $2`,
      [perPage, offset],
    );

    const runs: EtlSyncRun[] = runsResult.rows.map((row) => ({
      id: Number(row[0]),
      started_at:
        row[1] instanceof Date ? row[1].toISOString() : String(row[1]),
      finished_at:
        row[2] != null
          ? row[2] instanceof Date
            ? row[2].toISOString()
            : String(row[2])
          : null,
      duration_ms: row[3] != null ? Number(row[3]) : null,
      status: String(row[4]),
      total_tables: row[5] != null ? Number(row[5]) : null,
      tables_ok: row[6] != null ? Number(row[6]) : null,
      tables_failed: row[7] != null ? Number(row[7]) : null,
      total_rows_synced: row[8] != null ? Number(row[8]) : null,
      trigger: String(row[9]),
    }));

    const response: EtlRunsResponse = { runs, total, page, per_page: perPage };
    return NextResponse.json(response);
  } catch (err) {
    console.error(`[${requestId}] Error listing ETL runs:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudieron cargar los runs de ETL. Inténtalo de nuevo.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
