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
const mockLoadDashboardLlmConfig = vi.fn(() => ({
  provider: "cli" as const,
  cliModel: "claude-sonnet-4-6",
  cliDriver: "claude_code" as const,
  openrouterModel: "openrouter/anthropic/claude-sonnet-4",
  openrouterModelByFlow: {} as Record<string, string>,
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
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: () => mockLoadDashboardLlmConfig(),
  getEffectiveDashboardModel: (cfg: { cliModel: string; openrouterModel: string; provider: string }) =>
    cfg.provider === "cli" ? cfg.cliModel : cfg.openrouterModel,
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

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

beforeEach(() => {
  mockGetConversation.mockReset();
  mockAppendMessage.mockReset();
  mockLoadMessages.mockReset();
  mockMaybeGenerateTitle.mockReset();
  mockTouchConversation.mockReset();
  mockSetInitialContext.mockReset();
  mockLlmComplete.mockReset();
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
    expect(mockAppendMessage).toHaveBeenCalledWith(ID, "user", { text: "Hello" });
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
    mockGetConversation.mockResolvedValue({ ...CONV, initial_context: { model: "x", provider: "cli", driver: null, systemPrompt: { stable: "" }, tools: [] } });
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
    expect(mockAppendMessage).toHaveBeenCalledWith(ID, "assistant", { text: "Reply" });
    // Should not snapshot initial_context for non-user appends
    expect(mockSetInitialContext).not.toHaveBeenCalled();
  });

  it("calls LLM and returns the assistant message row when callLlm=true", async () => {
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
    const body = await res.json();
    expect(body.message).toEqual(ASSISTANT_ROW);
    expect(mockLlmComplete).toHaveBeenCalled();
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

  it("returns 500 with LLM_ERROR when LLM call throws", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_ROW);
    mockLoadMessages.mockResolvedValue([USER_ROW]);
    mockLlmComplete.mockRejectedValue(new Error("LLM auth"));
    mockTouchConversation.mockResolvedValue(undefined);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(ID, { content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
  });
});
