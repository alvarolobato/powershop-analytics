import type { PoolConfig } from "pg";

const STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Budget for acquiring a pooled connection.
 *
 * In `pg` this covers the wait for a free *pool slot*, not just the TCP
 * connect — a route that fans out more queries than `max` legitimately
 * queues here. `/api/home` issues 33 aggregates against a 10-slot pool,
 * so at 5 s the tail of that fan-out failed with "timeout exceeded when
 * trying to connect" whenever the leading queries ran long, which reads
 * as "the database is down" when the database is perfectly healthy.
 * Individual queries stay bounded by STATEMENT_TIMEOUT_MS.
 */
const CONNECTION_TIMEOUT_MS = 20_000;

/**
 * Build a pg PoolConfig from env vars, with caller-specified pool size.
 * POSTGRES_DSN takes priority; falls back to individual POSTGRES_* env vars.
 */
export function buildPgPoolConfig(opts: { max: number }): PoolConfig {
  const dsn = process.env.POSTGRES_DSN;
  if (dsn) {
    return {
      connectionString: dsn,
      max: opts.max,
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
    max: opts.max,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}
