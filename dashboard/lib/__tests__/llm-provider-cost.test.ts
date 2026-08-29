/**
 * Multi-model cost accounting.
 *
 * The dashboard targets DeepSeek, Claude and OpenAI. Cost must be right for
 * all three: production ran DeepSeek while every unknown model fell back to
 * Claude Sonnet's $3/$15 per Mtok — roughly 15x DeepSeek's real price — and
 * `checkDailyBudget` throttled against that number.
 */

import { describe, it, expect } from "vitest";
import { knownRateModels } from "../llm-usage";
import { extractOpenRouterCost } from "../llm-provider/openrouter";

describe("fallback rate table", () => {
  it("covers all three supported families", () => {
    const models = knownRateModels();
    for (const family of ["anthropic/", "deepseek/", "openai/"]) {
      expect(
        models.some((m) => m.startsWith(family)),
        `no fallback rate for the ${family} family — an unknown model there bills at DEFAULT_RATE`,
      ).toBe(true);
    }
  });

  it("includes the model production actually runs", () => {
    expect(knownRateModels()).toContain("deepseek/deepseek-v4-pro");
  });
});

describe("extractOpenRouterCost", () => {
  it("reads the cost OpenRouter reports", () => {
    expect(extractOpenRouterCost({ cost: 0.00042 })).toBe(0.00042);
  });

  it("falls back to the nested upstream figure", () => {
    expect(
      extractOpenRouterCost({ cost_details: { upstream_inference_cost: 0.001 } }),
    ).toBe(0.001);
  });

  it("accepts a genuine zero (a free model is not 'no report')", () => {
    expect(extractOpenRouterCost({ cost: 0 })).toBe(0);
  });

  it.each([
    ["absent", {}],
    ["null", { cost: null }],
    ["negative", { cost: -1 }],
    ["NaN", { cost: Number.NaN }],
    ["Infinity", { cost: Number.POSITIVE_INFINITY }],
    ["a string", { cost: "0.01" }],
    ["not an object", null],
  ])("returns null when the cost is %s, so estimation takes over", (_label, usage) => {
    expect(extractOpenRouterCost(usage)).toBeNull();
  });
});
