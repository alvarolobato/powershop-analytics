/**
 * Unit tests for history flattening — including tool-result preservation across
 * turns (flattenStoredMessage / formatToolCallsForHistory) — and the history
 * cap (capHistory: summarise older messages beyond HISTORY_MAX_MESSAGES).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatCompletion = vi.fn();
vi.mock("@/lib/llm-provider/openrouter", () => ({
  getOpenRouterClient: () => ({}),
  openRouterChatCompletion: (...a: unknown[]) => mockChatCompletion(...a),
}));
const mockCliSingleShot = vi.fn();
vi.mock("@/lib/llm-provider/cli/claude-code", () => ({
  claudeCliSingleShot: (...a: unknown[]) => mockCliSingleShot(...a),
}));
const mockGetModel = vi.fn(() => "test-model");
const mockLoadConfig = vi.fn(() => ({ provider: "openrouter" }) as { provider: string; cliDriver?: string });
vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: () => mockLoadConfig(),
  getEffectiveDashboardModel: (...a: unknown[]) => mockGetModel(...a),
  getEffectiveOpenRouterProvider: () => null,
}));
vi.mock("@/lib/llm-circuit-breaker", () => ({
  callWithCircuitBreaker: (fn: () => unknown) => fn(),
}));
const mockLogUsage = vi.fn();
vi.mock("@/lib/llm-usage", () => ({ logUsage: (...a: unknown[]) => mockLogUsage(...a) }));
vi.mock("@/lib/conversations", () => ({ loadMessages: vi.fn() }));
const mockIsLlmEnabled = vi.fn(() => true);
vi.mock("@/lib/llm-enabled", () => ({
  isLlmEnabled: () => mockIsLlmEnabled(),
}));

import {
  flattenStoredMessage,
  formatToolCallsForHistory,
  looksLikeFabricatedToolLog,
  TOOL_LOG_OPEN_TAG,
  TOOL_LOG_CLOSE_TAG,
  capHistory,
  HISTORY_MAX_MESSAGES,
  type HistoryMessage,
} from "../history";
import type { ToolCallRecord } from "@/lib/conversation-types";

describe("flattenStoredMessage", () => {
  it("extracts text from a user message object", () => {
    expect(flattenStoredMessage({ role: "user", content: { text: "hola" } })).toEqual({
      role: "user",
      content: "hola",
    });
  });

  it("extracts text from a plain-string content (legacy rows)", () => {
    expect(flattenStoredMessage({ role: "assistant", content: "respuesta" })).toEqual({
      role: "assistant",
      content: "respuesta",
    });
  });

  it("skips standalone tool-role rows (tool context lives on the assistant turn)", () => {
    expect(
      flattenStoredMessage({
        role: "tool",
        content: { tool_call_id: "c1", tool_name: "execute_query", content: "…" },
      }),
    ).toBeNull();
  });

  it("returns null for an empty assistant message", () => {
    expect(flattenStoredMessage({ role: "assistant", content: { text: "" } })).toBeNull();
  });

  it("folds the assistant's tool calls into the turn so results persist across turns", () => {
    const toolCalls: ToolCallRecord[] = [
      {
        id: "c1",
        name: "execute_query",
        arguments: { sql: "SELECT SUM(total) FROM ps_ventas WHERE fecha = CURRENT_DATE" },
        result: '{"rows":[{"sum":12345.67}]}',
        success: true,
      },
    ];
    const flat = flattenStoredMessage({
      role: "assistant",
      content: { text: "Ayer vendisteis 12.345,67 €.", tool_calls: toolCalls },
    });
    expect(flat).not.toBeNull();
    expect(flat!.role).toBe("assistant");
    // Tool block appears BEFORE the final text so the model sees what was queried.
    expect(flat!.content).toContain("execute_query");
    expect(flat!.content).toContain("SELECT SUM(total)");
    expect(flat!.content).toContain("12345.67");
    expect(flat!.content).toContain("Ayer vendisteis 12.345,67 €.");
    expect(flat!.content.indexOf("execute_query")).toBeLessThan(
      flat!.content.indexOf("Ayer vendisteis"),
    );
  });

  it("preserves tool context even when the assistant produced no final text", () => {
    const flat = flattenStoredMessage({
      role: "assistant",
      content: {
        tool_calls: [
          { id: "c1", name: "list_ps_tables", arguments: {}, result: "ps_ventas, ps_clientes", success: true },
        ],
      },
    });
    expect(flat).not.toBeNull();
    expect(flat!.content).toContain("list_ps_tables");
    expect(flat!.content).toContain("ps_ventas");
  });
});

describe("formatToolCallsForHistory", () => {
  it("returns empty string for no tool calls", () => {
    expect(formatToolCallsForHistory([])).toBe("");
  });

  it("marks failed tool calls", () => {
    const block = formatToolCallsForHistory([
      { id: "c1", name: "execute_query", arguments: { sql: "SELECT 1" }, result: "boom", success: false },
    ]);
    expect(block).toContain("[error]");
    expect(block).toContain("execute_query");
  });

  it("truncates very long tool results to keep only the interesting part", () => {
    const huge = "x".repeat(5000);
    const block = formatToolCallsForHistory([
      { id: "c1", name: "execute_query", arguments: {}, result: huge, success: true },
    ]);
    // Far smaller than the raw 5000-char result.
    expect(block.length).toBeLessThan(1200);
    expect(block).toContain("chars)");
  });
});

// ── capHistory — bounded context for every conversation flow (#821) ───────────

function makeMessages(n: number): HistoryMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `mensaje ${i}`,
  }));
}

describe("capHistory", () => {
  beforeEach(() => {
    mockChatCompletion.mockReset();
    mockCliSingleShot.mockReset();
    mockLoadConfig.mockReset().mockReturnValue({ provider: "openrouter" });
    mockLogUsage.mockReset();
  });

  it("returns messages unchanged (no LLM call) when within the cap", async () => {
    const msgs = makeMessages(HISTORY_MAX_MESSAGES);
    const result = await capHistory(msgs);
    expect(result).toBe(msgs);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("summarises older messages into one synthetic assistant message when over the cap", async () => {
    mockChatCompletion.mockResolvedValue({ content: "- pidió ventas\n- pidió margen", usage: null });
    const msgs = makeMessages(25);

    const result = await capHistory(msgs);

    expect(result).toHaveLength(HISTORY_MAX_MESSAGES);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toContain("Earlier in this conversation");
    expect(result[0].content).toContain("pidió ventas");
    // The most recent (maxMessages - 1) messages are preserved verbatim.
    expect(result.slice(1)).toEqual(msgs.slice(25 - (HISTORY_MAX_MESSAGES - 1)));
    expect(mockChatCompletion).toHaveBeenCalledOnce();
  });

  it("falls back to the raw user prompts when the summarisation LLM call fails", async () => {
    mockChatCompletion.mockRejectedValue(new Error("LLM down"));
    const msgs = makeMessages(15);

    const result = await capHistory(msgs);

    expect(result).toHaveLength(HISTORY_MAX_MESSAGES);
    // Fallback embeds the older user prompts directly — turn must not fail.
    expect(result[0].content).toContain("mensaje 0");
  });

  it("respects an explicit smaller cap", async () => {
    mockChatCompletion.mockResolvedValue({ content: "- resumen", usage: null });
    const result = await capHistory(makeMessages(8), 4);
    expect(result).toHaveLength(4);
    expect(result[0].content).toContain("resumen");
  });

  it("bounds the summarisation prompt for very long histories (and the fallback)", async () => {
    mockChatCompletion.mockRejectedValue(new Error("LLM down"));
    // 200 old user messages × 200 chars would be ~40 KB unbounded.
    const msgs: HistoryMessage[] = Array.from({ length: 400 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `petición ${i} ` + "x".repeat(300),
    }));

    const result = await capHistory(msgs);

    expect(result).toHaveLength(HISTORY_MAX_MESSAGES);
    // Fallback summary (= the summariser input) stays within the char budget.
    expect(result[0].content.length).toBeLessThan(4_600);
    // Most recent old prompts win: the last old user message is included.
    expect(result[0].content).toContain("petición 388");
  });

  it("routes summarisation through the caller's flow for per-flow model overrides", async () => {
    mockChatCompletion.mockResolvedValue({ content: "- resumen", usage: null });
    await capHistory(makeMessages(15), HISTORY_MAX_MESSAGES, "modify");
    expect(mockGetModel).toHaveBeenCalledWith(expect.anything(), "modify");
  });

  it("on the CLI provider, logs real usage from the summarisation call instead of nothing", async () => {
    // This branch used to call claudeCliSingleShot and discard the result
    // entirely (return text; no logUsage at all) — summarisation fires on
    // every long conversation and was invisible to llm_usage.
    mockLoadConfig.mockReturnValue({ provider: "cli", cliDriver: "claude_code" });
    mockCliSingleShot.mockResolvedValue({
      text: "- pidió ventas",
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        total_tokens: 17,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cost_usd: 0.0009,
      },
    });
    const msgs = makeMessages(15);

    const result = await capHistory(msgs);

    expect(result[0].content).toContain("pidió ventas");
    expect(mockLogUsage).toHaveBeenCalledWith(
      "dashboard/history/summarise",
      "test-model",
      expect.objectContaining({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }),
      { provider: "cli", driver: "claude_code" },
      { reportedCostUsd: 0.0009 },
    );
  });

  it("on the CLI provider, falls back to raw prompts (never logging) when the call throws", async () => {
    mockLoadConfig.mockReturnValue({ provider: "cli", cliDriver: "claude_code" });
    mockCliSingleShot.mockRejectedValue(new Error("CLI down"));
    const msgs = makeMessages(15);

    const result = await capHistory(msgs);

    expect(result[0].content).toContain("mensaje 0");
    expect(mockLogUsage).not.toHaveBeenCalled();
  });
});

/**
 * buildSummary() reaches the providers directly, so neither the kill switch
 * nor turn-background's e2e-stub short-circuit covers it. Both are honoured
 * inside history.ts itself; these pin that, because the failure is silent —
 * a real billed call with the switch off, and nothing surfaces it.
 */
