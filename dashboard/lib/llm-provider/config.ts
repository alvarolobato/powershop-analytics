/**
 * Dashboard LLM configuration — reads from the central config loader (getSystemConfig),
 * which applies env > config.yaml > schema defaults.
 */

import { getSystemConfig, resetConfigCache } from "@/lib/system-config/loader";
import type {
  DashboardCliDriverId,
  DashboardLlmConfig,
  DashboardLlmFlow,
  DashboardLlmProviderId,
} from "./types";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

function normalizeProvider(raw: string | null | undefined): DashboardLlmProviderId {
  // Default is `cli` (config/schema.yaml). The CLI provider uses host claude
  // via the launchd-managed credentials snapshot — see issue #440 / D-025.
  const v = (raw ?? "cli").trim().toLowerCase();
  if (v === "" || v === "cli") return "cli";
  if (v === "openrouter") return "openrouter";
  throw new Error(
    `Invalid DASHBOARD_LLM_PROVIDER="${raw ?? ""}". Use "cli" or "openrouter".`,
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
 * - OpenRouter: per-flow override (llm_model_openrouter_<flow>)
 *               → dashboard.llm_model_openrouter
 *               → dashboard.llm_model (legacy)
 *               → default
 *   The per-flow value is captured raw so callers can decide whether to
 *   apply the override; the resolver `getEffectiveDashboardModel(cfg, flow)`
 *   handles the cascade.
 * - CLI: dashboard.llm_model_cli → dashboard.llm_model (legacy) → default
 */
function readStr(cfg: ReturnType<typeof getSystemConfig>, key: string): string {
  const v = cfg[key]?.value;
  return v !== null && v !== undefined ? String(v).trim() : "";
}

export function loadDashboardLlmConfig(): DashboardLlmConfig {
  if (_cached) return _cached;

  const cfg = getSystemConfig();

  const providerRaw = cfg["dashboard.llm_provider"]?.value;
  const provider = normalizeProvider(providerRaw !== null ? String(providerRaw ?? "") : undefined);

  const legacyModelStr = readStr(cfg, "dashboard.llm_model");

  const openrouterModel =
    readStr(cfg, "dashboard.llm_model_openrouter") || legacyModelStr || DEFAULT_MODEL;

  // Per-flow OpenRouter overrides. Empty string means "no override" — the
  // resolver will fall back to openrouterModel.
  const openrouterModelByFlow: Record<DashboardLlmFlow, string> = {
    generate: readStr(cfg, "dashboard.llm_model_openrouter_generate"),
    modify: readStr(cfg, "dashboard.llm_model_openrouter_modify"),
    analyze: readStr(cfg, "dashboard.llm_model_openrouter_analyze"),
    weekly: readStr(cfg, "dashboard.llm_model_openrouter_weekly"),
  };

  const cliModel = readStr(cfg, "dashboard.llm_model_cli") || legacyModelStr || DEFAULT_MODEL;

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
    openrouterModelByFlow,
    cliModel,
    cliDriver,
    cliBin,
    cliExtraArgs,
    cliTimeoutMs,
    cliMaxCaptureBytes,
  };
  return _cached;
}

/**
 * Effective model id for the configured provider.
 *
 * For OpenRouter, when `flow` is supplied, a non-empty per-flow override
 * (e.g. `dashboard.llm_model_openrouter_modify`) wins over the default
 * `openrouterModel`. CLI doesn't differentiate by flow — the flat-rate
 * Claude subscription makes per-flow tuning pointless.
 */
export function getEffectiveDashboardModel(
  cfg: DashboardLlmConfig,
  flow?: DashboardLlmFlow,
): string {
  if (cfg.provider !== "openrouter") return cfg.cliModel;
  if (flow) {
    const override = cfg.openrouterModelByFlow[flow];
    if (override) return override;
  }
  return cfg.openrouterModel;
}
