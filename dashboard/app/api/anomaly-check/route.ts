/**
 * POST /api/anomaly-check — Z-score anomaly detection for KPI values.
 *
 * Accepts: { sql: string }
 *   The sql must return N rows of single-column numeric values.
 *   Row 0 = current period value; rows 1..N-1 = historical values.
 *
 * Returns one of:
 *   { isAnomaly: false }  — insufficient data (<4 historical values), normal
 *                            range, zero stddev, or invalid current value
 *   {
 *     isAnomaly: boolean,
 *     currentValue: number,
 *     mean: number,
 *     stddev: number,
 *     zScore: number,
 *     direction: "high" | "low" | "normal",
 *     explanation: string,  // Spanish
 *   }
 * Note: additional fields (mean, stddev, etc.) may also be present on
 * non-anomaly results when stddev > 0 and data is sufficient.
 *
 * Anomaly threshold: |z-score| > 2.0
 *
 * Error codes:
 *   400 — Missing sql or validation error
 *   403 — Write operation rejected
 *   408 — Query timeout
 *   503 — DB connection error
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

const ANOMALY_Z_THRESHOLD = 2.0;
const MIN_HISTORICAL_VALUES = 4;

interface AnomalyResult {
  isAnomaly: boolean;
  currentValue?: number;
  mean?: number;
  stddev?: number;
  zScore?: number;
  direction?: "high" | "low" | "normal";
  explanation?: string;
}

/**
 * Compute z-score anomaly detection.
 * values[0] = current period; values[1..] = historical.
 * Returns { isAnomaly: false } when insufficient data.
 */
export function computeAnomaly(values: number[]): AnomalyResult {
  // values[0] = current period; values[1..] = historical
  if (values.length < MIN_HISTORICAL_VALUES + 1) {
    return { isAnomaly: false };
  }

  const currentValue = values[0];
  const historical = values.slice(1);  // positional — do not filter

  const n = historical.length;
  const mean = historical.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    historical.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);

  // If stddev is zero (all historical values identical), no anomaly possible
  if (stddev === 0) {
    return {
      isAnomaly: false,
      currentValue,
      mean,
      stddev: 0,
      zScore: 0,
      direction: "normal",
      explanation: `El valor actual (${formatNum(currentValue)}) es igual a la media de los últimos ${n} períodos.`,
    };
  }

  const zScore = (currentValue - mean) / stddev;
  const isAnomaly = Math.abs(zScore) > ANOMALY_Z_THRESHOLD;
  const direction: "high" | "low" | "normal" =
    zScore > ANOMALY_Z_THRESHOLD
      ? "high"
      : zScore < -ANOMALY_Z_THRESHOLD
      ? "low"
      : "normal";

  const delta = currentValue - mean;
  const dirText = direction === "high" ? "por encima" : "por debajo";

  const explanation =
    direction !== "normal"
      ? mean !== 0
        ? `El valor actual (${formatNum(currentValue)}) está un ${Math.abs(((delta / Math.abs(mean)) * 100)).toFixed(0)}% ${dirText} de la media de los últimos ${n} períodos (${formatNum(mean)}).`
        : `El valor actual (${formatNum(currentValue)}) está ${dirText} de la media de los últimos ${n} períodos (${formatNum(mean)}), con una diferencia absoluta de ${formatNum(Math.abs(delta))}.`
      : `El valor actual (${formatNum(currentValue)}) está dentro del rango normal (media: ${formatNum(mean)}).`;

  return {
    isAnomaly,
    currentValue,
    mean,
    stddev,
    zScore,
    direction,
    explanation,
  };
}

function formatNum(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      formatApiError("Cuerpo JSON no válido.", "VALIDATION", undefined, requestId),
      { status: 400 }
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      formatApiError(
        "El cuerpo JSON debe ser un objeto.",
        "VALIDATION",
        undefined,
        requestId
      ),
      { status: 400 }
    );
  }

  const { sql } = body as { sql?: string };

  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return NextResponse.json(
      formatApiError(
        "Falta el campo 'sql' o está vacío.",
        "VALIDATION",
        undefined,
        requestId
      ),
      { status: 400 }
    );
  }

  try {
    validateReadOnly(sql);
  } catch (err) {
    if (err instanceof SqlValidationError) {
      return NextResponse.json(
        formatApiError(
          "La consulta contiene operaciones no permitidas (solo se permiten consultas de lectura).",
          "VALIDATION",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 403 }
      );
    }
    throw err;
  }

  try {
    const result = await query(sql);

    if (result.rows.length === 0) {
      return NextResponse.json({ isAnomaly: false });
    }

    // Parse row 0 as the current period value — must be valid numeric.
    // Rows 1..N-1 are historical: nulls/non-numeric are filtered out.
    // We preserve positional alignment so row 0 is always current.
    const currentRaw = result.rows[0][0];
    if (currentRaw === null || currentRaw === undefined) {
      return NextResponse.json({ isAnomaly: false });
    }
    const currentNum = Number(currentRaw);
    if (isNaN(currentNum)) {
      return NextResponse.json({ isAnomaly: false });
    }

    const historical: number[] = [];
    for (const row of result.rows.slice(1)) {
      const raw = row[0];
      if (raw !== null && raw !== undefined) {
        const num = Number(raw);
        if (!isNaN(num)) historical.push(num);
      }
    }

    const values = [currentNum, ...historical];
    const anomaly = computeAnomaly(values);
    return NextResponse.json(anomaly);
  } catch (err) {
    if (err instanceof QueryTimeoutError) {
      console.error(`[${requestId}] Timeout en anomaly-check:`, err);
      return NextResponse.json(
        formatApiError(
          "La consulta excedió el tiempo máximo de espera.",
          "TIMEOUT",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 408 }
      );
    }
    if (err instanceof ConnectionError) {
      console.error(`[${requestId}] Error de conexión en anomaly-check:`, err);
      return NextResponse.json(
        formatApiError(
          "No se pudo conectar a la base de datos.",
          "DB_CONNECTION",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 503 }
      );
    }

    const pgErr = err as { code?: string };
    const code = pgErr.code || "";
    const isPermissionError = code === "42501";
    const isClientError =
      !isPermissionError && (code.startsWith("22") || code.startsWith("42"));

    if (isClientError) {
      return NextResponse.json(
        formatApiError(
          "Error en la consulta SQL. Verifica la sintaxis.",
          "DB_QUERY",
          sanitizeErrorMessage(err),
          requestId
        ),
        { status: 400 }
      );
    }

    console.error(`[${requestId}] Error inesperado en anomaly-check:`, err);
    return NextResponse.json(
      formatApiError(
        "Error inesperado al ejecutar la consulta.",
        "UNKNOWN",
        sanitizeErrorMessage(err),
        requestId
      ),
      { status: 500 }
    );
  }
}
