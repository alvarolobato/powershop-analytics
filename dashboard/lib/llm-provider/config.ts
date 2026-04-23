/**
 * Env-driven dashboard LLM configuration (provider, per-backend models, CLI knobs).
 */

import type { DashboardCliDriverId, DashboardLlmConfig, DashboardLlmProviderId } from "./types";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

function normalizeProvider(raw: string | undefined): DashboardLlmProviderId {
  const v = (raw ?? "openrouter").trim().toLowerCase();
  if (v === "" || v === "openrouter") return "openrouter";
  if (v === "cli") return "cli";
  throw new Error(
    `Invalid DASHBOARD_LLM_PROVIDER="${raw ?? ""}". Use "openrouter" or "cli".`,
  );
}

function normalizeDriver(raw: string | undefined): DashboardCliDriverId {
  const v = (raw ?? "claude_code").trim().toLowerCase();
  if (v === "claude_code") return "claude_code";
  throw new Error(
    `Invalid DASHBOARD_LLM_CLI_DRIVER="${raw ?? ""}". Supported values: claude_code`,
  );
}

function parseExtraArgs(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  // Split on whitespace; callers must not pass shell syntax — document in .env.example.
  return raw.trim().split(/\s+/).filter(Boolean);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return n;
}

let _cached: DashboardLlmConfig | null = null;

/** Reset memoized config (tests). */
export function resetDashboardLlmConfigCache(): void {
  _cached = null;
}

/**
 * Load dashboard LLM configuration from environment.
 *
 * Precedence for models:
 * - OpenRouter: DASHBOARD_LLM_MODEL_OPENROUTER → DASHBOARD_LLM_MODEL (legacy) → default
 * - CLI: DASHBOARD_LLM_MODEL_CLI → DASHBOARD_LLM_MODEL (legacy) → default
 */
export function loadDashboardLlmConfig(): DashboardLlmConfig {
  if (_cached) return _cached;

  const provider = normalizeProvider(process.env.DASHBOARD_LLM_PROVIDER);
  const openrouterModel =
    process.env.DASHBOARD_LLM_MODEL_OPENROUTER?.trim() ||
    process.env.DASHBOARD_LLM_MODEL?.trim() ||
    DEFAULT_MODEL;
  const cliModel =
    process.env.DASHBOARD_LLM_MODEL_CLI?.trim() ||
    process.env.DASHBOARD_LLM_MODEL?.trim() ||
    DEFAULT_MODEL;

  const cliDriver = normalizeDriver(process.env.DASHBOARD_LLM_CLI_DRIVER);
  const cliBinRaw = (process.env.DASHBOARD_LLM_CLI_BIN ?? "claude").trim() || "claude";
  if (/[\r\n]/.test(cliBinRaw)) {
    throw new Error("DASHBOARD_LLM_CLI_BIN must not contain newline characters.");
  }
  const cliBin = cliBinRaw;
  const cliExtraArgs = parseExtraArgs(process.env.DASHBOARD_LLM_CLI_EXTRA_ARGS);
  const cliTimeoutMs = parsePositiveInt(process.env.DASHBOARD_LLM_CLI_TIMEOUT_MS, 120_000);
  const cliMaxCaptureBytes = parsePositiveInt(
    process.env.DASHBOARD_LLM_CLI_MAX_CAPTURE_BYTES,
    8_000_000,
  );

  _cached = {
    provider,
    openrouterModel,
    cliModel,
    cliDriver,
    cliBin,
    cliExtraArgs,
    cliTimeoutMs,
    cliMaxCaptureBytes,
  };
  return _cached;
}

/** Effective model id for the configured provider (for OpenRouter API or CLI --model). */
export function getEffectiveDashboardModel(cfg: DashboardLlmConfig): string {
  return cfg.provider === "openrouter" ? cfg.openrouterModel : cfg.cliModel;
}
