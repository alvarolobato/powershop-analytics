/**
 * Shared error utilities for the Dashboard App API layer.
 *
 * Provides:
 *   - ErrorCode enum for all known error categories
 *   - ApiErrorResponse — the standard shape returned by all API error responses
 *   - formatApiError() — builds a standard error response object
 *   - generateRequestId() — produces a short correlation ID for log tracing
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "DB_CONNECTION"
  | "DB_QUERY"
  | "LLM_ERROR"
  | "LLM_RATE_LIMIT"
  | "LLM_INVALID_RESPONSE"
  | "VALIDATION"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// Standard API error response shape
// ---------------------------------------------------------------------------

export interface ApiErrorResponse {
  /** User-facing message in Spanish. */
  error: string;
  /** Machine-readable error code. */
  code: ErrorCode;
  /** Sanitized technical detail — no credentials, no PII. */
  details?: string;
  /** ISO timestamp of the error. */
  timestamp: string;
  /** Correlation ID for matching frontend error to server log. */
  requestId: string;
}

// ---------------------------------------------------------------------------
// generateRequestId
// ---------------------------------------------------------------------------

/**
 * Generates a short request ID suitable for log correlation.
 * Uses crypto.randomUUID() (Node 19+ / browsers) when available,
 * falling back to Math.random() to avoid breaking test environments.
 * Example: "req_a3f2c9b8"
 */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  }
  // Fallback for environments where crypto.randomUUID is unavailable
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// formatApiError
// ---------------------------------------------------------------------------

/**
 * Builds a standard API error response object.
 *
 * @param error  - User-facing Spanish message (always visible to the user).
 * @param code   - Machine-readable error code.
 * @param details - Sanitized technical context (optional, no credentials/PII).
 * @param requestId - Correlation ID (auto-generated if omitted).
 */
export function formatApiError(
  error: string,
  code: ErrorCode,
  details?: string,
  requestId?: string,
): ApiErrorResponse {
  return {
    error,
    code,
    ...(details !== undefined ? { details } : {}),
    timestamp: new Date().toISOString(),
    requestId: requestId ?? generateRequestId(),
  };
}

// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

/**
 * Returns a sanitized version of an error message suitable for `details`.
 * Strips connection strings, passwords, and similar sensitive patterns.
 */
export function sanitizeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Redact anything that looks like a DSN / password
  return message
    .replace(/postgresql:\/\/[^\s]*/gi, "[DSN redacted]")
    .replace(/password=[^\s&]*/gi, "password=[redacted]")
    .replace(/:[^@]*@/g, ":[redacted]@")
    .slice(0, 500);
}
