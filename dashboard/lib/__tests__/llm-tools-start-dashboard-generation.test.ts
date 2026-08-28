import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStartDashboardGeneration } from "@/lib/llm-tools/handlers/start-dashboard-generation";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/llm", () => ({
  generateDashboard: vi.fn(),
}));

vi.mock("@/lib/db-write", () => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/conversations", () => ({
  appendMessage: vi.fn(),
  migrateConversationToDashboard: vi.fn(),
}));

vi.mock("@/lib/turn-events", () => ({
  createBackgroundTurn: vi.fn(),
  insertTurnEvent: vi.fn(),
  updateTurnStatus: vi.fn(),
}));

vi.mock("@/lib/sse-pubsub", () => ({
  publish: vi.fn(),
}));

// Minimal valid spec returned by the mocked generateDashboard
const VALID_SPEC_JSON = JSON.stringify({
  title: "Panel de ventas",
  description: "Ventas por tienda",
  widgets: [
    {
      type: "bar_chart",
      title: "Ventas por tienda",
      sql: "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas GROUP BY tienda",
      x: "label",
      y: "value",
    },
  ],
});

const ctx: LlmAgenticContext = {
  requestId: "req_test_generate",
  endpoint: "test",
};

const ctxWithConv: LlmAgenticContext = {
  ...ctx,
  conversationId: "conv-abc123",
};

