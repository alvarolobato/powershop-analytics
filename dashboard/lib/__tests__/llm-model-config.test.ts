import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getDashboardLlmModel,
  getDashboardLlmDisplayConfig,
  resetDashboardLlmConfigCache,
} from "@/lib/llm-model-config";

describe("dashboard LLM model config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDashboardLlmConfigCache();
  });

  it("returns OpenRouter model from DASHBOARD_LLM_MODEL_OPENROUTER when set", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
    vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "openai/gpt-4o");
    delete process.env.DASHBOARD_LLM_MODEL;
    expect(getDashboardLlmModel()).toBe("openai/gpt-4o");
  });

  it("falls back to DASHBOARD_LLM_MODEL for OpenRouter when OPENROUTER-specific unset", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
    delete process.env.DASHBOARD_LLM_MODEL_OPENROUTER;
    vi.stubEnv("DASHBOARD_LLM_MODEL", "legacy/model");
    expect(getDashboardLlmModel()).toBe("legacy/model");
  });

  it("returns CLI model from DASHBOARD_LLM_MODEL_CLI when provider is cli", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_LLM_MODEL_CLI", "sonnet");
    delete process.env.DASHBOARD_LLM_MODEL;
    expect(getDashboardLlmModel()).toBe("sonnet");
  });

  it("returns default when env unset (openrouter)", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
    delete process.env.DASHBOARD_LLM_MODEL;
    delete process.env.DASHBOARD_LLM_MODEL_OPENROUTER;
    expect(getDashboardLlmModel()).toBe("anthropic/claude-sonnet-4");
  });

  it("getDashboardLlmDisplayConfig exposes both backend models", () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "openrouter");
    vi.stubEnv("DASHBOARD_LLM_MODEL_OPENROUTER", "a/b");
    vi.stubEnv("DASHBOARD_LLM_MODEL_CLI", "c/d");
    const c = getDashboardLlmDisplayConfig();
    expect(c.provider).toBe("openrouter");
    expect(c.openrouterModel).toBe("a/b");
    expect(c.cliModel).toBe("c/d");
    expect(c.cliDriver).toBe("claude_code");
  });
});
