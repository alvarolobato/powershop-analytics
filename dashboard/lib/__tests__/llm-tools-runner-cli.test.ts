import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockClaudeStep } = vi.hoisted(() => ({
  mockClaudeStep: vi.fn(),
}));

vi.mock("@/lib/llm-tools/logging", () => ({
  logLlmToolCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/llm-tools/handlers/sql", () => ({
  handleValidateQuery: vi.fn(),
  handleExecuteQuery: vi.fn(),
  handleExplainQuery: vi.fn(),
  handleListPsTables: vi.fn().mockResolvedValue({ ok: true as const, data: { tables: ["ps_x"] } }),
  handleDescribePsTable: vi.fn(),
}));

vi.mock("@/lib/llm-tools/handlers/dashboards", () => ({
  handleListDashboards: vi.fn(),
  handleGetDashboardSpec: vi.fn(),
  handleGetDashboardQueries: vi.fn(),
  handleGetDashboardWidgetRawValues: vi.fn(),
  handleGetDashboardAllWidgetStatus: vi.fn(),
}));

vi.mock("@/lib/llm-provider/cli/claude-code", () => ({
  claudeCliAgenticStep: mockClaudeStep,
}));

import { runAgenticChat } from "@/lib/llm-tools/runner";
import { createClaudeCodeAgenticAdapter } from "@/lib/llm-provider/cli/agent-adapter";
import type { DashboardLlmConfig } from "@/lib/llm-provider/types";

const cfg: DashboardLlmConfig = {
  provider: "cli",
  openrouterModel: "anthropic/claude-sonnet-4",
  cliModel: "sonnet",
  cliDriver: "claude_code",
  cliBin: "claude",
  cliExtraArgs: [],
  cliTimeoutMs: 5000,
  cliMaxCaptureBytes: 1_000_000,
};

const ctx = {
  requestId: "req_cli_runner",
  endpoint: "generateDashboard",
  llmProvider: "cli" as const,
  llmDriver: "claude_code" as const,
};

describe("runAgenticChat (CLI adapter)", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_ROUNDS", "4");
    vi.stubEnv("DASHBOARD_AGENTIC_MAX_TOOL_CALLS", "12");
    vi.stubEnv("DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS", "5000");
    mockClaudeStep.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs tool round then final via Claude JSON protocol", async () => {
    mockClaudeStep
      .mockResolvedValueOnce({
        kind: "tools",
        calls: [{ name: "list_ps_tables", arguments: "{}" }],
      })
      .mockResolvedValueOnce({ kind: "final", content: '{"ok":true}' });

    const adapter = createClaudeCodeAgenticAdapter(cfg);
    const out = await runAgenticChat({
      adapter,
      model: cfg.cliModel,
      systemPrompt: "sys with tools",
      userContent: "go",
      ctx,
      temperature: 0.2,
      maxTokens: 1000,
    });

    expect(out.content).toBe('{"ok":true}');
    expect(mockClaudeStep).toHaveBeenCalledTimes(2);
  });
});
