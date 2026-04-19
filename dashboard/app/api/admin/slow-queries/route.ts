import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const SLOW_QUERIES_SQL = `
  SELECT
    LEFT(query, 500) AS query,
    calls,
    mean_exec_time AS mean_exec_time_ms,
    max_exec_time AS max_exec_time_ms,
    total_exec_time AS total_exec_time_ms,
    rows,
    ROUND(
      shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100,
      1
    ) AS cache_hit_ratio
  FROM pg_stat_statements
  WHERE query LIKE '%ps\\_%' ESCAPE '\\'
  ORDER BY mean_exec_time DESC
  LIMIT 20
`;

export interface SlowQuery {
  query: string;
  calls: number;
  mean_exec_time_ms: number;
  max_exec_time_ms: number;
  total_exec_time_ms: number;
  rows: number;
  cache_hit_ratio: number | null;
}

export interface SlowQueriesResponse {
  queries: SlowQuery[];
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  try {
    const result = await query(SLOW_QUERIES_SQL);

    const queries: SlowQuery[] = result.rows.map((row) => ({
      query: String(row[0]),
      calls: Number(row[1]),
      mean_exec_time_ms: Number(row[2]),
      max_exec_time_ms: Number(row[3]),
      total_exec_time_ms: Number(row[4]),
      rows: Number(row[5]),
      cache_hit_ratio: row[6] != null ? Number(row[6]) : null,
    }));

    return NextResponse.json({ queries });
  } catch (err) {
    const pgErr = err as { code?: string };

    if (pgErr.code === "42P01") {
      return NextResponse.json({
        queries: [],
        error: "pg_stat_statements not enabled",
      });
    }

    console.error("[slow-queries] Unexpected error:", err);
    return NextResponse.json({ queries: [], error: "Internal server error" });
  }
}
