/**
 * Unit tests for the turn executor (turn-background.ts).
 * All dependencies are mocked — no LLM or DB required.
 */

import { describe, it, vi, expect, beforeEach } from "vitest";

// ── Static import mocks ────────────────────────────────────────────────────────

const mockUpdateTurnStatus = vi.fn();
const mockInsertTurnEvent = vi.fn();

vi.mock("@/lib/turn-events", () => ({
  updateTurnStatus: (...a: unknown[]) => mockUpdateTurnStatus(...a),
  insertTurnEvent: (...a: unknown[]) => mockInsertTurnEvent(...a),
}));

const mockAppendMessage = vi.fn();
const mockLoadMessages = vi.fn();
const mockMaybeGenerateTitle = vi.fn();
const mockTouchConversation = vi.fn();

vi.mock("@/lib/conversations", () => ({
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  loadMessages: (...a: unknown[]) => mockLoadMessages(...a),
  maybeGenerateTitle: (...a: unknown[]) => mockMaybeGenerateTitle(...a),
  touchConversation: (...a: unknown[]) => mockTouchConversation(...a),
}));

vi.mock("@/lib/errors", () => ({
  generateRequestId: () => "req_test",
}));

// ── Dynamic import mocks ───────────────────────────────────────────────────────

const mockRunAgenticChat = vi.fn();

vi.mock("@/lib/conversation-context", () => ({
  buildFreeChatContext: () => ({
    systemPrompt: { stable: "You are a helpful assistant." },
    tools: [],
  }),
}));

vi.mock("@/lib/llm-tools/runner", () => ({
  runAgenticChat: (...a: unknown[]) => mockRunAgenticChat(...a),
  AgenticRunnerError: class AgenticRunnerError extends Error {},
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: () => ({ provider: "openrouter" }),
  getEffectiveDashboardModel: () => "claude-sonnet-4-6",
  getEffectiveOpenRouterProvider: () => null,
}));

vi.mock("@/lib/llm-client", () => ({
  createDashboardAgenticAdapter: () => ({}),
  llmComplete: vi.fn().mockResolvedValue({ text: "Generic LLM reply" }),
}));

const mockSql = vi.fn();
vi.mock("@/lib/db-write", () => ({
  sql: (...a: unknown[]) => mockSql(...a),
}));

const mockAnalyzeDashboard = vi.fn();
const mockModifyDashboard = vi.fn();
vi.mock("@/lib/llm", () => ({
  analyzeDashboard: (...a: unknown[]) => mockAnalyzeDashboard(...a),
  modifyDashboard: (...a: unknown[]) => mockModifyDashboard(...a),
}));

import { runTurnBackground } from "@/lib/turn-background";
import type { ConversationRow } from "@/lib/turn-background";
import type { InitialContext } from "@/lib/conversation-types";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TURN_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeConv(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "abcdef012345",
    mode: "chat",
    title: null,
    first_user_prompt: null,
    context_url: null,
    context_kind: "global",
    context_ref: null,
    created_at: "2026-01-01T00:00:00Z",
    last_interaction_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    last_status: "ok",
    llm_provider: "openrouter",
    llm_driver: null,
    initial_context: null,
    created_by: null,
    last_read_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateTurnStatus.mockResolvedValue(undefined);
  mockInsertTurnEvent.mockResolvedValue(undefined);
  mockLoadMessages.mockResolvedValue([]);
  mockAppendMessage.mockResolvedValue({ id: "msg-001" });
  mockMaybeGenerateTitle.mockResolvedValue(undefined);
  mockTouchConversation.mockResolvedValue(undefined);
  mockRunAgenticChat.mockResolvedValue({ content: "LLM reply" });
  mockSql.mockResolvedValue([]);
  mockAnalyzeDashboard.mockResolvedValue("Analysis result");
  mockModifyDashboard.mockResolvedValue("Modify result");
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runTurnBackground — free-chat path", () => {
  it("transitions status streaming→complete on success", async () => {
    await runTurnBackground(TURN_ID, makeConv(), "hello");

    expect(mockUpdateTurnStatus).toHaveBeenNthCalledWith(1, TURN_ID, "streaming");
    expect(mockUpdateTurnStatus).toHaveBeenLastCalledWith(TURN_ID, "complete");
  });

  it("emits context event as first turn_event", async () => {
    await runTurnBackground(TURN_ID, makeConv(), "hello");

    const [, seq, type] = mockInsertTurnEvent.mock.calls[0] as [string, number, string];
    expect(seq).toBe(0);
    expect(type).toBe("context");
  });

  it("includes requestId in context payload", async () => {
    await runTurnBackground(TURN_ID, makeConv(), "hello");

    const contextPayload = mockInsertTurnEvent.mock.calls[0][3] as Record<string, unknown>;
    expect(contextPayload.requestId).toBe("req_test");
  });

  it("persists user message to conversation_messages before LLM call", async () => {
    await runTurnBackground(TURN_ID, makeConv(), "user input");

    const appendCalls = mockAppendMessage.mock.calls;
    const userCall = appendCalls.find(([, role]) => role === "user");
    expect(userCall).toBeDefined();
    expect(userCall?.[2]).toEqual({ text: "user input" });
  });

  it("persists assistant reply to conversation_messages", async () => {
    await runTurnBackground(TURN_ID, makeConv(), "hello");

    const appendCalls = mockAppendMessage.mock.calls;
    const assistantCall = appendCalls.find(([, role]) => role === "assistant");
    expect(assistantCall).toBeDefined();
    expect(assistantCall?.[2]).toEqual({ text: "LLM reply" });
  });

  it("uses initial_context when set", async () => {
    const ctx: InitialContext = { model: "custom-model", provider: "cli" };
    await runTurnBackground(TURN_ID, makeConv({ initial_context: ctx }), "hi");

    const contextPayload = mockInsertTurnEvent.mock.calls[0][3] as Record<string, unknown>;
    expect((contextPayload.context as Record<string, unknown>).model).toBe("custom-model");
  });
});