describe("capHistory — summarisation respects the kill switch and the stub provider", () => {
  const longHistory = Array.from({ length: 14 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `mensaje ${i}`,
  }));

  beforeEach(() => {
    mockChatCompletion.mockReset();
    mockCliSingleShot.mockReset();
    mockIsLlmEnabled.mockReset();
    mockIsLlmEnabled.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ provider: "openrouter" });
  });

  it("makes no provider call when the LLM is disabled", async () => {
    mockIsLlmEnabled.mockReturnValue(false);
    const out = await capHistory(longHistory, 10, "chat");
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(mockCliSingleShot).not.toHaveBeenCalled();
    // Still capped, using the same bounded fallback the catch blocks use.
    expect(out.length).toBe(10);
    expect(out[0].content).toContain("Earlier in this conversation");
  });

  it("makes no provider call under the e2e-stub provider", async () => {
    mockLoadConfig.mockReturnValue({ provider: "e2e-stub" });
    const out = await capHistory(longHistory, 10, "chat");
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(mockCliSingleShot).not.toHaveBeenCalled();
    expect(out.length).toBe(10);
  });

  it("still summarises normally when enabled on a real provider", async () => {
    mockChatCompletion.mockResolvedValue({ content: "- resumen", usage: null });
    const out = await capHistory(longHistory, 10, "chat");
    expect(mockChatCompletion).toHaveBeenCalledOnce();
    expect(out[0].content).toContain("resumen");
  });
});

