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
  | "LLM_BUDGET_EXCEEDED"
  | "LLM_CIRCUIT_OPEN"
  | "LLM_INVALID_RESPONSE"
  | "VALIDATION"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "COST_LIMIT"
  | "REVIEW_EXISTS"
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
  /** When code is REVIEW_EXISTS — id of the saved review for that week. */
  existing_id?: number;
  /** When code is REVIEW_EXISTS — Monday (YYYY-MM-DD) of the reviewed week. */
  week_start?: string;
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
// isApiErrorResponse — type guard
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true only when the value looks like a well-formed
 * ApiErrorResponse (has all required string fields).
 * Use this instead of loose `"code" in obj` checks to avoid false positives.
 */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.error === "string" &&
    typeof v.code === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.requestId === "string" &&
    // details must be absent or a string (never an object/array)
    (v.details === undefined || typeof v.details === "string") &&
    (v.existing_id === undefined || typeof v.existing_id === "number") &&
    (v.week_start === undefined || typeof v.week_start === "string")
  );
}

// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

/**
 * Returns a sanitized version of an error message suitable for `details`.
 * Strips connection strings, passwords, API keys, email-like patterns,
 * and other potentially sensitive content.
 *
 * NOTE: This sanitization is best-effort. For errors that may contain PII
 * (e.g. DB query errors that echo back SQL parameters), prefer passing
 * `undefined` as details rather than this helper.
 */
export function sanitizeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    // Redact DSN/connection strings (postgresql:// and postgres://)
    .replace(/postgres(?:ql)?:\/\/[^\s]*/gi, "[DSN redacted]")
    // Redact password fields
    .replace(/password=[^\s&]*/gi, "password=[redacted]")
    // Redact user:pass@host patterns
    .replace(/:[^@\s]*@/g, ":[redacted]@")
    // Redact Bearer/API tokens
    .replace(/\bbearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9]+/g, "[API key redacted]")
    // Redact email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email redacted]")
    .slice(0, 300);
}
