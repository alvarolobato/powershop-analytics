/**
 * Dashboard LLM model id (OpenRouter). Kept in a tiny module so admin pages can
 * display the effective model without importing the full OpenAI client stack.
 */

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

export function getDashboardLlmModel(): string {
  return process.env.DASHBOARD_LLM_MODEL || DEFAULT_MODEL;
}
