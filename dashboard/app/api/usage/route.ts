/**
 * GET /api/usage — LLM usage aggregates from llm_usage table.
 *
 * Returns HTTP 200 always. Returns zero-shape when table is empty or DB unreachable.
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db-write";

interface PeriodStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: string;
}

interface EndpointStats {
  endpoint: string;
  calls: number;
  total_tokens: number;
  estimated_cost_usd: string;
}

const ZERO_PERIOD: PeriodStats = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  estimated_cost_usd: "0.000000",
};

function rowToStats(row: Record<string, unknown> | undefined): PeriodStats {
  if (!row) return ZERO_PERIOD;
  return {
    prompt_tokens: Number(row.prompt_tokens) || 0,
    completion_tokens: Number(row.completion_tokens) || 0,
    total_tokens: Number(row.total_tokens) || 0,
    estimated_cost_usd: (Number(row.estimated_cost_usd) || 0).toFixed(6),
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const [periodRows, endpointRows] = await Promise.all([
      sql<Record<string, unknown>>(`
        SELECT
          SUM(CASE WHEN created_at >= CURRENT_DATE THEN prompt_tokens ELSE 0 END)         AS today_prompt,
          SUM(CASE WHEN created_at >= CURRENT_DATE THEN completion_tokens ELSE 0 END)     AS today_completion,
          SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_tokens ELSE 0 END)          AS today_total,
          SUM(CASE WHEN created_at >= CURRENT_DATE THEN estimated_cost_usd ELSE 0 END)    AS today_cost,

          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN prompt_tokens ELSE 0 END)       AS week_prompt,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN completion_tokens ELSE 0 END)   AS week_completion,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN total_tokens ELSE 0 END)        AS week_total,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN estimated_cost_usd ELSE 0 END)  AS week_cost,

          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN prompt_tokens ELSE 0 END)      AS month_prompt,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN completion_tokens ELSE 0 END)  AS month_completion,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN total_tokens ELSE 0 END)       AS month_total,
          SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN estimated_cost_usd ELSE 0 END) AS month_cost
        FROM llm_usage
      `),
      sql<Record<string, unknown>>(`
        SELECT
          endpoint,
          COUNT(*)::integer             AS calls,
          SUM(total_tokens)::integer    AS total_tokens,
          SUM(estimated_cost_usd)       AS estimated_cost_usd
        FROM llm_usage
        GROUP BY endpoint
        ORDER BY SUM(total_tokens) DESC
      `),
    ]);

    const r = periodRows[0] ?? {};

    const today: PeriodStats = rowToStats({
      prompt_tokens: r.today_prompt,
      completion_tokens: r.today_completion,
      total_tokens: r.today_total,
      estimated_cost_usd: r.today_cost,
    });

    const week: PeriodStats = rowToStats({
      prompt_tokens: r.week_prompt,
      completion_tokens: r.week_completion,
      total_tokens: r.week_total,
      estimated_cost_usd: r.week_cost,
    });

    const month: PeriodStats = rowToStats({
      prompt_tokens: r.month_prompt,
      completion_tokens: r.month_completion,
      total_tokens: r.month_total,
      estimated_cost_usd: r.month_cost,
    });

    const by_endpoint: EndpointStats[] = endpointRows.map((row) => ({
      endpoint: String(row.endpoint),
      calls: Number(row.calls) || 0,
      total_tokens: Number(row.total_tokens) || 0,
      estimated_cost_usd: Number(row.estimated_cost_usd).toFixed(6),
    }));

    return NextResponse.json({ today, week, month, by_endpoint });
  } catch (err) {
    console.error("[GET /api/usage] DB error, returning zero-shape:", err);
    return NextResponse.json({
      today: ZERO_PERIOD,
      week: ZERO_PERIOD,
      month: ZERO_PERIOD,
      by_endpoint: [],
    });
  }
}
