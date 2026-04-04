/**
 * PostgreSQL connection pool and query execution.
 *
 * Provides a read-only query interface against the PostgreSQL mirror.
 * All write operations (INSERT, UPDATE, DELETE, etc.) are rejected
 * before reaching the database — see AGENTS.md read-only policy.
 */

import { Pool, type PoolConfig } from "pg";

// ─── SQL Safety ─────────────────────────────────────────────────────────────

/**
 * Allowed SQL statement prefixes (allowlist approach).
 * Only SELECT, WITH (CTEs), and EXPLAIN are permitted.
 */
const ALLOWED_PREFIXES = /^\s*(SELECT|WITH|EXPLAIN)\b/i;

/**
 * Write keywords that must not appear in CTEs or after EXPLAIN ANALYZE.
 * Checked with word boundaries to catch data-modifying CTEs and
 * EXPLAIN ANALYZE <write statement>.
 */
const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|MERGE)\b/i;

/**
 * SELECT ... INTO creates a new table — must be rejected.
 * Matches SELECT ... INTO (but not INTO within a subquery alias).
 */
const SELECT_INTO = /\bSELECT\b[\s\S]*?\bINTO\s+\w/i;

/**
 * Validate that a SQL string is read-only.
 *
 * Applies multiple layers of validation:
 * 1. Must start with SELECT, WITH, or EXPLAIN (allowlist)
 * 2. Must not contain semicolons (prevents multi-statement injection)
 * 3. Must not contain write keywords anywhere (prevents data-modifying
 *    CTEs like `WITH x AS (DELETE ... RETURNING ...) SELECT ...` and
 *    `EXPLAIN ANALYZE INSERT ...`)
 * 4. Must not use SELECT ... INTO (creates new tables)
 *
 * The database role should also enforce read-only access as defense in depth.
 *
 * @throws SqlValidationError if the SQL is not a read-only statement
 */
export function validateReadOnly(sql: string): void {
  if (!sql || !sql.trim()) {
    throw new SqlValidationError("SQL query is empty");
  }

  const trimmed = sql.trim();

  // 1. Must start with an allowed keyword
  if (!ALLOWED_PREFIXES.test(trimmed)) {
    throw new SqlValidationError(
      "Only SELECT, WITH, and EXPLAIN statements are allowed. " +
        "Write operations are rejected per read-only policy."
    );
  }

  // 2. Reject multi-statement SQL (semicolons)
  if (trimmed.includes(";")) {
    throw new SqlValidationError(
      "Multi-statement SQL is not allowed. Remove semicolons."
    );
  }

  // 3. Reject write keywords anywhere in the query (catches data-modifying
  //    CTEs and EXPLAIN ANALYZE <write>)
  if (WRITE_KEYWORDS.test(trimmed)) {
    throw new SqlValidationError(
      "SQL contains a write keyword (INSERT, UPDATE, DELETE, DROP, ALTER, " +
        "TRUNCATE, CREATE). Only pure read operations are allowed."
    );
  }

  // 4. Reject SELECT ... INTO (creates tables)
  if (SELECT_INTO.test(trimmed)) {
    throw new SqlValidationError(
      "SELECT INTO is not allowed — it creates a new table."
    );
  }
}

// ─── Error classes ──────────────────────────────────────────────────────────

export class SqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlValidationError";
  }
}

export class QueryTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryTimeoutError";
  }
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

// ─── Pool configuration ─────────────────────────────────────────────────────

const QUERY_TIMEOUT_MS = 30_000;

function getPoolConfig(): PoolConfig {
  // POSTGRES_DSN takes priority (single connection string).
  // Falls back to individual POSTGRES_* env vars.
  const dsn = process.env.POSTGRES_DSN;
  if (dsn) {
    return {
      connectionString: dsn,
      max: 10,
      statement_timeout: QUERY_TIMEOUT_MS,
    };
  }

  return {
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "",
    database: process.env.POSTGRES_DB || "powershop",
    max: 10,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(getPoolConfig());
  }
  return _pool;
}

/**
 * Reset the pool. Useful for testing or configuration changes.
 */
export async function resetPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

/**
 * Execute a read-only SQL query against the PostgreSQL mirror.
 *
 * @param sql - The SQL query to execute (must be SELECT, WITH, or EXPLAIN)
 * @returns Column names and row data as arrays
 * @throws SqlValidationError if the query is not read-only
 * @throws QueryTimeoutError if the query exceeds 30 seconds
 * @throws ConnectionError if the database is unreachable
 */
export async function query(sql: string): Promise<QueryResult> {
  validateReadOnly(sql);

  const pool = getPool();

  try {
    const result = await pool.query(sql);

    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((row) => columns.map((col) => row[col]));

    return { columns, rows };
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string };

    // Statement timeout
    if (pgErr.code === "57014") {
      throw new QueryTimeoutError(
        `Query timed out after ${QUERY_TIMEOUT_MS / 1000} seconds`
      );
    }

    // Connection errors
    if (
      pgErr.code === "ECONNREFUSED" ||
      pgErr.code === "ENOTFOUND" ||
      pgErr.code === "ETIMEDOUT" ||
      pgErr.code === "57P01" // admin_shutdown
    ) {
      throw new ConnectionError(
        `Database connection failed: ${pgErr.message || "unknown error"}`
      );
    }

    throw err;
  }
}