// ---------------------------------------------------------------------------
// Fabricated tool-log guard (production incident 2026-08-28, conv 0a566ce7cc78)
// ---------------------------------------------------------------------------

describe("looksLikeFabricatedToolLog", () => {
  // Verbatim from conversation_messages id 292e32d5 in production — the text
  // the user was shown as a completed answer. SQL bodies elided; the shape
  // (header, `- name({...})` lines, no ` → result` anywhere) is preserved,
  // because that shape is exactly what the detector keys on.
  const PROD_FABRICATED = [
    "[Datos consultados con herramientas en esta respuesta]",
    '- execute_query({"sql":"SELECT p.codigo, p.ccrefejofacm AS referencia FROM ps_articulos p WHERE p.ccrefejofacm LIKE \'V265103%\'"})',
    '- execute_query({"sql":"SELECT c.color, SUM(lv.unidades) FROM ps_lineas_ventas lv GROUP BY c.color"})',
    '- execute_query({"sql":"SELECT c.color, SUM(s.stock) FROM ps_stock_tienda s GROUP BY c.color"})',
  ].join("\n");

  it("catches the exact production payload (legacy framing, zero tool calls)", () => {
    expect(looksLikeFabricatedToolLog(PROD_FABRICATED, 0)).toBe(true);
  });

  it("catches the same fabrication in the new tagged framing", () => {
    const text = [
      TOOL_LOG_OPEN_TAG,
      '- execute_query({"sql":"SELECT 1"})',
      TOOL_LOG_CLOSE_TAG,
    ].join("\n");
    expect(looksLikeFabricatedToolLog(text, 0)).toBe(true);
  });

  it("does NOT fire when the turn really made tool calls", () => {
    // The whole point of the zero-call condition: a turn that genuinely ran
    // tools is never killed, whatever its text happens to look like.
    expect(looksLikeFabricatedToolLog(PROD_FABRICATED, 3)).toBe(false);
    expect(looksLikeFabricatedToolLog(PROD_FABRICATED, 1)).toBe(false);
  });

  it("does not fire on the real answers from the same conversation", () => {
    const realAnswers = [
      "La referencia **V265001** (POLO CUELLO MAO, temporada **V26**) se vende en 5 colores.",
      "Estudio completo de la referencia **V265002** (POLO PIQUE BASICO)...",
      "Revisé el modelo de datos y hay un matiz importante que debes saber antes de los números:",
      "Aclaración importante: **V26510399** no es una familia, es un color concreto.",
    ];
    for (const answer of realAnswers) {
      expect(looksLikeFabricatedToolLog(answer, 0)).toBe(false);
    }
  });

  it("does not fire on prose that merely mentions the block", () => {
    // Requires call-shaped lines, not just the framing, so explaining the
    // block is still a valid answer.
    const prose = `${TOOL_LOG_OPEN_TAG} es el registro interno de herramientas; no lo verás en las respuestas.`;
    expect(looksLikeFabricatedToolLog(prose, 0)).toBe(false);
  });

  it("does not fire on an empty or whitespace answer", () => {
    expect(looksLikeFabricatedToolLog("", 0)).toBe(false);
    expect(looksLikeFabricatedToolLog("   \n  ", 0)).toBe(false);
  });

  it("catches it despite leading whitespace", () => {
    expect(looksLikeFabricatedToolLog(`\n\n  ${PROD_FABRICATED}`, 0)).toBe(true);
  });
});

describe("formatToolCallsForHistory framing", () => {
  it("no longer opens with a bare Spanish heading that reads as assistant prose", () => {
    const block = formatToolCallsForHistory([
      { name: "execute_query", arguments: { sql: "SELECT 1" }, result: "1 fila" },
    ] as never);
    expect(block.startsWith(TOOL_LOG_OPEN_TAG)).toBe(true);
    expect(block).toContain(TOOL_LOG_CLOSE_TAG);
    expect(block).toContain("Nunca reproduzcas este bloque");
    // The result arrow is what distinguishes a real block from a fabricated
    // one; it must survive the reframing.
    expect(block).toContain("→");
  });

  it("still returns empty string when there are no tool calls", () => {
    expect(formatToolCallsForHistory([])).toBe("");
  });
});
