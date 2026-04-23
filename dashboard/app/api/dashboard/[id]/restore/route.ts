/**
 * POST /api/dashboard/[id]/restore — Restore a prior spec (append-only history).
 *
 * Saves the current spec as a new version row, then sets dashboards.spec to the
 * target version's spec. Returns the updated dashboard (same shape as GET).
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getPool } from "@/lib/db-write";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";
import { validateSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: rawId } = await context.params;
  const dashboardId = parseId(rawId);
  if (dashboardId === null) {
    return NextResponse.json(
      formatApiError(
        "El identificador del dashboard no es válido (debe ser un entero positivo).",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("Cuerpo JSON no válido.", "VALIDATION", undefined, requestId),
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError(
        "El cuerpo JSON debe ser un objeto.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  const versionId = (body as { version_id?: unknown }).version_id;
  if (
    typeof versionId !== "number" ||
    !Number.isInteger(versionId) ||
    versionId <= 0
  ) {
    return NextResponse.json(
      formatApiError(
        "El campo 'version_id' debe ser un entero positivo.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  let client;
  try {
    client = await getPool().connect();
  } catch (err) {
    console.error(
      `[${requestId}] Error de conexión al restaurar dashboard ${dashboardId}:`,
      err,
    );
    return NextResponse.json(
      formatApiError(
        "No se pudo conectar a la base de datos. Inténtalo de nuevo.",
        "DB_CONNECTION",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 503 },
    );
  }

  try {
    await client.query("BEGIN");

    const targetResult = await client.query<{
      id: number;
      spec: unknown;
      version_number: string | number;
    }>(
      `SELECT id, spec, version_number
       FROM (
         SELECT id,
                spec,
                ROW_NUMBER() OVER (
                  PARTITION BY dashboard_id ORDER BY created_at ASC, id ASC
                ) AS version_number
         FROM dashboard_versions
         WHERE dashboard_id = $1
       ) sub
       WHERE id = $2`,
      [dashboardId, versionId],
    );

    if (targetResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        formatApiError(
          "Versión no encontrada.",
          "NOT_FOUND",
          "La versión indicada no existe o no pertenece a este dashboard.",
          requestId,
        ),
        { status: 404 },
      );
    }

    const targetRow = targetResult.rows[0];
    const versionNumber = Number(targetRow.version_number);

    let validatedSpec: ReturnType<typeof validateSpec>;
    try {
      validatedSpec = validateSpec(targetRow.spec);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof ZodError) {
        return NextResponse.json(
          formatApiError(
            "La versión seleccionada no cumple el esquema actual del dashboard.",
            "VALIDATION",
            err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
            requestId,
          ),
          { status: 400 },
        );
      }
      throw err;
    }

    const sqlLint = lintDashboardSpec(validatedSpec);
    if (sqlLint.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        formatApiError(
          "Las consultas SQL de la versión restaurada contienen patrones inválidos para PostgreSQL.",
          "SQL_LINT",
          sqlLint.join(" | "),
          requestId,
        ),
        { status: 400 },
      );
    }

    const existingResult = await client.query<{ spec: unknown }>(
      `SELECT spec FROM dashboards WHERE id = $1 FOR UPDATE`,
      [dashboardId],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${dashboardId}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    const currentSpec = existingResult.rows[0].spec;

    await client.query(
      `INSERT INTO dashboard_versions (dashboard_id, spec, prompt)
       VALUES ($1, $2, $3)`,
      [
        dashboardId,
        JSON.stringify(currentSpec),
        `Restauración a versión ${versionNumber}`,
      ],
    );

    const updateResult = await client.query(
      `UPDATE dashboards
       SET spec = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, description, spec, chat_messages_analyze, created_at, updated_at`,
      [JSON.stringify(validatedSpec), dashboardId],
    );

    await client.query("COMMIT");

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${dashboardId}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    return NextResponse.json(updateResult.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[${requestId}] Error al restaurar dashboard ${dashboardId}:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo restaurar la versión. Inténtalo de nuevo.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
