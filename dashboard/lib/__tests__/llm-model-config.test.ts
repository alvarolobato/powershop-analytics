import { describe, it, expect, afterEach, vi } from "vitest";
import { getDashboardLlmModel } from "@/lib/llm-model-config";

describe("getDashboardLlmModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns env override when set", () => {
    vi.stubEnv("DASHBOARD_LLM_MODEL", "openai/gpt-4o");
    expect(getDashboardLlmModel()).toBe("openai/gpt-4o");
  });

  it("returns default when env unset", () => {
    delete process.env.DASHBOARD_LLM_MODEL;
    expect(getDashboardLlmModel()).toBe("anthropic/claude-sonnet-4");
  });
});
