import { describe, it, expect, afterEach, vi } from "vitest";
import {
  loadDashboardLlmConfig,
  resetDashboardLlmConfigCache,
  getEffectiveDashboardModel,
} from "@/lib/llm-provider/config";

describe("loadDashboardLlmConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDashboardLlmConfigCache();
  });

  it("throws on unknown CLI driver", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_LLM_CLI_DRIVER", "unknown_agent");
    expect(() => loadDashboardLlmConfig()).toThrow(/Invalid DASHBOARD_LLM_CLI_DRIVER/);
  });

  it("throws on invalid DASHBOARD_LLM_PROVIDER value", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "lambda");
    expect(() => loadDashboardLlmConfig()).toThrow(/Invalid DASHBOARD_LLM_PROVIDER/);
  });

  it("rejects newline in DASHBOARD_LLM_CLI_BIN", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_LLM_CLI_BIN", "claude\n--evil");
    expect(() => loadDashboardLlmConfig()).toThrow(/newline/);
  });

  it("getEffectiveDashboardModel picks cli model when provider is cli", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_LLM_MODEL_CLI", "m-cli");
    vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "m-or");
    const c = loadDashboardLlmConfig();
    expect(getEffectiveDashboardModel(c)).toBe("m-cli");
  });
});
