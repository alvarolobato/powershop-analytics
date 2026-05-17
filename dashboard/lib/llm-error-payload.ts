/**
 * Shared LLM error classification helper.
 *
 * Centralises the error-type → HTTP status + error code mapping so the three
 * API routes (generate, modify, analyze) stay in lock-step without duplicating
 * the same switch logic.
 */

import {
  AgenticRunnerError,
  BudgetExceededError,
  CircuitBreakerOpenError,
} from "@/lib/llm";
import type { ErrorCode } from "@/lib/errors";

export interface ClassifiedLlmError {
  status: number;
  code: ErrorCode;
  userMessage: string;
}

/**
 * Classify an unknown LLM error into an HTTP status code, a machine-readable
 * error code, and a user-facing Spanish message.
 *
 * The `requestId` parameter is accepted for call-site consistency but is not
 * used directly here; the caller is responsible for threading it into the
 * `formatApiError()` call.
 */
export function classifyLlmError(
  err: unknown,
  _requestId: string,
): ClassifiedLlmError {
  if (err instanceof AgenticRunnerError) {
    return {
      status: 500,
      code: "AGENTIC_RUNNER",
      userMessage:
        "El flujo de IA con herramientas alcanzó un límite o no pudo completarse. Inténtalo de nuevo.",
    };
  }

  if (err instanceof BudgetExceededError) {
    return {
      status: 429,
      code: "LLM_BUDGET_EXCEEDED",
      userMessage: err.message,
    };
  }

  if (err instanceof CircuitBreakerOpenError) {
    return {
      status: 503,
      code: "LLM_CIRCUIT_OPEN",
      userMessage: err.message,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  const normalizedMessage = message.toLowerCase();
  // Use specific phrases to avoid matching unrelated words ("generate", "moderate").
  const isRateLimit =
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("ratelimit") ||
    normalizedMessage.includes("429");

  if (isRateLimit) {
    return {
      status: 429,
      code: "LLM_RATE_LIMIT",
      userMessage:
        "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.",
    };
  }

  return {
    status: 500,
    code: "LLM_ERROR",
    userMessage: "Error del modelo de IA. Inténtalo de nuevo.",
  };
}
