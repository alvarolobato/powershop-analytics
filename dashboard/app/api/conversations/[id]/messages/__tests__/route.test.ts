/**
 * Tests for POST /api/conversations/:id/messages
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetConversation = vi.fn();
const mockAppendMessage = vi.fn();
const mockLoadMessages = vi.fn();
const mockMaybeGenerateTitle = vi.fn();
const mockTouchConversation = vi.fn();
const mockSetInitialContext = vi.fn();
const mockLlmComplete = vi.fn();
const mockRunAgenticChat = vi.fn();
const mockCreateDashboardAgenticAdapter = vi.fn(() => ({}));
const mockBuildFreeChatContext = vi.fn(() => ({
  systemPrompt: { stable: "Eres un asistente analítico de PowerShop Analytics. " + "x".repeat(200) },
  tools: Array.from({ length: 11 }, (_, i) => ({
    type: "function" as const,
    function: { name: `tool_${i}`, description: "test tool", parameters: { type: "object", properties: {} } },
  })),
}));
const mockBuildAgenticErrorDiagnostic = vi.fn((_err: unknown, _cfg: unknown) => ({
  subError: "test error",
  provider: "openrouter",
}));
const mockPersistAgenticError = vi.fn();
const mockLoadDashboardLlmConfig = vi.fn(() => ({
  provider: "cli" as const,
  cliModel: "claude-sonnet-4-6",
  cliDriver: "claude_code" as const,
  openrouterModel: "openrouter/anthropic/claude-sonnet-4",
  openrouterModelByFlow: {} as Record<string, string>,
}));
const mockGetAgenticConfig = vi.fn(() => ({
  maxToolRounds: 8,
  maxToolCalls: 24,
  toolTimeoutMs: 15000,
  maxRows: 200,
  maxColumns: 30,
  maxResultChars: 20000,
}));

vi.mock("@/lib/conversations", () => ({
  getConversation: (...a: unknown[]) => mockGetConversation(...a),
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  loadMessages: (...a: unknown[]) => mockLoadMessages(...a),
  maybeGenerateTitle: (...a: unknown[]) => mockMaybeGenerateTitle(...a),
  touchConversation: (...a: unknown[]) => mockTouchConversation(...a),
  setInitialContext: (...a: unknown[]) => mockSetInitialContext(...a),
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: (...a: unknown[]) => mockLlmComplete(...a),
  createDashboardAgenticAdapter: () => mockCreateDashboardAgenticAdapter(),
}));

vi.mock("@/lib/llm-tools/runner", () => ({
  runAgenticChat: (...a: unknown[]) => mockRunAgenticChat(...a),
  AgenticRunnerError: class AgenticRunnerError extends Error {
    code: string;
    requestId: string;
    diagnostic?: unknown;
    constructor(code: string, message: string, requestId: string, diagnostic?: unknown) {
      super(message);
      this.name = "AgenticRunnerError";
      this.code = code;
      this.requestId = requestId;
      this.diagnostic = diagnostic;
    }
  },
}));

const mockBuildFreeChatInitialContextSnapshot = vi.fn(() => ({
  model: "claude-sonnet-4-6",
  provider: "cli" as const,
  driver: "claude_code" as const,
  system_prompt_stable: "Eres un asistente analítico de PowerShop Analytics. " + "x".repeat(200),
  tools: Array.from({ length: 11 }, (_, i) => ({
    name: `tool_${i}`,
    schema: { name: `tool_${i}`, description: "test tool", parameters: { type: "object", properties: {} } },
  })),
  config: { flow: "chat", tool_rounds_max: 8, tool_calls_max: 24, tool_timeout_ms: 15000 },
}));

vi.mock("@/lib/conversation-context", () => ({
  buildFreeChatContext: () => mockBuildFreeChatContext(),
  buildFreeChatInitialContextSnapshot: () => mockBuildFreeChatInitialContextSnapshot(),
}));

vi.mock("@/lib/llm-tools/config", () => ({
  getAgenticConfig: () => mockGetAgenticConfig(),
}));

vi.mock("@/lib/llm-tools/diagnostic", () => ({
  buildAgenticErrorDiagnostic: (...a: unknown[]) => mockBuildAgenticErrorDiagnostic(...(a as [unknown, unknown])),
  persistAgenticError: (...a: unknown[]) => mockPersistAgenticError(...a),
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: () => mockLoadDashboardLlmConfig(),
  getEffectiveDashboardModel: (cfg: { cliModel: string; openrouterModel: string; provider: string }) =>
    cfg.provider === "cli" ? cfg.cliModel : cfg.openrouterModel,
  getEffectiveOpenRouterProvider: () => undefined,
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

// Mock @/lib/db (read pool) used in Feature 4 dashboard context lookup.
vi.mock("@/lib/db", () => ({
  sql: vi.fn().mockResolvedValue([]),
}));

import { POST } from "../route";

// Valid 12-char lowercase hex (matches route ID_PATTERN).
const ID = "abcdef012345";

const CONV = {
  id: ID,
  mode: "analyze",
  title: "My conv",
  first_user_prompt: "Hello",
  context_url: null,
  context_kind: "dashboard",
  context_ref: "1",
  created_at: "2026-01-01T00:00:00Z",
  last_interaction_at: "2026-01-01T00:01:00Z",
  archived_at: null,
  last_status: "ok",
  initial_context: null,
};

const GLOBAL_CONV = {
  ...CONV,
  context_kind: "global",
  mode: "chat",
  context_ref: null,
};

const USER_ROW = {
  id: "m-user-1",
  conversation_id: ID,
  role: "user",
  content: { text: "Hello" },
  created_at: "2026-01-01T00:00:01Z",
};
const ASSISTANT_ROW = {
  id: "m-asst-1",
  conversation_id: ID,
  role: "assistant",
  content: { text: "Hola, ¿cómo puedo ayudarte?" },
  created_at: "2026-01-01T00:00:02Z",
};

function postRequest(
  id: string,
  body: unknown,
): [NextRequest, { params: { id: string } }] {
  return [
    new NextRequest(`http://localhost:4000/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  ];
}

/**
 * Parse an NDJSON streaming response — returns all frames as an array.
 * Used when callLlm=true (the route now returns application/x-ndjson).
 */
