/**
 * PostgreSQL write-capable pool for dashboard persistence.
 *
 * Unlike db.ts (read-only for analytics queries), this module provides
 * parameterized query execution for the dashboard CRUD operations
 * (dashboards, dashboard_versions tables).
 */

import { Pool, type PoolConfig, type QueryResultRow } from "pg";

// ─── llm_interactions types ─────────────────────────────────────────────────

/**
 * A structured progress line stored in `llm_interactions.lines`.
 * Uses `kind` so callers can format them by type in the UI.
 */
export interface InteractionLine {
  /** Logical line type for UI formatting. */
  kind: "meta" | "tool_call" | "tool_result" | "assistant_text" | "error" | "phase";
  /** Human-readable text (Spanish). */
  text: string;
  /** ISO timestamp when the line was emitted. */
  ts: string;
}

export type InteractionEndpoint = "generate" | "modify" | "analyze";

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

// ─── llm_interactions helpers ────────────────────────────────────────────────

/**
 * Insert a new `llm_interactions` row with status='running' and return its UUID.
 *
 * Fire-and-forget safe: callers should not await this in the hot path if they
 * want to avoid blocking the stream; however the returned promise can be awaited
 * to get the row id for subsequent updates.
 */
export async function createInteraction(opts: {
  requestId: string;
  endpoint: InteractionEndpoint;
  dashboardId?: number | null;
  prompt: string;
  llmProvider?: string | null;
  llmDriver?: string | null;
}): Promise<string> {
  const rows = await sql<{ id: string }>(
    `INSERT INTO llm_interactions
       (request_id, endpoint, dashboard_id, prompt, llm_provider, llm_driver, started_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'running')
     RETURNING id`,
    [
      opts.requestId,
      opts.endpoint,
      opts.dashboardId ?? null,
      opts.prompt,
      opts.llmProvider ?? null,
      opts.llmDriver ?? null,
    ],
  );
  if (!rows[0]) throw new Error("createInteraction: no row returned");
  return rows[0].id;
}

/**
 * Append a batch of lines to `llm_interactions.lines` (JSONB concatenation).
 * Throws on DB errors — callers should catch and log if they want best-effort
 * behavior (the generate route wraps this in try/catch).
 */
export async function appendInteractionLines(
  id: string,
  lines: InteractionLine[],
): Promise<void> {
  if (lines.length === 0) return;
  await sql(
    `UPDATE llm_interactions
        SET lines = lines || $2::jsonb
      WHERE id = $1`,
    [id, JSON.stringify(lines)],
  );
}

/**
 * Mark an interaction as completed or error.
 *
 * Throws on DB errors — callers should `.catch()` and log if they want
 * best-effort behavior (success-path callers should `await` this before
 * returning the HTTP response so status never stays 'running').
 */
export async function finishInteraction(
  id: string,
  status: "completed" | "error",
  finalOutput?: string | null,
): Promise<void> {
  await sql(
    `UPDATE llm_interactions
        SET status = $2,
            finished_at = NOW(),
            final_output = $3
      WHERE id = $1`,
    [id, status, finalOutput ?? null],
  );
}
