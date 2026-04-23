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

  it("getEffectiveDashboardModel picks cli model when provider is cli", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_LLM_MODEL_CLI", "m-cli");
    vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "m-or");
    const c = loadDashboardLlmConfig();
    expect(getEffectiveDashboardModel(c)).toBe("m-cli");
  });
});
