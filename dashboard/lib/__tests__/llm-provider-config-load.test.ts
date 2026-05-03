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
    // The central config loader (getSystemConfig) validates enum values at the schema
    // level and throws before normalizeProvider is called. Accept either error message.
    expect(() => loadDashboardLlmConfig()).toThrow(
      /Invalid DASHBOARD_LLM_PROVIDER|is not one of/,
    );
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

  it("does not validate CLI driver when provider is openrouter", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
    vi.stubEnv("DASHBOARD_LLM_CLI_DRIVER", "totally_invalid");
    const c = loadDashboardLlmConfig();
    expect(c.cliDriver).toBe("claude_code");
  });

  describe("per-flow OpenRouter model overrides", () => {
    it("uses the per-flow override when set", () => {
      vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "default-or");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER_MODIFY", "claude-opus-4");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER_ANALYZE", "claude-haiku-4");
      const c = loadDashboardLlmConfig();
      expect(getEffectiveDashboardModel(c, "modify")).toBe("claude-opus-4");
      expect(getEffectiveDashboardModel(c, "analyze")).toBe("claude-haiku-4");
    });

    it("falls back to llm_model_openrouter when the per-flow override is empty", () => {
      vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "default-or");
      const c = loadDashboardLlmConfig();
      expect(getEffectiveDashboardModel(c, "modify")).toBe("default-or");
      expect(getEffectiveDashboardModel(c, "weekly")).toBe("default-or");
    });

    it("ignores the per-flow override on the cli provider", () => {
      vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
      vi.stubEnv("DASHBOARD_LLM_MODEL_CLI", "m-cli");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER_MODIFY", "claude-opus-4");
      const c = loadDashboardLlmConfig();
      expect(getEffectiveDashboardModel(c, "modify")).toBe("m-cli");
    });

    it("returns llm_model_openrouter when called without a flow", () => {
      vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "default-or");
      vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER_GENERATE", "claude-sonnet-4");
      const c = loadDashboardLlmConfig();
      expect(getEffectiveDashboardModel(c)).toBe("default-or");
    });
  });
});
