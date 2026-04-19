/**
 * POST /api/admin/explain — Run EXPLAIN on a user-supplied SQL query.
 *
 * Accepts: { sql: string }
 * Returns: { plan: string }
 *
 * Uses EXPLAIN (FORMAT TEXT) without ANALYZE — the query is never executed,
 * keeping this route read-only per the project policy.
 *
 * Error codes:
 *   400 — Missing/empty sql, or write statement rejected
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { query, validateReadOnly, SqlValidationError } from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const { sql } = body as { sql?: unknown };

  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return NextResponse.json({ error: "Missing or empty sql field" }, { status: 400 });
  }

  // Guard: reject write statements before wrapping with EXPLAIN
  try {
    validateReadOnly(sql);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        { error: "Only SELECT queries are allowed" },
        { status: 400 },
      );
    }
    throw err;
  }

  // EXPLAIN without ANALYZE — planner plan only, query is never executed
  const explainSql = `EXPLAIN (FORMAT TEXT) ${sql.trim()}`;

  try {
    const result = await query(explainSql);
    const plan = result.rows.map((row) => row[0] as string).join("\n");
    return NextResponse.json({ plan });
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    const code = pgErr.code || "";
    if (code.startsWith("22") || code.startsWith("42")) {
      return NextResponse.json(
        { error: `EXPLAIN failed: ${pgErr.message || "unknown error"}` },
        { status: 400 },
      );
    }
    console.error("[explain] Unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected error running EXPLAIN" },
      { status: 500 },
    );
  }
}