/** A promise plus its resolve/reject, for controlling exactly when a mock settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setUpConversationMocks(turnId = "turn-1") {
  const { createBackgroundTurn } = await import("@/lib/turn-events");
  const { appendMessage } = await import("@/lib/conversations");
  vi.mocked(createBackgroundTurn).mockResolvedValue(turnId);
  vi.mocked(appendMessage).mockResolvedValue({
    id: "msg-1",
    conversation_id: "conv-abc123",
    role: "assistant",
    content: {},
    created_at: new Date().toISOString(),
  } as never);
  return { createBackgroundTurn, appendMessage };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("handleStartDashboardGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns INVALID_ARGS for non-JSON rawArgs", async () => {
    const result = await handleStartDashboardGeneration("not-json", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  it("returns INVALID_ARGS for empty prompt", async () => {
    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "   " }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  it("returns INVALID_ARGS when prompt is missing", async () => {
    const result = await handleStartDashboardGeneration(JSON.stringify({}), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  // ── D-049: the tool must return well before generation finishes ───────────

  it("returns 'started' immediately, without waiting for generateDashboard to resolve", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    const gen = deferred<string>();
    vi.mocked(generateDashboard).mockReturnValueOnce(gen.promise);
    await setUpConversationMocks();

    // generateDashboard's promise is still pending — if the handler awaited
    // it directly (the pre-D-049 bug), this call would hang forever (and the
    // real runner would time it out at 15s). It must resolve on its own.
    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctxWithConv,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ status: "started" });
    }
    // Never resolved — proves the assertion above didn't just get lucky with
    // an already-resolved microtask queue.
    gen.reject(new Error("unused"));
  });

  it("does not call sql (persist) synchronously — persistence happens after the handler returns", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    const gen = deferred<string>();
    vi.mocked(generateDashboard).mockReturnValueOnce(gen.promise);
    const { sql } = await import("@/lib/db-write");
    await setUpConversationMocks();

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctxWithConv,
    );
    expect(sql).not.toHaveBeenCalled();
    gen.resolve(VALID_SPEC_JSON);
  });

  // ── D-049: background success reaches the conversation ────────────────────

  it("on background success: persists an assistant message and marks the tracking turn complete", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);
    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 42 }]);
    const { migrateConversationToDashboard } = await import("@/lib/conversations");
    vi.mocked(migrateConversationToDashboard).mockResolvedValueOnce({} as never);
    const { updateTurnStatus } = await import("@/lib/turn-events");
    const { appendMessage } = await setUpConversationMocks("turn-42");

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas por tienda" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(appendMessage).toHaveBeenCalledWith(
        "conv-abc123",
        "assistant",
        expect.objectContaining({ text: expect.stringContaining("Panel de ventas") }),
      );
    });
    await vi.waitFor(() => {
      expect(updateTurnStatus).toHaveBeenCalledWith("turn-42", "complete");
    });
    expect(migrateConversationToDashboard).toHaveBeenCalledWith("conv-abc123", "42");
  });

  // ── D-049: background failures must surface, never vanish ─────────────────

  it("on background failure (generateDashboard throws): persists an is_error message and marks the turn errored", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockRejectedValueOnce(new Error("LLM timeout"));
    const { updateTurnStatus } = await import("@/lib/turn-events");
    const { appendMessage } = await setUpConversationMocks("turn-err");
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(appendMessage).toHaveBeenCalledWith(
        "conv-abc123",
        "assistant",
        expect.objectContaining({
          text: expect.stringContaining("LLM timeout"),
          is_error: true,
        }),
      );
    });
    await vi.waitFor(() => {
      expect(updateTurnStatus).toHaveBeenCalledWith(
        "turn-err",
        "error",
        expect.stringContaining("LLM timeout"),
      );
    });
    // Not swallowed server-side either.
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("on background failure (invalid spec JSON): still surfaces an is_error message", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce("this is not json at all");
    const { appendMessage } = await setUpConversationMocks("turn-badspec");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(appendMessage).toHaveBeenCalledWith(
        "conv-abc123",
        "assistant",
        expect.objectContaining({ is_error: true }),
      );
    });
  });

  it("on background failure (DB insert fails): still surfaces an is_error message", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);
    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockRejectedValueOnce(new Error("DB connection refused"));
    const { appendMessage } = await setUpConversationMocks("turn-dberr");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(appendMessage).toHaveBeenCalledWith(
        "conv-abc123",
        "assistant",
        expect.objectContaining({
          text: expect.stringContaining("Failed to save the dashboard"),
          is_error: true,
        }),
      );
    });
  });

  it("still reports background success when migrateConversationToDashboard fails (non-fatal)", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);
    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 55 }]);
    const { migrateConversationToDashboard } = await import("@/lib/conversations");
    vi.mocked(migrateConversationToDashboard).mockRejectedValueOnce(new Error("DB error"));
    const { updateTurnStatus } = await import("@/lib/turn-events");
    const { appendMessage } = await setUpConversationMocks("turn-55");

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(updateTurnStatus).toHaveBeenCalledWith("turn-55", "complete");
    });
    // Success path, not the error path — no is_error message was appended.
    expect(appendMessage).not.toHaveBeenCalledWith(
      "conv-abc123",
      "assistant",
      expect.objectContaining({ is_error: true }),
    );
    expect(appendMessage).toHaveBeenCalledWith(
      "conv-abc123",
      "assistant",
      expect.objectContaining({ text: expect.stringContaining("Panel de ventas") }),
    );
  });

  it("unwraps JSON fenced in markdown code block", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(
      "```json\n" + VALID_SPEC_JSON + "\n```",
    );
    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 33 }]);
    const { updateTurnStatus } = await import("@/lib/turn-events");
    await setUpConversationMocks("turn-33");

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel con markdown fence" }),
      ctxWithConv,
    );

    await vi.waitFor(() => {
      expect(updateTurnStatus).toHaveBeenCalledWith("turn-33", "complete");
    });
  });

  // ── No conversation attached (defensive / non-production path) ────────────

  it("runs best-effort without a conversationId and does not throw", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);
    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 10 }]);
    const { createBackgroundTurn } = await import("@/lib/turn-events");

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas" }),
      ctx, // no conversationId
    );
    expect(result.ok).toBe(true);

    // No conversation to track — no tracking turn is created.
    await new Promise((r) => setTimeout(r, 10));
    expect(createBackgroundTurn).not.toHaveBeenCalled();
  });
});
