/**
 * POST /api/query — Execute a read-only SQL query against PostgreSQL.
 *
 * Accepts: { sql: string }
 * Returns: { columns: string[], rows: unknown[][] }
 *
 * Error codes:
 *   400 — Missing or invalid SQL
 *   403 — Write operation rejected (read-only policy)
 *   408 — Query timeout (>30s)
 *   503 — Database connection error
 *   500 — Unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import {
  query,
  validateReadOnly,
  SqlValidationError,
  QueryTimeoutError,
  ConnectionError,
} from "@/lib/db";
import {
  formatApiError,
  generateRequestId,
  sanitizeErrorMessage,
} from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

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

  const { sql } = body as { sql?: string };

  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return NextResponse.json(
      formatApiError(
        "Falta el campo 'sql' o está vacío.",
        "VALIDATION",
        undefined,
        requestId,
      ),
      { status: 400 },
    );
  }

  // Validate read-only before executing
  try {
    validateReadOnly(sql);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        formatApiError(
          "La consulta contiene operaciones no permitidas (solo se permiten consultas de lectura).",
          "VALIDATION",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 403 },
      );
    }
    throw err;
  }

  // Execute the query
  try {
    const result = await query(sql);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        formatApiError(
          "La consulta contiene operaciones no permitidas (solo se permiten consultas de lectura).",
          "VALIDATION",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 403 },
      );
    }
    if (err instanceof QueryTimeoutError) {
      console.error(`[${requestId}] Timeout en consulta SQL:`, err);
      return NextResponse.json(
        formatApiError(
          "La consulta excedió el tiempo máximo de espera.",
          "TIMEOUT",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 408 },
      );
    }
    if (err instanceof ConnectionError) {
      console.error(`[${requestId}] Error de conexión a la base de datos:`, err);
      return NextResponse.json(
        formatApiError(
          "No se pudo conectar a la base de datos. Inténtalo de nuevo más tarde.",
          "DB_CONNECTION",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 503 },
      );
    }

    // For known client-caused PG errors, return 400 with the message.
    // Class 22 = data_exception, Class 42 = syntax/access errors (excl. permission).
    // For truly unexpected errors, return 500 without leaking internals.
    const pgErr = err as { code?: string; message?: string };
    const code = pgErr.code || "";
    const isPermissionError = code === "42501"; // insufficient_privilege
    const isClientError =
      !isPermissionError &&
      (code.startsWith("22") || code.startsWith("42"));

    if (isClientError) {
      return NextResponse.json(
        formatApiError(
          "Error en la consulta SQL. Verifica la sintaxis.",
          "DB_QUERY",
          sanitizeErrorMessage(err),
          requestId,
        ),
        { status: 400 },
      );
    }

    console.error(`[${requestId}] Error inesperado al ejecutar consulta SQL:`, err);
    return NextResponse.json(
      formatApiError(
        "Error inesperado al ejecutar la consulta.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId,
      ),
      { status: 500 },
    );
  }
}
