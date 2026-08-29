/**
 * The stale-turn cutoff must track the agentic caps.
 *
 * It used to be a hardcoded 30 minutes justified by "maxToolCalls=24 ×
 * toolTimeoutMs=15s = 6 min of tool time". Production's config.yaml raises the
 * caps to 100/40, which the code now honours — 100 × 15s is 25 minutes of tool
 * time alone, so the worst-case legitimate turn ran PAST the cutoff, would be
 * judged abandoned, and a second turn would be admitted into the same
 * conversation: the interleaving issue #823's advisory lock exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getAgenticConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm-tools/config", () => ({ getAgenticConfig }));
const readConfigString = vi.hoisted(() => vi.fn());
vi.mock("@/lib/system-config/read", () => ({ readConfigString }));
vi.mock("@/lib/db-write", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/sse-pubsub", () => ({ publish: vi.fn() }));

import { activeTurnStaleMinutes } from "@/lib/turn-events";

beforeEach(() => {
  getAgenticConfig.mockReset();
  readConfigString.mockReset();
  readConfigString.mockReturnValue(undefined); // default 120s ceiling
});

const withCaps = (maxToolCalls: number, maxToolRounds: number, toolTimeoutMs = 15_000) => {
  getAgenticConfig.mockReturnValue({ maxToolCalls, maxToolRounds, toolTimeoutMs });
  return activeTurnStaleMinutes();
};

describe("activeTurnStaleMinutes", () => {
  it("clears the worst-case turn at production's caps (100 calls / 40 rounds)", () => {
    // 100 × 15s = 25 min of tool time ALONE, before any model latency. The old
    // hardcoded 30 left essentially no room for 40 rounds on top.
    expect(withCaps(100, 40)).toBeGreaterThan(25 + 30);
  });

  it("stays near the historical 30 at the old caps, so nothing regressed", () => {
    const minutes = withCaps(24, 8);
    expect(minutes).toBeGreaterThanOrEqual(30);
    expect(minutes).toBeLessThan(45);
  });

  it("never drops below the historical 30 however small the caps get", () => {
    // A tiny cap must not make the cutoff aggressive enough to kill a turn
    // that is merely slow for reasons unrelated to tool count.
    expect(withCaps(1, 1, 1_000)).toBe(30);
  });

  it("grows with the caps — that is the whole point", () => {
    expect(withCaps(200, 80)).toBeGreaterThan(withCaps(24, 8));
  });
});

describe("activeTurnStaleMinutes — CLI timeout is configurable too", () => {
  it("grows when dashboard.llm_cli_timeout_ms is raised", () => {
    // A fixed 120s ceiling would under-estimate the worst case for an operator
    // who raised the CLI timeout — the same hidden-coupling bug this whole
    // derivation exists to remove, one level down.
    getAgenticConfig.mockReturnValue({ maxToolCalls: 24, maxToolRounds: 8, toolTimeoutMs: 15_000 });

    readConfigString.mockReturnValue(undefined);
    const atDefault = activeTurnStaleMinutes();

    readConfigString.mockReturnValue("600000"); // 10 min per round
    const atRaised = activeTurnStaleMinutes();

    expect(atRaised).toBeGreaterThan(atDefault);
  });

  it("falls back to 120s when the setting is absent or unparseable", () => {
    getAgenticConfig.mockReturnValue({ maxToolCalls: 24, maxToolRounds: 8, toolTimeoutMs: 15_000 });
    readConfigString.mockReturnValue(undefined);
    const fallback = activeTurnStaleMinutes();
    readConfigString.mockReturnValue("not-a-number");
    expect(activeTurnStaleMinutes()).toBe(fallback);
    readConfigString.mockReturnValue("0");
    expect(activeTurnStaleMinutes()).toBe(fallback);
  });
});
