/**
 * End-to-end wiring test: the model asks for `search_knowledge`, and the
 * runner must hand it back real content from the index.
 *
 * The handler tests exercise the search itself; this one proves the dispatch
 * is connected — the failure mode that shipped in the first cut was a handler
 * that worked in isolation while the runner passed it the raw JSON *string*
 * cast to an object, so every call answered "query is required".
 *
 * Only the DB-backed handlers are mocked. `handlers/knowledge` runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type OpenAI from "openai";

const { ok } = vi.hoisted(() => ({ ok: <T>(data: T) => ({ ok: true as const, data }) }));

vi.mock("@/lib/llm-tools/logging", () => ({
  logLlmToolCall: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/llm-tools/handlers/sql", () => ({
  handleValidateQuery: vi.fn().mockResolvedValue(ok({ valid: true })),
  handleExecuteQuery: vi.fn().mockResolvedValue(ok({ rows: [], columns: [] })),
  handleExplainQuery: vi.fn().mockResolvedValue(ok({ explain: [] })),
  handleListPsTables: vi.fn().mockResolvedValue(ok({ tables: [] })),
  handleDescribePsTable: vi.fn().mockResolvedValue(ok({ columns: [] })),
}));
vi.mock("@/lib/llm-tools/handlers/dashboards", () => ({
  handleListDashboards: vi.fn().mockResolvedValue(ok({ dashboards: [] })),
  handleGetDashboardSpec: vi.fn().mockResolvedValue(ok({ spec: {} })),
  handleGetDashboardQueries: vi.fn().mockResolvedValue(ok({ queries: [] })),
  handleGetDashboardWidgetRawValues: vi.fn().mockResolvedValue(ok({ rows: [] })),
  handleGetDashboardAllWidgetStatus: vi.fn().mockResolvedValue(ok({ widgets: [] })),
}));
vi.mock("@/lib/llm-tools/handlers/start-dashboard-generation", () => ({
  handleStartDashboardGeneration: vi.fn().mockResolvedValue(ok({ dashboard_id: "1" })),
}));

import { runAgenticChat } from "@/lib/llm-tools/runner";
import { createOpenRouterAgenticAdapter } from "@/lib/llm-provider/openrouter";

function stream(chunks: object[]): AsyncIterable<object> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < chunks.length
            ? { value: chunks[i++], done: false as const }
            : { value: undefined, done: true as const };
        },
      };
    },
  };
}

const toolCallStream = (name: string, args: string) =>
  stream([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name, arguments: args } },
            ],
          },
        },
      ],
    },
  ]);

const textStream = (content: string) => stream([{ choices: [{ delta: { content } }] }]);

const ctx = {
  requestId: "req_knowledge_runner",
  endpoint: "testEndpoint",
  llmProvider: "openrouter" as const,
  llmDriver: null,
};

describe("runAgenticChat + search_knowledge", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "4");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_CALLS", "12");
    vi.stubEnv("DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS", "5000");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_RESULT_CHARS", "20000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns the CCOPTallaOjo section to the model", async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce(
        toolCallStream("search_knowledge", JSON.stringify({ query: "ventas por talla" })),
      )
      .mockReturnValueOnce(textStream("listo"));
    const adapter = createOpenRouterAgenticAdapter({
      chat: { completions: { create } },
    } as unknown as OpenAI);

    const toolCalls: NonNullable<typeof ctx & { toolCalls?: unknown[] }>["toolCalls"] = [];
    const out = await runAgenticChat({
      adapter,
      model: "anthropic/claude-sonnet-4",
      systemPrompt: "sys",
      userContent: "¿ventas por talla?",
      ctx: { ...ctx, toolCalls: toolCalls as never },
    });

    expect(out.content).toBe("listo");
    // Second call = the follow-up turn; its messages carry the tool result the
    // model actually saw.
    const followUp = create.mock.calls[1][0] as { messages: { role: string; content: string }[] };
    const toolMessage = followUp.messages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.content).toContain("CCOPTallaOjo");
    expect(toolMessage!.content).toMatch(/ps_lineas_ventas[\s\S]*talla/i);
    expect(toolMessage!.content).toContain('"ok":true');
  });

  it("surfaces a tool error (not a crash) when the model sends a bad query", async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce(toolCallStream("search_knowledge", JSON.stringify({ query: "" })))
      .mockReturnValueOnce(textStream("vale"));
    const adapter = createOpenRouterAgenticAdapter({
      chat: { completions: { create } },
    } as unknown as OpenAI);

    const out = await runAgenticChat({
      adapter,
      model: "anthropic/claude-sonnet-4",
      systemPrompt: "sys",
      userContent: "?",
      ctx,
    });

    expect(out.content).toBe("vale");
    const followUp = create.mock.calls[1][0] as { messages: { role: string; content: string }[] };
    const toolMessage = followUp.messages.find((m) => m.role === "tool");
    expect(toolMessage!.content).toContain("EMPTY_QUERY");
    expect(toolMessage!.content).toContain('"ok":false');
  });
});
