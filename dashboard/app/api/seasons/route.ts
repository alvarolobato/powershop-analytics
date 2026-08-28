import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { type Season, parseSeason } from "@/lib/seasons";

// Evaluate per-request — this route queries Postgres and its catch-all falls
// back to `{ seasons: [] }` on any error (always HTTP 200), so Next's App
// Router has no signal that would otherwise stop it from freezing that
// build-time result (DB unreachable at build time) into a static response.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const result = await query(
      "SELECT DISTINCT clave_temporada FROM ps_articulos WHERE clave_temporada IS NOT NULL AND clave_temporada != '' ORDER BY clave_temporada DESC"
    );

    const seasons: Season[] = result.rows
      .map((row) => parseSeason(String(row[0])))
      .filter((s): s is Season => s !== null);

    return NextResponse.json({ seasons });
  } catch {
    return NextResponse.json({ seasons: [] });
  }
}
