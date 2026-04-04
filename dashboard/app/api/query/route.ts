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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "JSON body must be an object" },
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

    // For known client-caused PG errors, return 400 with the message.
    // Class 22 = data_exception, Class 42 = syntax/access errors (excl. permission).
    // For truly unexpected errors, return 500 without leaking internals.
    const pgErr = err as { code?: string; message?: string };
    const code = pgErr.code || "";
    const isPermissionError = code === "42501"; // insufficient_privilege
    const isClientError =
      !isPermissionError &&
      (code.startsWith("22") || code.startsWith("42"));

    if (isClientError) {
      return NextResponse.json(
        { error: `Query failed: ${pgErr.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred while executing the query" },
      { status: 500 }
    );
  }
}
