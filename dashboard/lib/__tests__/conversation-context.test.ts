import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSql, mockCliSingleShot, mockOpenRouterCompletion } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockCliSingleShot: vi.fn(),
  mockOpenRouterCompletion: vi.fn(),
}));

vi.mock("@/lib/db-write", () => ({
  sql: mockSql,
}));

vi.mock("@/lib/llm-provider/cli/claude-code", () => ({
  claudeCliSingleShot: mockCliSingleShot,
}));

vi.mock("@/lib/llm-provider/openrouter", () => ({
  getOpenRouterClient: vi.fn(() => ({})),
  openRouterChatCompletion: mockOpenRouterCompletion,
}));

vi.mock("@/lib/llm-circuit-breaker", () => ({
  callWithCircuitBreaker: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: vi.fn(() => ({ provider: "openrouter" })),
  getEffectiveDashboardModel: vi.fn(() => "anthropic/claude-sonnet-4"),
  getEffectiveOpenRouterProvider: vi.fn(() => undefined),
}));

vi.mock("@/lib/llm-usage", () => ({
  logUsage: vi.fn(),
}));

import { loadPriorTurns, summariseOldTurns, type ChatTurn } from "../conversation-context";

describe("loadPriorTurns", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockOpenRouterCompletion.mockReset();
  });

  it("returns stored turns in order when count is within cap", async () => {
    const stored: ChatTurn[] = [
      { role: "user", content: "Añade margen" },
      { role: "assistant", content: "He añadido el margen." },
      { role: "user", content: "Agrúpalo por familia" },
    ];
    mockSql.mockResolvedValue([{ messages: stored }]);

    const result = await loadPriorTurns(42, "modify");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: "user", content: "Añade margen" });
    expect(result[1]).toEqual({ role: "assistant", content: "He añadido el margen." });
    expect(result[2]).toEqual({ role: "user", content: "Agrúpalo por familia" });
  });

  it("returns [] when DB returns no rows", async () => {
    mockSql.mockResolvedValue([]);
    const result = await loadPriorTurns(42, "modify");
    expect(result).toEqual([]);
  });

  it("returns [] when chat_messages column is null", async () => {
    mockSql.mockResolvedValue([{ messages: null }]);
    const result = await loadPriorTurns(42, "analyze");
    expect(result).toEqual([]);
  });

  it("reads chat_messages_analyze for 'analyze' channel", async () => {
    mockSql.mockResolvedValue([{ messages: [] }]);
    await loadPriorTurns(10, "analyze");
    expect(mockSql).toHaveBeenCalledWith(
      expect.stringContaining("chat_messages_analyze"),
      [10],
    );
  });

  it("reads chat_messages_modify for 'modify' channel", async () => {
    mockSql.mockResolvedValue([{ messages: [] }]);
    await loadPriorTurns(10, "modify");
    expect(mockSql).toHaveBeenCalledWith(
      expect.stringContaining("chat_messages_modify"),
      [10],
    );
  });

  it("calls summariseOldTurns when stored turns exceed the cap", async () => {
    const stored: ChatTurn[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i}`,
    }));
    mockSql.mockResolvedValue([{ messages: stored }]);
    mockOpenRouterCompletion.mockResolvedValue({ content: "- req 0\n- req 2", usage: null });

    const result = await loadPriorTurns(42, "modify", 10);

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("returns [] when DB throws", async () => {
    mockSql.mockRejectedValue(new Error("DB error"));
    const result = await loadPriorTurns(42, "modify");
    expect(result).toEqual([]);
  });

  it("filters out entries with invalid role", async () => {
    const stored = [
      { role: "user", content: "Valid" },
      { role: "system", content: "Should be dropped" },
      { role: "assistant", content: "Also valid" },
    ];
    mockSql.mockResolvedValue([{ messages: stored }]);
    const result = await loadPriorTurns(42, "modify");
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });
});

describe("summariseOldTurns", () => {
  beforeEach(() => {
    mockOpenRouterCompletion.mockReset();
  });

  it("returns turns unchanged when count is within cap", async () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
    ];
    const result = await summariseOldTurns(turns, 10);
    expect(result).toEqual(turns);
  });

  it("compresses to <= maxTurns when count exceeds cap", async () => {
    const turns: ChatTurn[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i}`,
    }));
    mockOpenRouterCompletion.mockResolvedValue({
      content: "- message 0\n- message 2\n- message 4",
      usage: null,
    });

    const result = await summariseOldTurns(turns, 10);

    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toContain("Earlier in this conversation");
  });

  it("preserves the most recent turns after summarisation", async () => {
    const turns: ChatTurn[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i}`,
    }));
    mockOpenRouterCompletion.mockResolvedValue({ content: "summary", usage: null });

    const result = await summariseOldTurns(turns, 10);

    // The last 9 turns should be preserved verbatim (turns[3..11])
    const lastNine = turns.slice(turns.length - 9);
    expect(result.slice(1)).toEqual(lastNine);
  });

  it("falls back to plain user prompts when LLM call fails", async () => {
    const turns: ChatTurn[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${i}`,
    }));
    mockOpenRouterCompletion.mockRejectedValue(new Error("LLM unavailable"));

    const result = await summariseOldTurns(turns, 10);

    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0].role).toBe("assistant");
    // Summary content should contain fallback (raw user prompts joined)
    expect(result[0].content).toBeTruthy();
  });
});
