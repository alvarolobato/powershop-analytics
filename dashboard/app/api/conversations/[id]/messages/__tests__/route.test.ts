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
  loadDashboardLlmConfig: vi.fn(() => ({ provider: "openrouter", cliDriver: null })),
  getEffectiveDashboardModel: vi.fn(() => "test-model"),
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

import { POST } from "../route";

// Valid 12-char hex IDs as produced by generateConversationId()
const VALID_ID = "abcdef012345";
const MISSING_ID = "000000000000";

const USER_MSG = {
  id: "m1",
  conversation_id: VALID_ID,
  role: "user",
  content: "Hello",
  tokens_input: null,
  tokens_output: null,
  tokens_cache_read: null,
  tokens_cache_creation: null,
  created_at: "2026-01-01T00:00:00Z",
};

const ASSISTANT_MSG = {
  id: "m2",
  conversation_id: VALID_ID,
  role: "assistant",
  content: "Hola, ¿cómo puedo ayudarte?",
  tokens_input: 10,
  tokens_output: 20,
  tokens_cache_read: 5,
  tokens_cache_creation: null,
  created_at: "2026-01-01T00:00:01Z",
};

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

function postRequest(id: string, body: unknown): [NextRequest, { params: { id: string } }] {
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
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
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
    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "x".repeat(256 * 1024 + 1) });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversationWithMessages.mockResolvedValue(null);
    const [req, ctx] = postRequest(MISSING_ID, { role: "user", content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when callLlm=true and role is not user", async () => {
    const [req, ctx] = postRequest(VALID_ID, { role: "assistant", content: "response", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("appends message and returns ok when callLlm=false", async () => {
    mockGetConversationWithMessages.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_MSG);
    mockSetInitialContext.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello", callLlm: false });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationId).toBe(VALID_ID);
    expect(mockAppendMessage).toHaveBeenCalledWith(VALID_ID, { role: "user", content: "Hello" });
  });

  it("calls LLM and returns reply when callLlm=true", async () => {
    mockGetConversationWithMessages.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValueOnce(USER_MSG).mockResolvedValueOnce(ASSISTANT_MSG);
    mockSetInitialContext.mockResolvedValue(undefined);
    mockLlmComplete.mockResolvedValue({
      text: "Hola, ¿cómo puedo ayudarte?",
      usage: { prompt_tokens: 10, completion_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: null },
    });
    mockUpdateLastStatus.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationId).toBe(VALID_ID);
    expect(body.assistantMessage).toBeDefined();
    expect(mockLlmComplete).toHaveBeenCalled();
  });

  it("returns 500 and marks error status when LLM throws", async () => {
    mockGetConversationWithMessages.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(USER_MSG);
    mockSetInitialContext.mockResolvedValue(undefined);
    mockLlmComplete.mockRejectedValue(new Error("LLM failure"));
    mockUpdateLastStatus.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
    expect(mockUpdateLastStatus).toHaveBeenCalledWith(VALID_ID, "error");
  });

  it("returns 500 when database throws", async () => {
    mockGetConversationWithMessages.mockRejectedValue(new Error("DB failure"));

    const [req, ctx] = postRequest(VALID_ID, { role: "user", content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_QUERY");
  });
});
