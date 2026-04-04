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
 * Validate that a SQL string is read-only.
 *
 * Uses an allowlist approach: only statements starting with SELECT, WITH,
 * or EXPLAIN are allowed. This avoids false positives from column/table
 * names that happen to contain words like "update" or "delete".
 *
 * @throws Error if the SQL is not a read-only statement
 */
export function validateReadOnly(sql: string): void {
  if (!sql || !sql.trim()) {
    throw new SqlValidationError("SQL query is empty");
  }

  if (!ALLOWED_PREFIXES.test(sql.trim())) {
    throw new SqlValidationError(
      "Only SELECT, WITH, and EXPLAIN statements are allowed. " +
        "Write operations are rejected per read-only policy."
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