describe("runTurnBackground — error path", () => {
  it("marks turn as error when LLM throws", async () => {
    mockRunAgenticChat.mockRejectedValue(new Error("LLM unavailable"));

    await runTurnBackground(TURN_ID, makeConv(), "hello");

    expect(mockUpdateTurnStatus).toHaveBeenCalledWith(TURN_ID, "error", "LLM unavailable");
  });

  it("marks turn as error when loadMessages throws", async () => {
    mockLoadMessages.mockRejectedValue(new Error("DB down"));

    await runTurnBackground(TURN_ID, makeConv(), "hello");

    expect(mockUpdateTurnStatus).toHaveBeenCalledWith(TURN_ID, "error", "DB down");
  });

  it("stores error event with message and timestamp", async () => {
    mockRunAgenticChat.mockRejectedValue(new Error("boom"));

    await runTurnBackground(TURN_ID, makeConv(), "hello");

    const errCall = mockInsertTurnEvent.mock.calls.find(([, , type]) => type === "error");
    expect(errCall).toBeDefined();
    expect((errCall?.[3] as Record<string, unknown>).message).toBe("boom");
  });
});

describe("runTurnBackground — dashboard analyze path", () => {
  it("calls analyzeDashboard and completes turn", async () => {
    const conv = makeConv({ mode: "analyze", context_kind: "dashboard", context_ref: "42" });
    mockSql.mockResolvedValue([{ spec: { widgets: [] } }]);

    await runTurnBackground(TURN_ID, conv, "explain the data");

    expect(mockAnalyzeDashboard).toHaveBeenCalledOnce();
    expect(mockUpdateTurnStatus).toHaveBeenLastCalledWith(TURN_ID, "complete");
  });

  it("does NOT emit spec_update for analyze turns", async () => {
    const conv = makeConv({ mode: "analyze", context_kind: "dashboard", context_ref: "42" });
    mockSql.mockResolvedValue([]);

    await runTurnBackground(TURN_ID, conv, "analyze");

    const specCall = mockInsertTurnEvent.mock.calls.find(([, , type]) => type === "spec_update");
    expect(specCall).toBeUndefined();
  });

  it("handles missing dashboard spec gracefully", async () => {
    const conv = makeConv({ mode: "analyze", context_kind: "dashboard", context_ref: "999" });
    mockSql.mockResolvedValue([]);

    await runTurnBackground(TURN_ID, conv, "analyze");

    expect(mockUpdateTurnStatus).toHaveBeenLastCalledWith(TURN_ID, "complete");
  });
});

describe("runTurnBackground — dashboard modify path", () => {
  it("emits spec_update when modifyDashboard sets modifyResult", async () => {
    const conv = makeConv({ mode: "modify", context_kind: "dashboard", context_ref: "42" });
    mockSql.mockResolvedValue([{ spec: { widgets: [] } }]);
    mockModifyDashboard.mockImplementation(
      (_spec: unknown, _msg: unknown, agenticCtx: Record<string, unknown>) => {
        agenticCtx.modifyResult = { spec: { widgets: [{ type: "kpi" }] }, summary: "Updated" };
        return Promise.resolve("I've updated the dashboard.");
      },
    );

    await runTurnBackground(TURN_ID, conv, "add a KPI widget");

    const specCall = mockInsertTurnEvent.mock.calls.find(([, , type]) => type === "spec_update");
    expect(specCall).toBeDefined();
    expect((specCall?.[3] as Record<string, unknown>).prompt).toBe("add a KPI widget");
  });

  it("does not emit spec_update when modifyResult is absent", async () => {
    const conv = makeConv({ mode: "modify", context_kind: "dashboard", context_ref: "42" });
    mockSql.mockResolvedValue([{ spec: { widgets: [] } }]);

    await runTurnBackground(TURN_ID, conv, "change colors");

    const specCall = mockInsertTurnEvent.mock.calls.find(([, , type]) => type === "spec_update");
    expect(specCall).toBeUndefined();
  });

  it("completes without spec_update when DB persist fails", async () => {
    const conv = makeConv({ mode: "modify", context_kind: "dashboard", context_ref: "42" });
    // First sql call returns current spec; second (UPDATE) throws
    mockSql
      .mockResolvedValueOnce([{ spec: { widgets: [] } }])
      .mockRejectedValueOnce(new Error("DB write failure"));
    mockModifyDashboard.mockImplementation(
      (_spec: unknown, _msg: unknown, agenticCtx: Record<string, unknown>) => {
        agenticCtx.modifyResult = { spec: { widgets: [] }, summary: "" };
        return Promise.resolve("Updated.");
      },
    );

    await runTurnBackground(TURN_ID, conv, "tweak layout");

    // Turn completes successfully even if spec persist failed
    expect(mockUpdateTurnStatus).toHaveBeenLastCalledWith(TURN_ID, "complete");
    const specCall = mockInsertTurnEvent.mock.calls.find(([, , type]) => type === "spec_update");
    expect(specCall).toBeUndefined();
  });
});

describe("runTurnBackground — generic fallback path", () => {
  it("uses llmComplete for non-chat, non-analyze, non-modify modes", async () => {
    const { llmComplete } = await import("@/lib/llm-client");
    const conv = makeConv({ mode: "view", context_kind: "dashboard" });

    await runTurnBackground(TURN_ID, conv, "show me the data");

    expect(llmComplete).toHaveBeenCalledOnce();
    expect(mockUpdateTurnStatus).toHaveBeenLastCalledWith(TURN_ID, "complete");
  });
});
