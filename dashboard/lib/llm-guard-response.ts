/**
 * Shared classification for the small set of "guard" errors that stop an LLM
 * call for a reason that is not a model/API fault — the daily spend cap
 * tripping (`BudgetExceededError`) or the circuit breaker being open
 * (`CircuitBreakerOpenError`).
 *
 * Before this module every LLM-facing route classified these inline and
 * independently: `llm-error-payload.ts` (generate/modify/analyze),
 * `review/generate`'s two catch blocks (streaming + non-streaming), and
 * `dashboard/gaps` and `dashboard/suggest`. Four to six copies that had
 * already drifted — `review/generate` and the gaps/suggest routes checked
 * `BudgetExceededError` but never `CircuitBreakerOpenError`, so an open
 * breaker fell through their generic-`Error` branch to a bare 500
 * `UNKNOWN`/`LLM_ERROR` instead of the 503 `LLM_CIRCUIT_OPEN` the
 * generate/modify/analyze routes already gave it. Now that the CLI
 * provider's calls are metered and budget-checked like OpenRouter's (see
 * `llm-usage.ts`), that inconsistency reaches the CLI path too — a route
 * that forgot the check silently returns a generic-looking failure for what
 * is actually a deliberate cost guard.
 *
 * `LLM_DISABLED` and `LLM_QUOTA_EXCEEDED` are reserved codes in
 * `lib/errors.ts` with no producer yet — a later change adds the master
 * kill switch and the CLI subscription-quota cap. When it does, their error
 * classes get a case in `classifyGuardError` below so every call site that
 * already goes through `guardErrorResponse` (or the SSE variant) picks them
 * up without a second sweep across these routes.
 */

import { NextResponse } from "next/server";
import { formatApiError, sanitizeErrorMessage, type ApiErrorResponse, type ErrorCode } from "@/lib/errors";
import { BudgetExceededError, CircuitBreakerOpenError } from "@/lib/llm";

export interface ClassifiedGuardError {
  status: number;
  code: ErrorCode;
  /** User-facing Spanish message. */
  message: string;
  /** Sanitized technical detail, suitable for `ApiErrorResponse.details`. */
  details?: string;
}

/**
 * Classify a guard error, or return `null` so the caller's own catch chain
 * continues — an error this module doesn't recognise is not its concern.
 */
export function classifyGuardError(err: unknown): ClassifiedGuardError | null {
  if (err instanceof BudgetExceededError) {
    return { status: 429, code: "LLM_BUDGET_EXCEEDED", message: err.message };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return {
      status: 503,
      code: "LLM_CIRCUIT_OPEN",
      message: err.message,
      details: sanitizeErrorMessage(err),
    };
  }
  return null;
}

/**
 * REST-route convenience: classify `err` and, if it is a guard error, return
 * the ready-to-send `NextResponse`. Returns `null` for anything else so the
 * route's existing catch chain keeps going.
 */
export function guardErrorResponse(err: unknown, requestId: string): NextResponse<ApiErrorResponse> | null {
  const classified = classifyGuardError(err);
  if (!classified) return null;
  return NextResponse.json(
    formatApiError(classified.message, classified.code, classified.details, requestId),
    { status: classified.status },
  );
}
