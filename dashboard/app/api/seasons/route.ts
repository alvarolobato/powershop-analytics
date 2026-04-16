/**
 * GET /api/seasons
 *
 * Queries ps_articulos for distinct clave_temporada values and maps each code
 * to a date range using the PV/OI naming convention:
 *   PV (Primavera-Verano): Feb 1 - Aug 31 of the given year
 *   OI (Otoño-Invierno):   Sep 1 of the given year - Jan 31 of the following year
 *
 * Returns: { seasons: Array<{ code: string; label: string; from: string; to: string }> }
 * On DB error: returns { seasons: [] } - never crashes the dashboard.
 */

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export interface Season {
  code: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Parse a season code (e.g. "PV26", "OI25") into a date range.
 * Returns null for unknown/malformed codes.
 */
export function parseSeasonCode(code: string): Omit<Season, "code"> | null {
  const match = code.match(/^(PV|OI)(\d{2})$/i);
  if (!match) return null;

  const prefix = match[1].toUpperCase() as "PV" | "OI";
  const year = 2000 + parseInt(match[2], 10);

  if (prefix === "PV") {
    return {
      label: `Primavera-Verano ${year}`,
      from: `${year}-02-01`,
      to: `${year}-08-31`,
    };
  }

  return {
    label: `Otoño-Invierno ${year}`,
    from: `${year}-09-01`,
    to: `${year + 1}-01-31`,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const result = await query(
      "SELECT DISTINCT clave_temporada FROM ps_articulos " +
        "WHERE clave_temporada IS NOT NULL AND clave_temporada != '' " +
        "ORDER BY clave_temporada DESC",
    );

    const seasons: Season[] = [];
    for (const row of result.rows) {
      const code = row[0] as string;
      const parsed = parseSeasonCode(code);
      if (parsed) {
        seasons.push({ code, ...parsed });
      }
    }

    return NextResponse.json({ seasons });
  } catch {
    return NextResponse.json({ seasons: [] });
  }
}
