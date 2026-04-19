/**
 * LLM usage logging and budget enforcement.
 *
 * Full implementation: Task 2 of issue #249.
 * This stub exports BudgetExceededError for use by API routes (Task 4).
 */

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}