async function readNdjsonFrames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Return the last non-progress frame (result or error). */
async function readNdjsonResult(res: Response): Promise<Record<string, unknown>> {
  const frames = await readNdjsonFrames(res);
  const terminal = frames.find((f) => f.type === "result" || f.type === "error");
  if (!terminal) throw new Error(`No terminal frame found. Frames: ${JSON.stringify(frames)}`);
  return terminal;
}

beforeEach(() => {
  mockGetConversation.mockReset();
  mockAppendMessage.mockReset();
  mockLoadMessages.mockReset();
  mockMaybeGenerateTitle.mockReset();
  mockTouchConversation.mockReset();
  mockSetInitialContext.mockReset();
  mockLlmComplete.mockReset();
  mockRunAgenticChat.mockReset();
  mockCreateDashboardAgenticAdapter.mockReset().mockReturnValue({});
  mockBuildFreeChatContext.mockReset().mockReturnValue({
    systemPrompt: { stable: "Eres un asistente analítico de PowerShop Analytics. " + "x".repeat(200) },
    tools: Array.from({ length: 11 }, (_, i) => ({
      type: "function" as const,
      function: { name: `tool_${i}`, description: "test tool", parameters: { type: "object", properties: {} } },
    })),
  });
  mockBuildFreeChatInitialContextSnapshot.mockReset().mockReturnValue({
    model: "claude-sonnet-4-6",
    provider: "cli" as const,
    driver: "claude_code" as const,
    system_prompt_stable: "Eres un asistente analítico de PowerShop Analytics. " + "x".repeat(200),
    tools: Array.from({ length: 11 }, (_, i) => ({
      name: `tool_${i}`,
      schema: { name: `tool_${i}`, description: "test tool", parameters: { type: "object", properties: {} } },
    })),
    config: { flow: "chat", tool_rounds_max: 8, tool_calls_max: 24, tool_timeout_ms: 15000 },
  });
  mockBuildAgenticErrorDiagnostic.mockReset().mockReturnValue({ subError: "test error", provider: "openrouter" } as ReturnType<typeof mockBuildAgenticErrorDiagnostic>);
  mockPersistAgenticError.mockReset();
});

