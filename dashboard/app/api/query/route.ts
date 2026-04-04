/**
 * POST /api/query — Execute a read-only SQL query against PostgreSQL.
 *
 * Accepts: { sql: string }
 * Returns: { columns: string[], rows: unknown[][] }
 *
 * Error codes:
 *   400 — Missing or invalid SQL
 *   403 — Write operation rejected (read-only policy)
 *   408 — Query timeout (>30s)
 *   503 — Database connection error
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import {
  query,
  validateReadOnly,
  SqlValidationError,
  QueryTimeoutError,
  ConnectionError,
} from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { sql } = body as { sql?: string };

  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return NextResponse.json(
      { error: "Missing or empty 'sql' field" },
      { status: 400 }
    );
  }

  // Validate read-only before executing
  try {
    validateReadOnly(sql);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        { error: err.message },
        { status: 403 }
      );
    }
    throw err;
  }

  // Execute the query
  try {
    const result = await query(sql);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        { error: err.message },
        { status: 403 }
      );
    }
    if (err instanceof QueryTimeoutError) {
      return NextResponse.json(
        { error: err.message },
        { status: 408 }
      );
    }
    if (err instanceof ConnectionError) {
      return NextResponse.json(
        { error: err.message },
        { status: 503 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { error: `Query execution failed: ${message}` },
      { status: 400 }
    );
  }
}
