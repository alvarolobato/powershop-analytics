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
const mockLlmComplete = vi.fn();

vi.mock("@/lib/conversations", () => ({
  getConversation: (...a: unknown[]) => mockGetConversation(...a),
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  loadMessages: (...a: unknown[]) => mockLoadMessages(...a),
  maybeGenerateTitle: (...a: unknown[]) => mockMaybeGenerateTitle(...a),
  touchConversation: (...a: unknown[]) => mockTouchConversation(...a),
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: (...a: unknown[]) => mockLlmComplete(...a),
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
};

function postRequest(
  id: string,
  body: unknown,
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost:4000/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  mockGetConversation.mockReset();
  mockAppendMessage.mockReset();
  mockLoadMessages.mockReset();
  mockMaybeGenerateTitle.mockReset();
  mockTouchConversation.mockReset();
  mockLlmComplete.mockReset();
});

describe("POST /api/conversations/:id/messages", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(
      `http://localhost:4000/api/conversations/${VALID_ID}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: VALID_ID }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 400 when content is missing", async () => {
    const [req, ctx] = postRequest(VALID_ID, {});
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_CONTENT");
  });

  it("returns 400 when content is empty string", async () => {
    const [req, ctx] = postRequest(VALID_ID, { content: "" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_CONTENT");
  });

  it("returns 400 when content exceeds 10000 characters", async () => {
    const [req, ctx] = postRequest(VALID_ID, { content: "x".repeat(10001) });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CONTENT_TOO_LONG");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const [req, ctx] = postRequest(VALID_ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 409 when conversation is archived", async () => {
    mockGetConversation.mockResolvedValue({
      ...CONV,
      archived_at: "2026-01-02T00:00:00Z",
    });
    const [req, ctx] = postRequest(VALID_ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONVERSATION_ARCHIVED");
  });

  it("appends message and returns ok:true when callLlm=false", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(undefined);
    mockTouchConversation.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, { content: "Hello", callLlm: false });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockAppendMessage).toHaveBeenCalledWith(VALID_ID, "user", { text: "Hello" });
  });

  it("calls LLM and returns message when callLlm=true", async () => {
    mockGetConversation.mockResolvedValue(CONV);
    mockAppendMessage.mockResolvedValue(undefined);
    mockLoadMessages.mockResolvedValue([]);
    mockTouchConversation.mockResolvedValue(undefined);
    mockMaybeGenerateTitle.mockResolvedValue(undefined);
    mockLlmComplete.mockResolvedValue({ text: "Hola, ¿cómo puedo ayudarte?" });

    const [req, ctx] = postRequest(VALID_ID, { content: "Hello", callLlm: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Hola, ¿cómo puedo ayudarte?");
    expect(mockLlmComplete).toHaveBeenCalled();
  });

  it("returns 500 on unexpected error", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB failure"));
    mockTouchConversation.mockResolvedValue(undefined);

    const [req, ctx] = postRequest(VALID_ID, { content: "Hello" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_ERROR");
  });
});
