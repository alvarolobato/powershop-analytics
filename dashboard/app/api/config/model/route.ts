import { NextResponse } from "next/server";
import { loadDashboardLlmConfig, getEffectiveDashboardModel } from "@/lib/llm-provider/config";

// Evaluate per-request — without this, Next's App Router bakes the build-time
// model into a static response, so runtime changes made via /admin/config
// never reach the chat sidebar until the next image rebuild.
export const dynamic = "force-dynamic";

export function GET() {
  const model = getEffectiveDashboardModel(loadDashboardLlmConfig());
  return NextResponse.json({ model });
}
