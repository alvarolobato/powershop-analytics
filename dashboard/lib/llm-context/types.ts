/**
 * FlowVars — per-flow inputs for buildSystemPrompt() / assembleRequest().
 *
 * All fields are optional; each flow only uses the subset relevant to it.
 */

export interface FlowVars {
  // ── modify ─────────────────────────────────────────────────────────────────
  /** Serialised JSON of the current dashboard spec (modify flow). */
  currentSpec?: string;
  /** When true the modify prompt includes publish-tool workflow instructions. */
  agenticMode?: boolean;

  // ── analyze ────────────────────────────────────────────────────────────────
  /** Formatted widget data string from serializeWidgetData(). */
  serializedData?: string;
  /** Optional preset action that drives specific analysis instructions. */
  action?: string;
  /** When set the model may reference dashboard tools with this id. */
  dashboardId?: number;

  // ── suggest ────────────────────────────────────────────────────────────────
  /** User role (e.g. "Director de ventas"). */
  role?: string;
  /** Existing dashboards to avoid overlap in suggestions. */
  existingDashboards?: Array<{
    title: string;
    description: string;
    widgetTitles?: string[];
  }>;

  // ── weekly review ──────────────────────────────────────────────────────────
  /** Formatted SQL query results for the weekly review. */
  queryResults?: string;
  /** Spanish description of the reviewed week (e.g. "Semana 2026-01-01 a …"). */
  reviewedWeekDescription?: string;
  /** Controls the review generation angle. */
  generationMode?: "initial" | "refresh_data" | "alternate_angle";
}

// ── Flow name registry ────────────────────────────────────────────────────────

/**
 * Every flow name `buildSystemPrompt()` / `toolsForFlow()` know how to build a
 * real prompt/tool catalog for. `assembleRequest()`'s `flow` parameter stays a
 * plain `string` (callers pass DB-derived values like `conversation.mode`
 * that TypeScript cannot narrow at the call site), but `buildSystemPrompt`'s
 * internal switch is exhaustive over this union — see its `default` branch.
 * Adding a flow here without a matching `case` fails to compile, which is the
 * point: it forces a deliberate decision (add the prompt, or don't add the
 * flow) instead of a silent empty-prompt fallback (D-045).
 */
export const LLM_FLOWS = [
  "generate",
  "modify",
  "analyze",
  "suggest",
  "gap",
  "weekly",
  "chat",
  "summary",
  "title",
] as const;

export type LlmFlow = (typeof LLM_FLOWS)[number];

/** Narrows a raw string (e.g. `conversation.mode`) to `LlmFlow`. */
export function isLlmFlow(flow: string): flow is LlmFlow {
  return (LLM_FLOWS as readonly string[]).includes(flow);
}
