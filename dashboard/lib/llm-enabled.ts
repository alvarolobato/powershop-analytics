/**
 * The master LLM kill switch (`dashboard.llm_enabled`).
 *
 * ## Why this exists
 *
 * Before this switch, "turn the AI off" had no single answer.
 * `dashboard.agentic_tools_enabled` stops the tool-calling loop for
 * generate/modify/analyze — it does not stop those flows from making a
 * single-shot call instead, and it does nothing for chat, suggest, gap, or
 * the weekly review. There was no key that meant "make zero model calls,
 * full stop."
 *
 * ## Where it is enforced
 *
 * At the two seams every LLM call in the dashboard passes through (D-036):
 * `llmComplete` (single-shot — top of the function, before provider
 * selection) and `assembleRequest`'s agentic branch (top of the
 * `isAgenticToolsEnabled() && tools.length > 0` block, before the adapter is
 * built). CI forbids importing `llmComplete`/`runAgenticChat` anywhere else
 * (`dashboard/scripts/check-llm-context.sh`), so guarding those two covers
 * every call routed through them.
 *
 * That is NOT the whole surface, and an earlier version of this comment
 * wrongly claimed it was ("there is no third path to forget"). There is one:
 * `llm-context/history.ts`'s `buildSummary()` calls `claudeCliSingleShot` /
 * `openRouterChatCompletion` directly. The boundary script cannot catch it,
 * because it exempts files inside `llm-context/` — the very directory that
 * exemption exists to let call the providers. That path checks
 * `isLlmEnabled()` itself; see the comment there.
 *
 * So the invariant is: anything inside `llm-context/` that reaches a provider
 * without going through `llmComplete` must call `isLlmEnabled()` explicitly.
 * A switch you cannot trust completely is worse than none, because you stop
 * checking.
 *
 * Read fresh on each call (via the memoized `getSystemConfig()` loader)
 * rather than captured at import time, so flipping it in `/admin/config`
 * takes effect on the very next call.
 */

import { getSystemConfig } from "@/lib/system-config/loader";

/**
 * Raised instead of calling the model when `dashboard.llm_enabled` is false.
 *
 * `name` is set explicitly so callers (and `classifyGuardError` in
 * `llm-guard-response.ts`) can match on it without an import cycle.
 */
export class LlmDisabledError extends Error {
  constructor() {
    super(
      "La IA del dashboard está desactivada (dashboard.llm_enabled = false). " +
        "Actívala en /admin/config para volver a permitir llamadas al modelo.",
    );
    this.name = "LlmDisabledError";
  }
}

/**
 * Is the LLM allowed to be called at all?
 *
 * Fails OPEN (returns `true`) when the config loader is unavailable — a
 * build context or a missing/unreadable schema file must not silently
 * disable the product. The switch is for deliberate operator intent, not
 * for a degraded environment.
 */
export function isLlmEnabled(): boolean {
  let raw: unknown;
  try {
    raw = getSystemConfig()["dashboard.llm_enabled"]?.value;
  } catch {
    return true;
  }
  // `type: bool` schema entries already coerce to a real boolean at the
  // loader layer (see `system-config/loader.ts`'s `coerce`); the string
  // fallback below only matters if `raw` somehow bypassed that coercion.
  if (raw === null || raw === undefined || String(raw).trim() === "") return true;
  if (typeof raw === "boolean") return raw;
  const v = String(raw).trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "no");
}

/** Throw `LlmDisabledError` when the switch is off. Call before any model call. */
export function assertLlmEnabled(): void {
  if (!isLlmEnabled()) throw new LlmDisabledError();
}
