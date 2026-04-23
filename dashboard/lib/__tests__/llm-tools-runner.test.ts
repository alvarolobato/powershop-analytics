import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type OpenAI from "openai";

const { ok } = vi.hoisted(() => ({
  ok: <T>(data: T) => ({ ok: true as const, data }),
}));

vi.mock("@/lib/llm-tools/logging", () => ({
  logLlmToolCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/llm-tools/handlers/sql", () => ({
  handleValidateQuery: vi.fn().mockResolvedValue(ok({ valid: true })),
  handleExecuteQuery: vi.fn().mockResolvedValue(ok({ rows: [], columns: [] })),
  handleExplainQuery: vi.fn().mockResolvedValue(ok({ explain: [] })),
  handleListPsTables: vi.fn().mockResolvedValue(ok({ tables: ["ps_ventas"] })),
  handleDescribePsTable: vi.fn().mockResolvedValue(ok({ columns: [] })),
}));

vi.mock("@/lib/llm-tools/handlers/dashboards", () => ({
  handleListDashboards: vi.fn().mockResolvedValue(ok({ dashboards: [] })),
  handleGetDashboardSpec: vi.fn().mockResolvedValue(ok({ spec: {} })),
  handleGetDashboardQueries: vi.fn().mockResolvedValue(ok({ queries: [] })),
  handleGetDashboardWidgetRawValues: vi.fn().mockResolvedValue(ok({ rows: [] })),
  handleGetDashboardAllWidgetStatus: vi.fn().mockResolvedValue(ok({ widgets: [] })),
}));

import { runAgenticChat, AgenticRunnerError } from "@/lib/llm-tools/runner";
import { createOpenRouterAgenticAdapter } from "@/lib/llm-provider/openrouter";

const ctx = {
  requestId: "req_runner_test",
  endpoint: "testEndpoint",
  llmProvider: "openrouter" as const,
  llmDriver: null as null,
};

describe("runAgenticChat", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "4");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_CALLS", "12");
    vi.stubEnv("DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS", "5000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns content when the model answers without tools", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "solo texto" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const adapter = createOpenRouterAgenticAdapter(client);

    const out = await runAgenticChat({
      adapter,
      model: "anthropic/claude-sonnet-4",
      systemPrompt: "sys",
      userContent: "user",
      ctx,
      temperature: 0.2,
      maxTokens: 100,
    });

    expect(out.content).toBe("solo texto");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("handles one tool round then a final message", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "list_ps_tables", arguments: "{}" },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "listo" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const adapter = createOpenRouterAgenticAdapter(client);

    const out = await runAgenticChat({
      adapter,
      model: "m",
      systemPrompt: "sys",
      userContent: "hi",
      ctx,
      temperature: 0,
      maxTokens: 200,
    });

    expect(out.content).toBe("listo");
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1][0] as { messages: unknown[] };
    expect(second.messages.some((m) => (m as { role: string }).role === "tool")).toBe(
      true,
    );
  });

  it("throws AgenticRunnerError when max tool rounds is exceeded", async () => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "1");
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "list_ps_tables", arguments: "{}" },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const adapter = createOpenRouterAgenticAdapter(client);

    await expect(
      runAgenticChat({
        adapter,
        model: "m",
        systemPrompt: "s",
        userContent: "u",
        ctx,
        temperature: 0,
        maxTokens: 50,
      }),
    ).rejects.toMatchObject({ name: "AgenticRunnerError", code: "AGENTIC_MAX_ROUNDS" });
  });

  it("throws AgenticRunnerError when max tool calls is exceeded", async () => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_CALLS", "1");
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "a",
                type: "function",
                function: { name: "list_ps_tables", arguments: "{}" },
              },
              {
                id: "b",
                type: "function",
                function: { name: "list_ps_tables", arguments: "{}" },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const adapter = createOpenRouterAgenticAdapter(client);

    await expect(
      runAgenticChat({
        adapter,
        model: "m",
        systemPrompt: "s",
        userContent: "u",
        ctx,
        temperature: 0,
        maxTokens: 50,
      }),
    ).rejects.toMatchObject({
      name: "AgenticRunnerError",
      code: "AGENTIC_MAX_TOOL_CALLS",
    });
  });

  it("throws AgenticRunnerError on empty final content", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "" } }],
      usage: {},
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const adapter = createOpenRouterAgenticAdapter(client);

    await expect(
      runAgenticChat({
        adapter,
        model: "m",
        systemPrompt: "s",
        userContent: "u",
        ctx,
        temperature: 0,
        maxTokens: 10,
      }),
    ).rejects.toBeInstanceOf(AgenticRunnerError);
  });
});
