/**
 * Integration test for maybeGenerateTitle() — deliberately does NOT mock
 * @/lib/llm-context.
 *
 * `conversations.test.ts` mocks `@/lib/llm-context` wholesale (see its
 * `vi.mock("@/lib/llm-context", ...)`), so its otherwise-green tests never
 * actually exercised `assembleRequest("title", ...)` → `buildSystemPrompt` →
 * `toolsForFlow` → `buildHistory`/`capHistory` — the real chain a title
 * request runs through in production. That is precisely how the role
 * inversion (last turn, usually the assistant's own reply, sent as the
 * "user" question) and the unbounded-history bug (every prior turn passed
 * through, tripping `capHistory`'s own extra summarisation LLM call) went
 * undetected (D-045).
 *
 * Here only the two real boundaries are mocked: the DB (`@/lib/db-write`)
 * and the network-facing leaf (`llmComplete` in `@/lib/llm-client`). Every
 * layer of `llm-context` in between — assembleRequest, buildSystemPrompt,
 * toolsForFlow, buildHistory/capHistory — runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSql = vi.fn();
const mockLlmComplete = vi.fn();

vi.mock("@/lib/db-write", () => ({
  sql: (...args: unknown[]) => mockSql(...args),
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: (...args: unknown[]) => mockLlmComplete(...args),
  buildCachedSystemMessage: (stable: string) => ({
    role: "system" as const,
    content: [{ type: "text", text: stable }],
  }),
  createDashboardAgenticAdapter: () => ({}),
}));

import { maybeGenerateTitle } from "../conversations";

type LlmCompleteCall = {
  flow: string;
  systemPrompt: { stable: string; volatile?: string };
  messages: Array<{ role: string; content: string }>;
};

describe("maybeGenerateTitle — real llm-context integration (no @/lib/llm-context mock)", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockLlmComplete.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const conversation = [
    { role: "user" as const, content: "¿Cuánto vendimos ayer?" },
    { role: "assistant" as const, content: "Vendimos 12.345 € en total ayer." },
  ];

  it("assembles a real title prompt and sends the FIRST user message, never the assistant reply", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]); // getConversation
    mockLlmComplete.mockResolvedValue({
      text: "Ventas de ayer",
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      provider: "openrouter",
    });
    mockSql.mockResolvedValueOnce([]); // UPDATE title

    await maybeGenerateTitle("conv1", conversation);

    expect(mockLlmComplete).toHaveBeenCalledOnce();
    const req = mockLlmComplete.mock.calls[0][0] as LlmCompleteCall;

    // The real "title" flow builds a real prompt asking for a bare title —
    // proves buildSystemPrompt("title", {}) ran for real, not an empty stub.
    expect(req.systemPrompt.stable).toContain("título conciso");

    const userTurn = req.messages.find((m) => m.role === "user");
    expect(userTurn?.content).toBe("¿Cuánto vendimos ayer?");

    const [updateSql, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain("title IS NULL");
    expect(updateParams[1]).toBe("Ventas de ayer");
  });

  it("clamps the persisted title to 100 chars even when the model ignores the prompt", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]);
    mockLlmComplete.mockResolvedValue({
      text: "T".repeat(250),
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      provider: "openrouter",
    });
    mockSql.mockResolvedValueOnce([]);

    await maybeGenerateTitle("conv1", conversation);

    const [, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect((updateParams[1] as string)).toHaveLength(100);
  });

  it("never calls the LLM under DASHBOARD_LLM_PROVIDER=e2e-stub", async () => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "e2e-stub");

    await maybeGenerateTitle("conv1", conversation);

    expect(mockLlmComplete).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("keeps history to at most one prior message regardless of conversation length — capHistory never fires its own extra summarisation call", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]);
    mockLlmComplete.mockResolvedValue({
      text: "Ventas de ayer",
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      provider: "openrouter",
    });
    mockSql.mockResolvedValueOnce([]);

    // Well past HISTORY_MAX_MESSAGES (10) — if maybeGenerateTitle ever passed
    // the whole conversation through, buildHistory()'s capHistory() would
    // detect messages.length > 10 and fire a SECOND llmComplete call to
    // summarise the older turns before returning.
    const laterTurns = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `turno adicional ${i}`,
    }));

    await maybeGenerateTitle("conv1", [...conversation, ...laterTurns]);

    expect(mockLlmComplete).toHaveBeenCalledTimes(1);
    const req = mockLlmComplete.mock.calls[0][0] as LlmCompleteCall;
    // user (first question) + at most one assistant prior message.
    expect(req.messages.length).toBeLessThanOrEqual(2);
  });
});
