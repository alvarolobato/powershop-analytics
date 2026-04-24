/**
 * GET /api/admin/config/reveal?key=<key>
 *
 * Returns the actual (unmasked) value of a sensitive config key.
 * Requires admin authentication.
 * Only sensitive keys can be revealed; non-sensitive keys are already visible
 * in the GET /api/admin/config response.
 */

import { NextRequest, NextResponse } from "next/server";

import { adminApiKeyValid, adminUnauthorized } from "@/lib/admin-api-auth";
import { getSystemConfig } from "@/lib/system-config/loader";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!adminApiKeyValid(request)) {
    return adminUnauthorized();
  }

  const key = request.nextUrl.searchParams.get("key")?.trim();
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' query parameter" }, { status: 400 });
  }

  const config = getSystemConfig();
  const cv = config[key];

  if (!cv) {
    return NextResponse.json({ error: `Unknown config key: ${key}` }, { status: 404 });
  }

  if (!cv.sensitive) {
    return NextResponse.json({ error: "Key is not sensitive; value already visible" }, { status: 400 });
  }

  // Log access for audit trail
  console.info(
    `[config reveal] admin revealed sensitive key: ${key} source=${cv.source} at ${new Date().toISOString()}`,
  );

  return NextResponse.json({
    key,
    value: cv.value !== null && cv.value !== undefined ? String(cv.value) : "",
    source: cv.source,
  });
}
