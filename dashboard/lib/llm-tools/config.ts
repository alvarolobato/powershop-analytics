/**
 * Agentic tool-calling limits (Dashboard App).
 *
 * Values resolve through the central config loader, i.e. env var >
 * config.yaml > schema default (D-023). Every key below is declared in
 * `config/schema.yaml` under the "Agentic" section with the same env name, so
 * the loader owns the precedence and this file only reads the result.
 *
 * This used to read `process.env` directly and nothing else. The keys were
 * still advertised in `config/schema.yaml` (with `requires_restart: []`) and
 * still writable from the admin UI, so raising a limit there wrote it to
 * config.yaml, reported success, and changed nothing — the code never looked
 * at the file. Production ran the hardcoded 8 rounds / 24 calls for months
 * while config.yaml said 40 / 100, and the only way to notice was that the
 * cap-exceeded errors embedded the old numbers (`llm_errors.limits` =
 * `{"maxRounds": 8, "maxToolCalls": 24}`). Found 2026-08-29 while auditing
 * production conversations.
 */

import { readConfigString as readRaw } from "@/lib/system-config/read";

function readInt(name: string, key: string, fallback: number): number {
  const raw = readRaw(name, key);
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readBool(name: string, key: string, defaultTrue: boolean): boolean {
  const raw = readRaw(name, key)?.toLowerCase();
  if (raw === undefined || raw === "") return defaultTrue;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return defaultTrue;
}

export function isAgenticToolsEnabled(): boolean {
  return readBool("DASHBOARD_AGENTIC_TOOLS_ENABLED", "dashboard.agentic_tools_enabled", true);
}

export function getAgenticConfig() {
  return {
    // Dashboard generation often needs several explore→SQL rounds; defaults are conservative caps.
    maxToolRounds: readInt("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "dashboard.agentic_max_tool_rounds", 8),
    maxToolCalls: readInt("DASHBOARD_AGENTIC_MAX_TOOL_CALLS", "dashboard.agentic_max_tool_calls", 24),
    toolTimeoutMs: readInt("DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS", "dashboard.agentic_tool_timeout_ms", 15_000),
    maxRows: readInt("DASHBOARD_AGENTIC_MAX_ROWS", "dashboard.agentic_max_rows", 200),
    maxColumns: readInt("DASHBOARD_AGENTIC_MAX_COLUMNS", "dashboard.agentic_max_columns", 30),
    maxResultChars: readInt("DASHBOARD_AGENTIC_MAX_RESULT_CHARS", "dashboard.agentic_max_result_chars", 20_000),
  };
}

/**
 * Output-token budget for one LLM call, for EVERY flow.
 *
 * Read here rather than hardcoded at call sites so it resolves through the
 * usual env > config.yaml > default chain and can be retuned from the admin UI
 * without a deploy — the right value depends on how verbose the configured
 * model's reasoning is, and the dashboard targets three model families.
 *
 * `assembleRequest` uses this as its default, so there is ONE number rather
 * than a schema default and a separate hardcoded 8192 drifting apart. An
 * earlier revision scoped this to free chat only, which meant an operator
 * raising it because dashboard GENERATION was truncating got no effect.
 */
export function getLlmMaxOutputTokens(): number {
  return readInt("DASHBOARD_LLM_MAX_OUTPUT_TOKENS", "dashboard.llm_max_output_tokens", 8192);
}
