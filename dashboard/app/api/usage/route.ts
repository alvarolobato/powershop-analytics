/**
 * GET /api/usage — LLM usage aggregates from llm_usage table.
 *
 * Returns HTTP 200 always. Returns zero-shape when table is empty or DB unreachable.
 */

import { NextResponse } from "next/server";
import { getLlmUsageAggregates } from "@/lib/llm-usage-stats";

export async function GET(): Promise<NextResponse> {
  const body = await getLlmUsageAggregates();
  return NextResponse.json(body);
}
