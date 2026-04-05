/**
 * GET    /api/dashboard/[id] — Load a single dashboard by ID.
 * PUT    /api/dashboard/[id] — Update dashboard spec (saves old spec as version).
 * DELETE /api/dashboard/[id] — Delete dashboard and its versions (cascade).
 *
 * Error codes:
 *   400 — Invalid ID or body
 *   404 — Dashboard not found
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, getPool } from "@/lib/db-write";
import { validateSpec } from "@/lib/schema";
import { ZodError } from "zod";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Parse and validate the ID parameter as a positive integer.
 * Returns the numeric ID or null if invalid.
 */
function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ─── GET: Load dashboard ──────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
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

  try {
    const rows = await sql(
      `SELECT id, name, description, spec, chat_messages_analyze, created_at, updated_at
       FROM dashboards WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${id}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error(`[${requestId}] Error al cargar dashboard ${id}:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo cargar el dashboard. Inténtalo de nuevo.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}

// ─── PUT: Update dashboard ────────────────────────────────────────────────

interface UpdateBody {
  spec?: unknown;
  prompt?: string;
  name?: string;
  skipVersion?: boolean;
  chat_messages_analyze?: unknown;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
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

  let body: UpdateBody;
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

  const { spec, prompt, name, skipVersion, chat_messages_analyze } = body;

  // Validate name type if provided
  if (name !== undefined && name !== null) {
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        formatApiError(
          "El campo 'name' debe ser texto no vacío.",
          "VALIDATION",
          undefined,
          requestId,
        ),
        { status: 400 },
      );
    }
  }

  // Validate chat_messages_analyze if provided
  if (chat_messages_analyze !== undefined && chat_messages_analyze !== null) {
    if (!Array.isArray(chat_messages_analyze)) {
      return NextResponse.json(
        formatApiError(
          "El campo 'chat_messages_analyze' debe ser un array.",
          "VALIDATION",
          undefined,
          requestId,
        ),
        { status: 400 },
      );
    }
    // Enforce max 200 messages and max 10KB per message
    const MAX_ANALYZE_MESSAGES = 200;
    const MAX_MESSAGE_LENGTH = 10_000;
    if (chat_messages_analyze.length > MAX_ANALYZE_MESSAGES) {
      return NextResponse.json(
        formatApiError(
          `El historial de análisis no puede superar ${MAX_ANALYZE_MESSAGES} mensajes.`,
          "VALIDATION",
          undefined,
          requestId,
        ),
        { status: 400 },
      );
    }
    for (const msg of chat_messages_analyze) {
      const m = msg as Record<string, unknown>;
      if (
        typeof msg !== "object" ||
        msg === null ||
        typeof m.role !== "string" ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string"
      ) {
        return NextResponse.json(
          formatApiError(
            "Formato de mensaje de análisis no válido.",
            "VALIDATION",
            undefined,
            requestId,
          ),
          { status: 400 },
        );
      }
      if (
        ((msg as Record<string, unknown>).content as string).length >
        MAX_MESSAGE_LENGTH
      ) {
        return NextResponse.json(
          formatApiError(
            `El contenido de un mensaje supera el límite de ${MAX_MESSAGE_LENGTH} caracteres.`,
            "VALIDATION",
            undefined,
            requestId,
          ),
          { status: 400 },
        );
      }
    }
  }

  if (spec === undefined || spec === null) {
    return NextResponse.json(
      formatApiError(
        "Falta el campo 'spec'.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // Validate prompt type
  if (prompt !== undefined && prompt !== null && typeof prompt !== "string") {
    return NextResponse.json(
      formatApiError(
        "El campo 'prompt' debe ser texto.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  try {
    validateSpec(spec);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        formatApiError(
          "La especificación del dashboard no es válida.",
          "VALIDATION",
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          requestId,
        ),
        { status: 400 },
      );
    }
    throw err;
  }

  const normalizedPrompt =
    typeof prompt === "string" ? prompt.trim() || null : null;

  // Use a transaction to ensure version insert + dashboard update are atomic
  let client;
  try {
    client = await getPool().connect();
  } catch (err) {
    console.error(`[${requestId}] Error de conexión al actualizar dashboard ${id}:`, err);
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

    // Fetch existing dashboard (lock row for update)
    const existingResult = await client.query(
      `SELECT id, spec FROM dashboards WHERE id = $1 FOR UPDATE`,
      [id],
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${id}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    // Save old spec as a version (skip for name-only changes)
    if (!skipVersion) {
      await client.query(
        `INSERT INTO dashboard_versions (dashboard_id, spec, prompt)
         VALUES ($1, $2, $3)`,
        [id, JSON.stringify(existingResult.rows[0].spec), normalizedPrompt],
      );
    }

    // Update the dashboard (include name and/or chat_messages_analyze if provided)
    const trimmedName = typeof name === "string" ? name.trim() : null;
    const hasChatAnalyze = chat_messages_analyze !== undefined && chat_messages_analyze !== null;

    // Build dynamic SET clause and parameters
    const setClauses: string[] = ["spec = $1", "updated_at = NOW()"];
    const params: unknown[] = [JSON.stringify(spec), id];
    let paramIdx = 3;

    if (trimmedName) {
      setClauses.push(`name = $${paramIdx}`);
      params.push(trimmedName);
      paramIdx++;
    }
    if (hasChatAnalyze) {
      setClauses.push(`chat_messages_analyze = $${paramIdx}`);
      params.push(JSON.stringify(chat_messages_analyze));
      paramIdx++;
    }

    const updateResult = await client.query(
      `UPDATE dashboards
       SET ${setClauses.join(", ")}
       WHERE id = $2
       RETURNING id, name, description, spec, chat_messages_analyze, created_at, updated_at`,
      params,
    );

    await client.query("COMMIT");

    if (updateResult.rows.length === 0) {
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${id}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    return NextResponse.json(updateResult.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[${requestId}] Error al actualizar dashboard ${id}:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo actualizar el dashboard. Inténtalo de nuevo.",
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

// ─── DELETE: Delete dashboard ─────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = generateRequestId();
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) {
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

  try {
    const rows = await sql(
      `DELETE FROM dashboards WHERE id = $1 RETURNING id`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        formatApiError(
          "Dashboard no encontrado.",
          "NOT_FOUND",
          `No existe ningún dashboard con ID ${id}.`,
          requestId,
        ),
        { status: 404 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(`[${requestId}] Error al eliminar dashboard ${id}:`, err);
    return NextResponse.json(
      formatApiError(
        "No se pudo eliminar el dashboard. Inténtalo de nuevo.",
        "DB_QUERY",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
