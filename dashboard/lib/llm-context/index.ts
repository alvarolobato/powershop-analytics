/**
 * Public API for the llm-context module.
 *
 * All LLM calls in the dashboard must go through `assembleRequest()`.
 * CI enforces this via `dashboard/scripts/check-llm-context.sh`.
 */

export {
  assembleRequest,
  type AssembleResult,
  type AssembleExecutionOpts,
  type FlowVars,
  type HistoryMessage,
} from "./assemble";

export {
  buildSystemPrompt,
  buildGeneratePromptSplit,
  buildModifyPromptSplit,
  buildAnalyzePrompt,
  buildSuggestionPrompt,
  buildSuggestPrompt,
  buildGapAnalysisPrompt,
  buildReviewPrompt,
  buildFreeChatContext,
  buildAgenticToolPreamble,
  type FreeChatContext,
  type AnalyzeAction,
  type BuildAnalyzePromptOptions,
  VALID_ANALYZE_ACTIONS,
} from "./system-prompt";

export { buildHistory } from "./history";
export { loadPriorTurns, summariseOldTurns } from "./history";

export { toolsForFlow } from "./tools";

export {
  formatSchema,
  formatRelationships,
  formatInstructions,
  formatSqlPairs,
} from "./formatters";
