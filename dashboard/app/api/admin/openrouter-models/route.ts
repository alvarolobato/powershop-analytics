/**
 * GET /api/admin/openrouter-models
 *
 * Returns the OpenRouter model catalog with normalised pricing
 * (USD per 1M tokens), context windows, modality, and a `popular` flag
 * for the curated "Populares" set. Backed by an in-process cache with a
 * 1 h TTL — see `./catalog.ts`.
 *
 * Why the helpers live in `catalog.ts`: Next.js App Router rejects any
 * non-handler exports from a route file. Tests need a cache-reset hook,
 * so the cache + helpers are kept in a sibling module.
 */
import { NextRequest, NextResponse } from "next/server";

import { adminApiKeyValid, adminUnauthorized } from "@/lib/admin-api-auth";

import { getCachedCatalog } from "./catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!adminApiKeyValid(request)) {
    return adminUnauthorized();
  }

  try {
    const payload = await getCachedCatalog();
    return NextResponse.json({
      models: payload.models,
      cached_at: new Date(payload.fetchedAt).toISOString(),
      source: payload.source,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