describe("POST /api/conversations/:id/messages", () => {
  it("returns 400 for structurally invalid IDs", async () => {
    const [req, ctx] = postRequest("not-hex", { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(`http://localhost:4000/api/conversations/${ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req, { params: { id: ID } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 400 when content is missing", async () => {
    const [req, ctx] = postRequest(ID, {});
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_CONTENT");
  });

  it("returns 400 when content is empty string", async () => {
    const [req, ctx] = postRequest(ID, { content: "   " });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_CONTENT");
  });

  it("returns 400 when content exceeds 10000 chars", async () => {
    const [req, ctx] = postRequest(ID, { content: "x".repeat(10_001) });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CONTENT_TOO_LONG");
  });

  it("returns 400 when role is invalid", async () => {
    const [req, ctx] = postRequest(ID, { content: "Hello", role: "bogus" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_ROLE");
  });

  it("returns 400 when callLlm=true with role!=user", async () => {
    const [req, ctx] = postRequest(ID, { content: "Hi", callLlm: true, role: "assistant" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_ROLE");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const [req, ctx] = postRequest(ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 409 when conversation is archived", async () => {
    mockGetConversation.mockResolvedValue({ ...CONV, archived_at: "2026-01-02T00:00:00Z" });
    const [req, ctx] = postRequest(ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONVERSATION_ARCHIVED");
  });

  it("appends message and returns ok+row when callLlm=false", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: false });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toEqual(USER_ROW);
    // Route now uses object form of appendMessage (includes logs field)
    expect(mockAppendMessage).toHaveBeenCalledWith(ID, expect.objectContaining({ role: "user", content: { text: "Hello" } }));
  });

  it("snapshots initial_context only when it is null and role=user", async () => {
    mockGetConversation.mockResolvedValue(CONV); // initial_context: null
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: false });
    await POST(req, ctx);
    expect(mockSetInitialContext).toHaveBeenCalledTimes(1);
    expect(mockSetInitialContext.mock.calls[0][0]).toBe(ID);
  });

  it("does NOT snapshot initial_context when already set", async () => {
    mockGetConversation.mockResolvedValue({ ...CONV, initial_context: { model: "x", provider: "cli", driver: null } });
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockTouchConversation.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello" });
    await POST(req, ctx);
    expect(mockSetInitialContext).not.toHaveBeenCalled();
  });

  it("accepts non-user role when callLlm=false", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue({ ...USER_ROW, role: "assistant" });
    mockTouchConversation.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Reply", role: "assistant" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockAppendMessage).toHaveBeenCalledWith(ID, expect.objectContaining({ role: "assistant", content: { text: "Reply" } }));
    // Should not snapshot initial_context for non-user appends
    expect(mockSetInitialContext).not.toHaveBeenCalled();
  });

  it("calls LLM and streams NDJSON result when callLlm=true (non-free-chat)", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage
      .mockResolvedValueOnce(USER_ROW) // user append
      .mockResolvedValueOnce(ASSISTANT_ROW); // assistant append
    mockLoadMessages.mockResolvedValue([USER_ROW]);
    mockLlmComplete.mockResolvedValue({
      text: "Hola, ¿cómo puedo ayudarte?",
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    mockTouchConversation.mockResolvedValue(undefined);
    mockMaybeGenerateTitle.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const frame = await readNdjsonResult(res);
    expect(frame.type).toBe("result");
    expect(frame.message).toEqual(ASSISTANT_ROW);
    // Non-free-chat falls back to llmComplete
    expect(mockLlmComplete).toHaveBeenCalled();
    expect(mockRunAgenticChat).not.toHaveBeenCalled();
  });

  // ── Free-chat (context_kind='global') tests ──────────────────────────────────

  it("uses the agentic runner with FREE_CHAT_TOOLS for context_kind=global and streams NDJSON", async () => {
    mockGetConversation.mockResolvedValue(GLOBAL_CONV);
    mockAppendMessage
      .mockResolvedValueOnce(USER_ROW)
      .mockResolvedValueOnce(ASSISTANT_ROW);
    mockLoadMessages.mockResolvedValue([USER_ROW]);
    mockRunAgenticChat.mockResolvedValue({
      content: "Hay 26 tablas ps_* en el mirror.",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    mockTouchConversation.mockResolvedValue(undefined);
    mockMaybeGenerateTitle.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "lista tablas ps_*", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const frame = await readNdjsonResult(res);
    expect(frame.type).toBe("result");

    // Agentic runner must have been called instead of llmComplete
    expect(mockRunAgenticChat).toHaveBeenCalledTimes(1);
    expect(mockLlmComplete).not.toHaveBeenCalled();

    // Verify it was called with 11 tools and a non-empty system prompt
    const callArgs = mockRunAgenticChat.mock.calls[0][0] as {
      tools: unknown[];
      systemPrompt: string;
    };
    expect(callArgs.tools).toHaveLength(11);
    expect(typeof callArgs.systemPrompt).toBe("string");
    expect(callArgs.systemPrompt.length).toBeGreaterThan(100);
  });

  it("snapshots initial_context with real system prompt and tools for context_kind=global", async () => {
    mockGetConversation.mockResolvedValue(GLOBAL_CONV); // initial_context: null
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "hola", callLlm: false });
    await POST(req, ctx);

    expect(mockSetInitialContext).toHaveBeenCalledTimes(1);
    const snapshot = mockSetInitialContext.mock.calls[0][1] as {
      system_prompt_stable: string;
      tools: Array<{ name: string; schema: unknown }>;
      config: { flow: string; tool_rounds_max: number };
    };
    expect(snapshot.system_prompt_stable.length).toBeGreaterThan(100);
    expect(snapshot.tools.length).toBeGreaterThanOrEqual(11);
    expect(snapshot.config.flow).toBe("chat");
    expect(typeof snapshot.config.tool_rounds_max).toBe("number");
  });

  it("streams NDJSON error frame when agentic runner throws AgenticRunnerError", async () => {
    const { AgenticRunnerError } = await import("@/lib/llm-tools/runner");
    mockGetConversation.mockResolvedValue(GLOBAL_CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockLoadMessages.mockResolvedValue([USER_ROW]);
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);
    mockRunAgenticChat.mockRejectedValue(
      new AgenticRunnerError("AGENTIC_MAX_ROUNDS", "Too many rounds", "test-req-id"),
    );

    const [req, ctx] = postRequest(ID, { content: "hola", callLlm: true });
    const res = await POST(req, ctx);
    // NDJSON stream always returns HTTP 200; error is signalled via error frame.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const frame = await readNdjsonResult(res);
    expect(frame.type).toBe("error");
    expect(frame.code).toBe("AGENTIC_RUNNER");
  });

  it("returns 500 with DB_ERROR when DB phase throws", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB failure"));
    mockTouchConversation.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });

  it("returns 500 with DB_ERROR when loadMessages throws during callLlm=true", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockLoadMessages.mockRejectedValue(new Error("PG timeout"));
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
    expect(mockLlmComplete).not.toHaveBeenCalled();
    expect(mockRunAgenticChat).not.toHaveBeenCalled();
  });

  it("streams NDJSON error frame with LLM_ERROR when LLM call throws (non-free-chat)", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockLoadMessages.mockResolvedValue([USER_ROW]);
    mockLlmComplete.mockRejectedValue(new Error("LLM auth"));
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    // NDJSON stream always returns HTTP 200; error is signalled via error frame.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const frame = await readNdjsonResult(res);
    expect(frame.type).toBe("error");
    expect(frame.code).toBe("LLM_ERROR");
  });

  it("callLlm=false still works and does not call runner or llmComplete", async () => {
    mockGetConversation.mockResolvedValue(GLOBAL_CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "hello", callLlm: false });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockRunAgenticChat).not.toHaveBeenCalled();
    expect(mockLlmComplete).not.toHaveBeenCalled();
  });
});
