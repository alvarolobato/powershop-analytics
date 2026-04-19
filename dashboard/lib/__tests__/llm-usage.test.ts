import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSql = vi.fn();

vi.mock("@/lib/db-write", () => ({
  sql: mockSql,
}));

import {
  logUsage,
  checkDailyBudget,
  BudgetExceededError,
} from "../llm-usage";

describe("logUsage", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls sql with correct columns and computed cost for known model", async () => {
    logUsage("generateDashboard", "anthropic/claude-sonnet-4", {
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
    });

    // logUsage is fire-and-forget; wait a tick for the promise to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSql).toHaveBeenCalledOnce();
    const [query, params] = mockSql.mock.calls[0];
    expect(query).toContain("INSERT INTO llm_usage");
    expect(params[0]).toBe("generateDashboard");
    expect(params[1]).toBe("anthropic/claude-sonnet-4");
    expect(params[2]).toBe(1000);
    expect(params[3]).toBe(500);
    expect(params[4]).toBe(1500);
    // cost = 1000 * 3/1e6 + 500 * 15/1e6 = 0.003 + 0.0075 = 0.0105
    expect(params[5]).toBe("0.010500");
  });

  it("falls back to DEFAULT_RATE for unknown model", async () => {
    logUsage("modifyDashboard", "unknown/model-xyz", {
      prompt_tokens: 100,
      completion_tokens: 100,
      total_tokens: 200,
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockSql).toHaveBeenCalledOnce();
    const params = mockSql.mock.calls[0][1];
    // default rate = 3/1e6 prompt + 15/1e6 completion
    // 100 * 3/1e6 + 100 * 15/1e6 = 0.0003 + 0.0015 = 0.0018
    expect(params[5]).toBe("0.001800");
  });

  it("does not throw when sql rejects (fire-and-forget)", async () => {
    mockSql.mockRejectedValue(new Error("db error"));

    expect(() =>
      logUsage("generateDashboard", "anthropic/claude-sonnet-4", {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      })
    ).not.toThrow();

    // allow the rejection to be handled internally
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("checkDailyBudget", () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when LLM_DAILY_BUDGET_USD is not set", async () => {
    delete process.env.LLM_DAILY_BUDGET_USD;
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("is a no-op when LLM_DAILY_BUDGET_USD is empty string", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("is a no-op when LLM_DAILY_BUDGET_USD is '0'", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "0");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("is a no-op when LLM_DAILY_BUDGET_USD is negative", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "-5");
    await expect(checkDailyBudget()).resolves.toBeUndefined();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("allows call when daily spend is below the limit", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10");
    mockSql.mockResolvedValue([{ total: "5.00" }]);

    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError when daily spend equals the limit", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10");
    mockSql.mockResolvedValue([{ total: "10.00" }]);

    await expect(checkDailyBudget()).rejects.toThrow(BudgetExceededError);
  });

  it("throws BudgetExceededError when daily spend exceeds the limit", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "5");
    mockSql.mockResolvedValue([{ total: "7.50" }]);

    await expect(checkDailyBudget()).rejects.toThrow(BudgetExceededError);
    await expect(checkDailyBudget()).rejects.toThrow(
      "Límite diario de generación alcanzado"
    );
  });

  it("is fail-open when the sql query throws", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10");
    mockSql.mockRejectedValue(new Error("connection refused"));

    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });

  it("is fail-open when the result row is missing", async () => {
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "10");
    mockSql.mockResolvedValue([]);

    await expect(checkDailyBudget()).resolves.toBeUndefined();
  });
});
