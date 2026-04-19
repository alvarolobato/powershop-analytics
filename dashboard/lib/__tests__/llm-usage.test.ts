import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSql = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db-write", () => ({ sql: mockSql }));

import {
  BudgetExceededError,
  logUsage,
  checkDailyBudget,
} from "../llm-usage";

describe("BudgetExceededError", () => {
  it("has the correct message", () => {
    const err = new BudgetExceededError();
    expect(err.message).toBe(
      "Límite diario de generación alcanzado. Reintente mañana.",
    );
  });

  it("is an instance of Error", () => {
    expect(new BudgetExceededError()).toBeInstanceOf(Error);
  });
});

describe("logUsage", () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it("fires an INSERT without throwing", () => {
    mockSql.mockResolvedValue([]);
    expect(() =>
      logUsage("generateDashboard", "anthropic/claude-sonnet-4", {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
      }),
    ).not.toThrow();
  });

  it("calculates cost using claude-sonnet-4 rates", async () => {
    mockSql.mockResolvedValue([]);
    logUsage("generateDashboard", "anthropic/claude-sonnet-4", {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
    });
    // Wait for the microtask to flush
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSql).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO llm_usage"),
      expect.arrayContaining([
        "generateDashboard",
        "anthropic/claude-sonnet-4",
        1_000_000,
        1_000_000,
        2_000_000,
        18.0, // $3 prompt + $15 completion
      ]),
    );
  });

  it("uses default rate for unknown model", async () => {
    mockSql.mockResolvedValue([]);
    logUsage("testEndpoint", "unknown/model", {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      total_tokens: 1_000_000,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSql).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([3.0]), // default prompt rate
    );
  });

  it("does not throw when sql rejects", async () => {
    mockSql.mockRejectedValue(new Error("DB error"));
    expect(() =>
      logUsage("ep", "anthropic/claude-sonnet-4", {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // Just verifies no unhandled rejection propagates
  });
});

describe("checkDailyBudget", () => {
  beforeEach(() => {
    mockSql.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns immediately when LLM_DAILY_BUDGET_USD is unset", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns immediately when LLM_DAILY_BUDGET_USD is '0'", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "0");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("returns immediately when LLM_DAILY_BUDGET_USD is empty string", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("does not throw when spend is below budget", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10.0");
    mockSql.mockResolvedValue([{ total: "5.0" }]);
    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError when spend equals budget", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "5.0");
    mockSql.mockResolvedValue([{ total: "5.0" }]);
    await expect(checkDailyBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("throws BudgetExceededError when spend exceeds budget", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "1.0");
    mockSql.mockResolvedValue([{ total: "2.5" }]);
    await expect(checkDailyBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("fails open when the query throws (returns without error)", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10.0");
    mockSql.mockRejectedValue(new Error("DB unavailable"));
    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });

  it("handles null total (empty table) without throwing", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10.0");
    mockSql.mockResolvedValue([{ total: null }]);
    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });
});
