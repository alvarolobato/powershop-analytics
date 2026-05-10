/**
 * Tests for POST /api/conversations/:id/messages
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetConversationWithMessages = vi.fn();
const mockAppendMessage = vi.fn();
const mockSetInitialContext = vi.fn();
const mockUpdateLastStatus = vi.fn();
const mockLlmComplete = vi.fn();

vi.mock("@/lib/conversations", () => ({
  getConversationWithMessages: (...a: unknown[]) => mockGetConversationWithMessages(...a),
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  setInitialContext: (...a: unknown[]) => mockSetInitialContext(...a),
  updateLastStatus: (...a: unknown[]) => mockUpdateLastStatus(...a),
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: (...a: unknown[]) => mockLlmComplete(...a),
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: () => ({ provider: "openrouter", model: "test-model", cliDriver: null }),
  getEffectiveDashboardModel: () => "test-model",
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

import { POST } from "../route";

// Valid 12-character hex ID matching /^[a-f0-9]{12}$/
const VALID_ID = "abc123def456";

const CONV = {
  id: VALID_ID,
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
  llm_provider: null,
  llm_driver: null,
  initial_context: null,
  created_by: null,
  messages: [],
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
  mockGetConversationWithMessages.mockReset();
  mockAppendMessage.mockReset();
  mockSetInitialContext.mockReset();
  mockUpdateLastStatus.mockReset();
  mockLlmComplete.mockReset();
});

describe("POST /api/conversations/:id/messages", () => {
  it("returns 400 for invalid conversation ID", async () => {
    const req = new NextRequest(
      "http://localhost:4000/api/conversations/not-hex-id/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: "Hello" }),
      },
    );
    const res = await POST(req, { params: { id: "not-hex-id" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(
      `http://localhost:4000/api/conversations/${VALID_ID}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req, { params: { id: VALID_ID } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 400 when role is missing", async () => {
    const [req, ctx] = postRequest(VALID_ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 400 when content is missing", async () => {
    const [req, ctx] = postRequest(VALID_ID, { role: "user" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 400 when content exceeds 256 KB", async () => {
    // 262145 bytes > 256 * 1024 = 262144 bytes
    const [req, ctx] = postRequest(VALID_ID, {
      role: "user",
      content: "x".repeat(262145),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversationWithMessages.mockResolvedValue(null);
    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 409 when conversation is archived", async () => {
    mockGetConversationWithMessages.mockResolvedValue({
      ...CONV,
      archived_at: "2026-01-02T00:00:00Z",
    });
    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONVERSATION_ARCHIVED");
  });

  it("appends message and returns conversationId when callLlm=false", async () => {
    mockGetConversationWithMessages.mockResolvedValue(CONV);
    const mockMsg = { id: "msg-1", role: "user", content: "Hello", created_at: "2026-01-01T00:00:00Z" };
    mockAppendMessage.mockResolvedValue(mockMsg);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, {
      role: "user",
      content: "Hello",
      callLlm: false,
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationId).toBe(VALID_ID);
    expect(mockAppendMessage).toHaveBeenCalled();
  });

  it("calls LLM and returns assistant reply when callLlm=true", async () => {
    mockGetConversationWithMessages.mockResolvedValue(CONV);
    const mockUserMsg = { id: "msg-1", role: "user", content: "Hello", created_at: "2026-01-01T00:00:00Z" };
    const mockAssistantMsg = { id: "msg-2", role: "assistant", content: "Hola, ¿cómo puedo ayudarte?", created_at: "2026-01-01T00:01:00Z" };
    mockAppendMessage
      .mockResolvedValueOnce(mockUserMsg)
      .mockResolvedValueOnce(mockAssistantMsg);
    mockSetInitialContext.mockResolvedValue(undefined);
    mockUpdateLastStatus.mockResolvedValue(undefined);
    mockLlmComplete.mockResolvedValue({
      text: "Hola, ¿cómo puedo ayudarte?",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: null,
      },
    });

    const [req, ctx] = postRequest(VALID_ID, {
      role: "user",
      content: "Hello",
      callLlm: true,
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationId).toBe(VALID_ID);
    expect(body.assistantMessage).toEqual(mockAssistantMsg);
    expect(mockLlmComplete).toHaveBeenCalled();
  });

  it("returns 500 when an unexpected DB error is thrown", async () => {
    mockGetConversationWithMessages.mockRejectedValue(new Error("DB failure"));

    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_QUERY");
  });
});
