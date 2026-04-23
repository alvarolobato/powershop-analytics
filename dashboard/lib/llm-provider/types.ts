/**
 * Dashboard LLM transport types (OpenRouter HTTP vs local CLI agents).
 */

export type DashboardLlmProviderId = "openrouter" | "cli";

/** First-class CLI driver; add new ids when wiring another binary. */
export type DashboardCliDriverId = "claude_code";

export interface DashboardLlmConfig {
  provider: DashboardLlmProviderId;
  /** Model id for OpenRouter chat completions. */
  openrouterModel: string;
  /** Model id / flag value for the active CLI driver (driver-specific). */
  cliModel: string;
  cliDriver: DashboardCliDriverId;
  /** argv[0] — must be a single path or binary name, no shell metacharacters. */
  cliBin: string;
  /** Extra CLI arguments inserted after argv[0], before driver-specific flags. */
  cliExtraArgs: string[];
  cliTimeoutMs: number;
  /** Max captured stdout/stderr per CLI invocation (bytes). */
  cliMaxCaptureBytes: number;
}

export interface LlmUsageProviderMeta {
  provider: DashboardLlmProviderId;
  driver: DashboardCliDriverId | null;
}
