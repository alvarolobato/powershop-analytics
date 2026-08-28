/**
 * Durable record of SQL failures from POST /api/query.
 *
 * That endpoint executes each saved widget's own SQL, so it is where a
 * malformed generated query shows up in production — the "there is no
 * parameter $1" class of bug (D-041). It wrote to none of the observability
 * tables: its only trace was a console line, and the PG class-22/42 branch
 * (which is precisely where that error lands, 42P02) did not even emit one.
 * Container stdout has no logging driver, no rotation and no shipper in
 * production, so it dies on the next deploy — leaving the requestId in a
 * user's screenshot unresolvable.
 *
 * The requestId written here is the same one ErrorDisplay shows the user under
 * "Detalles técnicos", which is what makes a reported id resolvable later.
 */

import { sql } from "@/lib/db-write";
import { sanitizeErrorMessage } from "@/lib/errors";

/** Cap on the stored SQL. Long enough to diagnose, bounded so one runaway
 *  query cannot bloat the table. */
const SQL_TEXT_MAX = 4000;

export interface LogQueryErrorInput {
  requestId: string;
  /** The app-level code already returned to the client (DB_QUERY, TIMEOUT, …). */
  code: string;
  /** The failing SQL, if we got far enough to have it. */
  sqlText?: string | null;
  /** Number of bind params — the parameter-mismatch bug is visible in this. */
  paramCount?: number | null;
  durationMs?: number | null;
  /** The thrown error; its message is sanitized before storage. */
  error: unknown;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}

/**
 * Best-effort persist. Never throws: an observability write must not turn a
 * query error into a 500. A failure here is itself logged rather than
 * swallowed, so closing this hole does not open a quieter one.
 */
export async function logQueryError(input: LogQueryErrorInput): Promise<void> {
  try {
    const pgCode =
      typeof (input.error as { code?: unknown } | null)?.code === "string"
        ? ((input.error as { code: string }).code || null)
        : null;
    const message = sanitizeErrorMessage(input.error) || "(sin mensaje)";
    await sql(
      `INSERT INTO query_errors
         (request_id, code, pg_code, message, sql_text, param_count, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.requestId,
        input.code,
        pgCode,
        message,
        input.sqlText ? truncate(input.sqlText, SQL_TEXT_MAX) : null,
        input.paramCount ?? null,
        input.durationMs ?? null,
      ],
    );
  } catch (err) {
    console.error(
      `[${input.requestId}] could not persist query error to query_errors:`,
      err,
    );
  }
}
