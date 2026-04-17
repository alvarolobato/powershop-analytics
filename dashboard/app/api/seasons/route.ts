import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export interface Season {
  code: string;
  label: string;
  from: string;
  to: string;
}

export function parseSeason(code: string): Season | null {
  const match = /^(PV|OI)(\d{2})$/i.exec(code.trim());
  if (!match) return null;

  const prefix = match[1].toUpperCase();
  const year = 2000 + parseInt(match[2], 10);

  if (prefix === "PV") {
    return {
      code,
      label: `Primavera-Verano ${year}`,
      from: `${year}-02-01`,
      to: `${year}-08-31`,
    };
  }

  return {
    code,
    label: `Otoño-Invierno ${year}`,
    from: `${year}-09-01`,
    to: `${year + 1}-01-31`,
  };
}

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
