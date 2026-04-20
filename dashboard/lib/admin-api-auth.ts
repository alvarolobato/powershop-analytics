import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Shared 401 for missing/invalid admin API credentials. */
export function adminUnauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Validates `x-admin-key` or `Authorization: Bearer <key>` against `ADMIN_API_KEY`.
 * When `ADMIN_API_KEY` is unset, no request is authorized (fail closed).
 */
export function adminApiKeyValid(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) return false;

  const headerKey = request.headers.get("x-admin-key")?.trim();
  if (headerKey === expected) return true;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim() === expected;
  }
  return false;
}
