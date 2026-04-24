/**
 * Dashboard LLM configuration — reads from the central config loader (getSystemConfig),
 * which applies env > config.yaml > schema defaults.
 */

import { getSystemConfig, resetConfigCache } from "@/lib/system-config/loader";
import type { DashboardCliDriverId, DashboardLlmConfig, DashboardLlmProviderId } from "./types";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

function normalizeProvider(raw: string | null | undefined): DashboardLlmProviderId {
  const v = (raw ?? "openrouter").trim().toLowerCase();
  if (v === "" || v === "openrouter") return "openrouter";
  if (v === "cli") return "cli";
  throw new Error(
    `Invalid DASHBOARD_LLM_PROVIDER="${raw ?? ""}". Use "openrouter" or "cli".`,
  );
}

function normalizeDriver(raw: string | null | undefined): DashboardCliDriverId {
  const v = (raw ?? "claude_code").trim().toLowerCase();
  if (v === "claude_code") return "claude_code";
  throw new Error(
    `Invalid DASHBOARD_LLM_CLI_DRIVER="${raw ?? ""}". Supported values: claude_code`,
  );
}

function parseExtraArgs(raw: string | null | undefined): string[] {
  if (!raw || String(raw).trim() === "") return [];
  // Split on whitespace; callers must not pass shell syntax — document in .env.example.
  return String(raw).trim().split(/\s+/).filter(Boolean);
}

function parsePositiveInt(raw: string | number | boolean | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return n;
}

let _cached: DashboardLlmConfig | null = null;

/** Reset memoized config (tests and after config writes).
 *
 * Also clears the system-config cache so that subsequent calls to
 * loadDashboardLlmConfig() re-read from process.env (important for tests
 * that use vi.stubEnv to vary configuration).
 */
export function resetDashboardLlmConfigCache(): void {
  _cached = null;
  resetConfigCache();
}

/**
 * Load dashboard LLM configuration from the central config loader.
 *
 * Precedence (inherited from getSystemConfig): env > config.yaml > schema defaults.
 *
 * Precedence for models:
 * - OpenRouter: dashboard.llm_model_openrouter → dashboard.llm_model (legacy) → default
 * - CLI: dashboard.llm_model_cli → dashboard.llm_model (legacy) → default
 */
export function loadDashboardLlmConfig(): DashboardLlmConfig {
  if (_cached) return _cached;

  const cfg = getSystemConfig();

  const providerRaw = cfg["dashboard.llm_provider"]?.value;
  const provider = normalizeProvider(providerRaw !== null ? String(providerRaw ?? "") : undefined);

  const legacyModel = cfg["dashboard.llm_model"]?.value;
  const legacyModelStr = legacyModel !== null && legacyModel !== undefined ? String(legacyModel).trim() : "";

  const openrouterModelRaw = cfg["dashboard.llm_model_openrouter"]?.value;
  const openrouterModel =
    (openrouterModelRaw !== null && openrouterModelRaw !== undefined ? String(openrouterModelRaw).trim() : "") ||
    legacyModelStr ||
    DEFAULT_MODEL;

  const cliModelRaw = cfg["dashboard.llm_model_cli"]?.value;
  const cliModel =
    (cliModelRaw !== null && cliModelRaw !== undefined ? String(cliModelRaw).trim() : "") ||
    legacyModelStr ||
    DEFAULT_MODEL;

  const cliDriverRaw = cfg["dashboard.llm_cli_driver"]?.value;
  const cliDriver: DashboardCliDriverId =
    provider === "cli"
      ? normalizeDriver(cliDriverRaw !== null && cliDriverRaw !== undefined ? String(cliDriverRaw) : undefined)
      : "claude_code";

  const cliBinRaw =
    (cfg["dashboard.llm_cli_bin"]?.value !== null && cfg["dashboard.llm_cli_bin"]?.value !== undefined
      ? String(cfg["dashboard.llm_cli_bin"].value).trim()
      : "") || "claude";
  if (/[\r\n]/.test(cliBinRaw)) {
    throw new Error("DASHBOARD_LLM_CLI_BIN must not contain newline characters.");
  }
  const cliBin = cliBinRaw;

  const extraArgsRawValue = provider === "cli" ? cfg["dashboard.llm_cli_extra_args"]?.value : null;
  const extraArgsRaw =
    extraArgsRawValue !== null && extraArgsRawValue !== undefined
      ? String(extraArgsRawValue)
      : undefined;
  const cliExtraArgs = parseExtraArgs(extraArgsRaw);

  const timeoutRaw = provider === "cli" ? cfg["dashboard.llm_cli_timeout_ms"]?.value : undefined;
  const cliTimeoutMs = parsePositiveInt(timeoutRaw, 120_000);

  const captureRaw = provider === "cli" ? cfg["dashboard.llm_cli_max_capture_bytes"]?.value : undefined;
  const cliMaxCaptureBytes = parsePositiveInt(captureRaw, 8_000_000);

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
