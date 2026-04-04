/**
 * GET /api/health — Liveness check for Docker healthcheck.
 *
 * Returns 200 with `{status: "ok"}`.
 */
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}
