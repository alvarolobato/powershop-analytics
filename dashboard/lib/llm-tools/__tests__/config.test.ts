/**
 * Regression: agentic limits must resolve through the central config loader
 * (env > config.yaml > default), not from process.env alone.
 *
 * Production ran the hardcoded 8 rounds / 24 calls for months while
 * config.yaml said 40 / 100 — the admin UI wrote the file, reported success,
 * and the code never read it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSystemConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/system-config/loader", () => ({ getSystemConfig }));

import {
  getAgenticConfig,
  isAgenticToolsEnabled,
  getLlmMaxOutputTokens,
} from "../config";

// EVERY env var the module under test reads. Clearing only three left four
// assertions dependent on the developer's or CI's shell — a precedence test
// that is itself precedence-dependent is the wrong shape.
const ENV_KEYS = [
  "DASHBOARD_AGENTIC_TOOLS_ENABLED",
  "DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS",
  "DASHBOARD_AGENTIC_MAX_TOOL_CALLS",
  "DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS",
  "DASHBOARD_AGENTIC_MAX_ROWS",
  "DASHBOARD_AGENTIC_MAX_COLUMNS",
  "DASHBOARD_AGENTIC_MAX_RESULT_CHARS",
  "DASHBOARD_LLM_MAX_OUTPUT_TOKENS",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  getSystemConfig.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getAgenticConfig", () => {
  it("uses config.yaml values when env is unset (the production case)", () => {
    // Exactly what prod's config.yaml holds, written by the admin UI.
    getSystemConfig.mockReturnValue({
      "dashboard.agentic_max_tool_rounds": { value: 40 },
      "dashboard.agentic_max_tool_calls": { value: 100 },
    });
    const cfg = getAgenticConfig();
    expect(
      cfg.maxToolRounds,
      "config.yaml's 40 must win over the hardcoded 8",
    ).toBe(40);
    expect(
      cfg.maxToolCalls,
      "config.yaml's 100 must win over the hardcoded 24",
    ).toBe(100);
  });

  it("falls back to schema defaults when neither env nor config.yaml sets it", () => {
    getSystemConfig.mockReturnValue({});
    const cfg = getAgenticConfig();
    expect(cfg.maxToolRounds).toBe(8);
    expect(cfg.maxToolCalls).toBe(24);
    expect(cfg.toolTimeoutMs).toBe(15_000);
  });

  it("falls back to env when the loader throws, so env-only deployments are unchanged", () => {
    getSystemConfig.mockImplementation(() => {
      throw new Error("schema file missing");
    });
    process.env.DASHBOARD_AGENTIC_MAX_TOOL_CALLS = "77";
    expect(getAgenticConfig().maxToolCalls).toBe(77);
  });

  it("ignores a non-positive or unparseable value and keeps the default", () => {
    getSystemConfig.mockReturnValue({
      "dashboard.agentic_max_tool_calls": { value: 0 },
      "dashboard.agentic_max_tool_rounds": { value: "abc" },
    });
    const cfg = getAgenticConfig();
    expect(cfg.maxToolCalls).toBe(24);
    expect(cfg.maxToolRounds).toBe(8);
  });

  it("reads the kill switch from config.yaml too", () => {
    getSystemConfig.mockReturnValue({
      "dashboard.agentic_tools_enabled": { value: false },
    });
    expect(isAgenticToolsEnabled()).toBe(false);
  });

  it("defaults the kill switch to enabled", () => {
    getSystemConfig.mockReturnValue({});
    expect(isAgenticToolsEnabled()).toBe(true);
  });
});

describe("getLlmMaxOutputTokens", () => {
  it("defaults to 32000 -- con el antiguo 8192 un modelo de razonamiento agota el presupuesto pensando y devuelve LLM_EMPTY", () => {
    // Este fallo ya ha ocurrido DOS veces, y la segunda es la que fija el 32000.
    //
    // Con 4096: dos turnos de produccion registraron exactamente 4096 eventos
    // de pensamiento, cero de texto, y fallaron con "The model returned empty
    // content." Se subio a 8192.
    //
    // Con 8192 volvio a pasar el 2026-08-31: una pregunta de rentabilidad por
    // proveedor con deepseek-v4-pro murio con LLM_EMPTY tras 7 rondas de
    // herramientas. La misma pregunta con 32000 completo en 254 s gastando
    // 21.933 tokens de salida -- casi el triple del tope anterior -- y 0,059
    // USD. Duplicar no bastaba: el consumo real estaba a 2,7x del limite.
    getSystemConfig.mockReturnValue({});
    expect(getLlmMaxOutputTokens()).toBe(32000);
  });

  it("is tunable from config.yaml without a deploy", () => {
    getSystemConfig.mockReturnValue({
      "dashboard.llm_max_output_tokens": { value: 16384 },
    });
    expect(getLlmMaxOutputTokens()).toBe(16384);
  });

  it("never returns the starved 4096 by accident when unset", () => {
    getSystemConfig.mockReturnValue({});
    expect(getLlmMaxOutputTokens()).toBeGreaterThan(4096);
  });
});

describe("D-023 precedence", () => {
  it("env wins over config.yaml even when the loader is cached and stale", () => {
    // The loader caches on the config file's mtime, so a stubbed env var never
    // invalidates it. Reading env first is what keeps the documented
    // `env > config.yaml > default` order from inverting — without it, the
    // agentic runner's own test (which stubs the cap to 1) reads 100 from the
    // developer's real config.yaml and the cap never fires.
    getSystemConfig.mockReturnValue({
      "dashboard.agentic_max_tool_calls": { value: 100 },
    });
    process.env.DASHBOARD_AGENTIC_MAX_TOOL_CALLS = "1";
    expect(getAgenticConfig().maxToolCalls).toBe(1);
  });

  it("an empty env var does not mask a real config.yaml value", () => {
    getSystemConfig.mockReturnValue({
      "dashboard.agentic_max_tool_calls": { value: 100 },
    });
    process.env.DASHBOARD_AGENTIC_MAX_TOOL_CALLS = "   ";
    expect(getAgenticConfig().maxToolCalls).toBe(100);
  });
});
