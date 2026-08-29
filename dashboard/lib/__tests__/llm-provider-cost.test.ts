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
import {
  extractOpenRouterCost,
  openRouterExtras,
  readOpenRouterCacheTokens,
} from "../llm-provider/openrouter";

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

describe("openRouterExtras", () => {
  it("requests usage accounting on every call", () => {
    // Mutation-proof for the headline change: an earlier revision of this PR
    // could have `openRouterExtras` return no `usage` key at all and the
    // entire suite still passed, because nothing asserted the request shape.
    expect(openRouterExtras()).toEqual({ usage: { include: true } });
    expect(openRouterExtras({ only: ["deepseek"] })).toEqual({
      provider: { only: ["deepseek"] },
      usage: { include: true },
    });
  });
});

describe("extractOpenRouterCost — BYOK", () => {
  it("sums OpenRouter's fee and the upstream cost when is_byok", () => {
    // Under BYOK, `cost` is only OpenRouter's ~5% surcharge and
    // `cost_details.upstream_inference_cost` is what was actually paid to the
    // provider. Returning the first present value would record the 5% and
    // drop the rest — a ~20x UNDERCOUNT, the dangerous direction for a budget
    // guard.
    expect(
      extractOpenRouterCost({
        is_byok: true,
        cost: 0.0005,
        cost_details: { upstream_inference_cost: 0.01 },
      }),
    ).toBeCloseTo(0.0105, 10);
  });

  it("does not sum when is_byok is false (cost is already the total)", () => {
    expect(
      extractOpenRouterCost({
        is_byok: false,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.0095 },
      }),
    ).toBe(0.01);
  });

  it("returns null when a BYOK response reports neither figure", () => {
    expect(extractOpenRouterCost({ is_byok: true })).toBeNull();
  });
});

describe("readOpenRouterCacheTokens", () => {
  it("reads OpenRouter's prompt_tokens_details shape", () => {
    // Live OpenRouter responses report cache usage here, NOT as Anthropic's
    // cache_creation_input_tokens / cache_read_input_tokens. Those fields were
    // therefore always null on this path, so the rate-table estimate priced
    // every cached token as fresh — ~10x over on a cache hit.
    expect(
      readOpenRouterCacheTokens({
        prompt_tokens: 7710,
        prompt_tokens_details: { cached_tokens: 7702, cache_write_tokens: 0 },
      }),
    ).toEqual({ cache_creation_input_tokens: 0, cache_read_input_tokens: 7702 });
  });

  it("prefers explicit Anthropic-shaped fields when a route forwards them", () => {
    expect(
      readOpenRouterCacheTokens({
        cache_creation_input_tokens: 11,
        cache_read_input_tokens: 22,
        prompt_tokens_details: { cached_tokens: 999, cache_write_tokens: 888 },
      }),
    ).toEqual({ cache_creation_input_tokens: 11, cache_read_input_tokens: 22 });
  });

  it("returns undefined for both when nothing is reported", () => {
    expect(readOpenRouterCacheTokens({ prompt_tokens: 10 })).toEqual({
      cache_creation_input_tokens: undefined,
      cache_read_input_tokens: undefined,
    });
  });
});
