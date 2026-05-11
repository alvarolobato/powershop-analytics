/**
 * Regression test for the bug where attachTelemetry shallow-cloned the
 * ctx object, breaking the publish-tool flow.
 *
 * Background:
 *   The agentic tool handlers (submit_dashboard_analysis,
 *   apply_dashboard_modification, submit_weekly_review — see
 *   lib/llm-tools/handlers/dashboards.ts) stage their result on the
 *   ctx object: `ctx.analyzeResult = ...`, `ctx.modifyResult = ...`,
 *   `ctx.reviewResult = ...`. The API routes read these fields AFTER
 *   the agentic run completes (e.g. analyzeCtx.analyzeResult).
 *
 *   If attachTelemetry returns a shallow clone of ctx, the handlers
 *   write into the clone and the route reads null from the original.
 *   The user sees:
 *
 *     "El modelo no publicó el análisis. Inténtalo de nuevo."
 *
 *   even though the model DID call the publish tool successfully.
 *
 * Contract: attachTelemetry MUST mutate ctx in place and return the
 * same object reference. This test catches regression to the shallow-
 * clone form.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunAgenticChat } = vi.hoisted(() => ({
  mockRunAgenticChat: vi.fn(),
}));

// Mock OpenAI so importing ../llm doesn't try to instantiate a real client.
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
  },
}));

// Mock llm-usage so checkDailyBudget doesn't try to hit the DB.
vi.mock("../llm-usage", () => ({
  checkDailyBudget: vi.fn(),
  logUsage: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {},
}));

// Mock the agentic runner — we never actually run an LLM call, we just
// want to invoke attachTelemetry indirectly via analyzeDashboard and
// confirm that the handler-style mutation propagates back to the caller.
vi.mock("../llm-tools/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm-tools/runner")>();
  return { ...actual, runAgenticChat: mockRunAgenticChat };
});

import { analyzeDashboard } from "../llm";
import type { LlmAgenticContext } from "../llm-tools/types";

describe("attachTelemetry — ctx reference identity (regression)", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_LLM_PROVIDER", "cli");
    vi.stubEnv("DASHBOARD_AGENTIC_TOOLS_ENABLED", "true");
    mockRunAgenticChat.mockReset();
  });

  it("propagates ctx mutations made inside the agentic run back to the caller's ctx", async () => {
    const callerCtx: LlmAgenticContext = {
      requestId: "req_test",
      endpoint: "analyzeDashboard",
      dashboardId: 1,
      analyzeResult: null,
    };

    // Simulate the publish-tool handler staging the result on ctx, the way
    // submit_dashboard_analysis does in real runs.
    mockRunAgenticChat.mockImplementation(async ({ ctx }: { ctx: LlmAgenticContext }) => {
      ctx.analyzeResult = {
        markdown: "# Análisis\n\nVentas suben 12 %.",
        summary: "Ventas suben 12 %.",
      };
      return { content: "Análisis publicado.", usage: { input: 0, output: 0 } };
    });

    await analyzeDashboard("[serialized]", "Explícame el dashboard", undefined, callerCtx);

    // If attachTelemetry shallow-clones ctx, this assertion fails — the
    // mutation lands on the clone and the caller's ctx stays null.
    expect(callerCtx.analyzeResult).not.toBeNull();
    expect(callerCtx.analyzeResult?.summary).toBe("Ventas suben 12 %.");
    expect(callerCtx.analyzeResult?.markdown).toContain("Ventas suben 12 %");
  });

  it("also exposes the telemetry fields attachTelemetry adds (llmProvider, llmDriver)", async () => {
    const callerCtx: LlmAgenticContext = {
      requestId: "req_test_2",
      endpoint: "analyzeDashboard",
      dashboardId: 1,
      analyzeResult: null,
    };
    mockRunAgenticChat.mockResolvedValue({ content: "", usage: { input: 0, output: 0 } });

    await analyzeDashboard("[serialized]", "anything", undefined, callerCtx);

    expect(callerCtx.llmProvider).toBe("cli");
    // cliDriver defaults to "claude_code"; relax to "string" so the test is
    // resilient to a default change.
    expect(typeof callerCtx.llmDriver).toBe("string");
  });
});
