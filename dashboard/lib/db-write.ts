/**
 * PostgreSQL write-capable pool for dashboard persistence.
 *
 * Unlike db.ts (read-only for analytics queries), this module provides
 * parameterized query execution for the dashboard CRUD operations
 * (dashboards, dashboard_versions tables).
 */

import { Pool, type PoolConfig, type QueryResultRow } from "pg";

// ─── Pool configuration ─────────────────────────────────────────────────────

const STATEMENT_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 5_000;

function getPoolConfig(): PoolConfig {
  const dsn = process.env.POSTGRES_DSN;
  if (dsn) {
    return {
      connectionString: dsn,
      max: 5,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    };
  }

  return {
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "",
    database: process.env.POSTGRES_DB || "powershop",
    max: 5,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(getPoolConfig());
  }
  return _pool;
}

/**
 * Reset the pool. Useful for testing.
 */
export async function resetPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Execute a parameterized SQL query.
 */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}
