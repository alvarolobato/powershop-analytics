/**
 * Persist tool-call telemetry to PostgreSQL (`llm_tool_calls`).
 */

import { sql } from "@/lib/db-write";

export interface LogToolCallInput {
  toolName: string;
  endpoint: string;
  requestId: string | null;
  status: "ok" | "error";
  latencyMs: number;
  payloadInBytes: number;
  payloadOutBytes: number;
  errorCode?: string | null;
}

export async function logLlmToolCall(row: LogToolCallInput): Promise<void> {
  try {
    await sql(
      `INSERT INTO llm_tool_calls (
         tool_name, endpoint, request_id, status, latency_ms,
         payload_in_bytes, payload_out_bytes, error_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.toolName,
        row.endpoint,
        row.requestId,
        row.status,
        row.latencyMs,
        row.payloadInBytes,
        row.payloadOutBytes,
        row.errorCode ?? null,
      ],
    );
  } catch (err) {
    if (process.env.VITEST !== "true") {
      console.error("[llm-tool-calls] insert failed:", err);
    }
  }
}

export interface ToolCallAggregateRow {
  endpoint: string;
  tool_name: string;
  status: string;
  calls: number;
  avg_latency_ms: number | null;
  total_payload_in: number | null;
  total_payload_out: number | null;
}

/** Aggregated tool metrics for admin dashboards (last 30 days). */
export async function fetchToolCallAggregates(): Promise<ToolCallAggregateRow[]> {
  try {
    return await sql<ToolCallAggregateRow>(`
      SELECT
        endpoint,
        tool_name,
        status,
        COUNT(*)::integer AS calls,
        (AVG(latency_ms))::integer AS avg_latency_ms,
        SUM(payload_in_bytes)::bigint AS total_payload_in,
        SUM(payload_out_bytes)::bigint AS total_payload_out
      FROM llm_tool_calls
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY endpoint, tool_name, status
      ORDER BY calls DESC
    `);
  } catch (err) {
    if (process.env.VITEST !== "true") {
      console.error("[llm-tool-calls] aggregate query failed:", err);
    }
    return [];
  }
}
