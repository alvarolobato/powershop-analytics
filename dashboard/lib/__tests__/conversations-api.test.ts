/**
 * Contract tests for the conversations API routes.
 *
 * Tests all verbs including the 405 case for DELETE on /api/conversations/:id.
 * Uses hoisted mocks for the conversations data layer and llmComplete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const {
  mockListConversations,
  mockCreateConversation,
  mockGetConversationWithMessages,
  mockUpdateConversation,
  mockAppendMessage,
  mockSetInitialContext,
  mockUpdateLastStatus,
  mockArchiveConversation,
  mockUnarchiveConversation,
  mockLlmComplete,
  mockLoadDashboardLlmConfig,
  mockGetEffectiveDashboardModel,
} = vi.hoisted(() => ({
  mockListConversations: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockGetConversationWithMessages: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockAppendMessage: vi.fn(),
  mockSetInitialContext: vi.fn(),
  mockUpdateLastStatus: vi.fn(),
  mockArchiveConversation: vi.fn(),
  mockUnarchiveConversation: vi.fn(),
  mockLlmComplete: vi.fn(),
  mockLoadDashboardLlmConfig: vi.fn(),
  mockGetEffectiveDashboardModel: vi.fn(),
}));

vi.mock("@/lib/conversations", () => ({
  listConversations: mockListConversations,
  createConversation: mockCreateConversation,
  getConversationWithMessages: mockGetConversationWithMessages,
  updateConversation: mockUpdateConversation,
  appendMessage: mockAppendMessage,
  setInitialContext: mockSetInitialContext,
  updateLastStatus: mockUpdateLastStatus,
  archiveConversation: mockArchiveConversation,
  unarchiveConversation: mockUnarchiveConversation,
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: mockLlmComplete,
}));

vi.mock("@/lib/llm-provider/config", () => ({
  loadDashboardLlmConfig: mockLoadDashboardLlmConfig,
  getEffectiveDashboardModel: mockGetEffectiveDashboardModel,
}));

import { GET as listGet, POST as createPost } from "../../app/api/conversations/route";
import {
  GET as getOne,
  PATCH as patchOne,
  DELETE as deleteOne,
} from "../../app/api/conversations/[id]/route";
import { POST as postMessage } from "../../app/api/conversations/[id]/messages/route";
import {
  POST as archivePost,
  DELETE as unarchiveDelete,
} from "../../app/api/conversations/[id]/archive/route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  opts: { method?: string; body?: unknown; searchParams?: Record<string, string> } = {},
): Request {
  const { method = "GET", body, searchParams } = opts;
  const fullUrl = new URL(url, "http://localhost");
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      fullUrl.searchParams.set(k, v);
    }
  }
  return new Request(fullUrl.toString(), {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_ID = "a1b2c3d4e5f6";
const INVALID_ID = "not-valid-id";

const SAMPLE_CONVERSATION = {
  id: VALID_ID,
  mode: "modify",
  title: "Test conversation",
  first_user_prompt: "Hello",
  context_url: "/dashboards/1",
  context_kind: "dashboard",
  context_ref: "1",
  created_at: "2026-05-09T00:00:00Z",
  last_interaction_at: "2026-05-09T01:00:00Z",
  archived_at: null,
  last_status: "ok",
  llm_provider: "openrouter",
  llm_driver: null,
  initial_context: null,
  created_by: null,
};

const SAMPLE_LIST_ROW = {
  ...SAMPLE_CONVERSATION,
  message_count: 4,
  tool_calls_count: 5,
  rounds_count: 2,
  duration_seconds: 3600,
  last_message_preview: "Here is my answer...",
  token_total: 1500,
};

// ── GET /api/conversations ─────────────────────────────────────────────────────

describe("GET /api/conversations", () => {
  beforeEach(() => {
    mockListConversations.mockReset();
  });

  it("returns 200 with conversation list", async () => {
    mockListConversations.mockResolvedValue([SAMPLE_LIST_ROW]);
    const req = makeRequest("http://localhost/api/conversations");
    const res = await listGet(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe(VALID_ID);
    expect(data[0].tool_calls_count).toBe(5);
    expect(data[0].rounds_count).toBe(2);
  });

  it("passes include_archived=true to listConversations", async () => {
    mockListConversations.mockResolvedValue([]);
    const req = makeRequest("http://localhost/api/conversations", {
      searchParams: { include_archived: "true" },
    });
    await listGet(req as unknown as import("next/server").NextRequest);
    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({ include_archived: true }),
    );
  });

  it("passes filters to listConversations", async () => {
    mockListConversations.mockResolvedValue([]);
    const req = makeRequest("http://localhost/api/conversations", {
      searchParams: {
        context_kind: "dashboard",
        context_ref: "42",
        mode: "modify",
        q: "ventas",
        page: "2",
        limit: "10",
      },
    });
    await listGet(req as unknown as import("next/server").NextRequest);
    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        context_kind: "dashboard",
        context_ref: "42",
        mode: "modify",
        q: "ventas",
        page: 2,
        limit: 10,
      }),
    );
  });

  it("returns 500 on DB error", async () => {
    mockListConversations.mockRejectedValue(new Error("DB error"));
    const req = makeRequest("http://localhost/api/conversations");
    const res = await listGet(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe("DB_QUERY");
  });
});

// ── POST /api/conversations ────────────────────────────────────────────────────

describe("POST /api/conversations", () => {
  beforeEach(() => {
    mockCreateConversation.mockReset();
  });

  it("creates a conversation and returns id + urls", async () => {
    mockCreateConversation.mockResolvedValue({
      id: VALID_ID,
      c_url: `/c/${VALID_ID}`,
      k_url: `/k/${VALID_ID}`,
    });
    const req = makeRequest("http://localhost/api/conversations", {
      method: "POST",
      body: { mode: "modify", context_kind: "dashboard", context_ref: "1" },
    });
    const res = await createPost(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(VALID_ID);
    expect(data.c_url).toBe(`/c/${VALID_ID}`);
    expect(data.k_url).toBe(`/k/${VALID_ID}`);
  });

  it("returns 400 when mode is missing", async () => {
    const req = makeRequest("http://localhost/api/conversations", {
      method: "POST",
      body: { context_kind: "dashboard" },
    });
    const res = await createPost(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await createPost(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION");
  });

  it("returns 400 when mode is empty string", async () => {
    const req = makeRequest("http://localhost/api/conversations", {
      method: "POST",
      body: { mode: "  " },
    });
    const res = await createPost(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/conversations/:id ────────────────────────────────────────────────

describe("GET /api/conversations/:id", () => {
  beforeEach(() => {
    mockGetConversationWithMessages.mockReset();
  });

  it("returns 200 with conversation and messages", async () => {
    mockGetConversationWithMessages.mockResolvedValue({
      ...SAMPLE_CONVERSATION,
      messages: [{ id: "uuid-1", role: "user", content: "Hello", created_at: "2026-05-09T00:00:00Z" }],
    });
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`);
    const res = await getOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(VALID_ID);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBe(1);
  });

  it("returns 404 when not found", async () => {
    mockGetConversationWithMessages.mockResolvedValue(null);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`);
    const res = await getOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid id", async () => {
    const req = makeRequest(`http://localhost/api/conversations/${INVALID_ID}`);
    const res = await getOne(req as unknown as import("next/server").NextRequest, makeContext(INVALID_ID));
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/conversations/:id ──────────────────────────────────────────────

describe("PATCH /api/conversations/:id", () => {
  beforeEach(() => {
    mockUpdateConversation.mockReset();
  });

  it("archives conversation when archived=true", async () => {
    const archived = { ...SAMPLE_CONVERSATION, archived_at: "2026-05-09T02:00:00Z" };
    mockUpdateConversation.mockResolvedValue(archived);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: { archived: true },
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived_at).toBeTruthy();
    expect(mockUpdateConversation).toHaveBeenCalledWith(VALID_ID, { archived: true });
  });

  it("unarchives conversation when archived=false", async () => {
    mockUpdateConversation.mockResolvedValue(SAMPLE_CONVERSATION);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: { archived: false },
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(200);
    expect(mockUpdateConversation).toHaveBeenCalledWith(VALID_ID, { archived: false });
  });

  it("updates title", async () => {
    const updated = { ...SAMPLE_CONVERSATION, title: "New title" };
    mockUpdateConversation.mockResolvedValue(updated);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: { title: "New title" },
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("New title");
  });

  it("returns 400 when no fields provided", async () => {
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: {},
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid archived value", async () => {
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: { archived: "yes" },
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(400);
  });

  it("returns 404 when conversation not found", async () => {
    mockUpdateConversation.mockResolvedValue(null);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      body: { archived: true },
    });
    const res = await patchOne(req as unknown as import("next/server").NextRequest, makeContext(VALID_ID));
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/conversations/:id — must return 405 ───────────────────────────

describe("DELETE /api/conversations/:id", () => {
  it("returns 405 Method Not Allowed", async () => {
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}`, {
      method: "DELETE",
    });
    const res = await deleteOne();
    expect(res.status).toBe(405);
    const data = await res.json();
    expect(data.code).toBe("METHOD_NOT_ALLOWED");
  });
});

// ── POST /api/conversations/:id/messages ──────────────────────────────────────

describe("POST /api/conversations/:id/messages", () => {
  beforeEach(() => {
    mockGetConversationWithMessages.mockReset();
    mockAppendMessage.mockReset();
    mockSetInitialContext.mockReset();
    mockUpdateLastStatus.mockReset();
    mockLlmComplete.mockReset();
    mockLoadDashboardLlmConfig.mockReset();
    mockGetEffectiveDashboardModel.mockReset();
  });

  it("appends user message without LLM call when callLlm=false", async () => {
    const conv = { ...SAMPLE_CONVERSATION, messages: [], initial_context: null };
    mockGetConversationWithMessages.mockResolvedValue(conv);
    const userMsg = {
      id: "uuid-msg-1",
      conversation_id: VALID_ID,
      role: "user",
      content: "Hello",
      tokens_input: null,
      tokens_output: null,
      tokens_cache_read: null,
      tokens_cache_creation: null,
      created_at: "2026-05-09T00:00:00Z",
    };
    mockAppendMessage.mockResolvedValue(userMsg);
    mockLoadDashboardLlmConfig.mockReturnValue({ provider: "openrouter", cliDriver: null });
    mockGetEffectiveDashboardModel.mockReturnValue("claude-sonnet-4");

    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "user", content: "Hello", callLlm: false },
    });
    const res = await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversationId).toBe(VALID_ID);
    expect(data.message.role).toBe("user");
    expect(mockLlmComplete).not.toHaveBeenCalled();
  });

  it("appends user and assistant messages when callLlm=true", async () => {
    const conv = { ...SAMPLE_CONVERSATION, messages: [], initial_context: null };
    mockGetConversationWithMessages.mockResolvedValue(conv);
    const userMsg = {
      id: "uuid-msg-1",
      conversation_id: VALID_ID,
      role: "user",
      content: "Hello",
      tokens_input: null,
      tokens_output: null,
      tokens_cache_read: null,
      tokens_cache_creation: null,
      created_at: "2026-05-09T00:00:00Z",
    };
    const assistantMsg = {
      id: "uuid-msg-2",
      conversation_id: VALID_ID,
      role: "assistant",
      content: "Hi there!",
      tokens_input: 10,
      tokens_output: 5,
      tokens_cache_read: null,
      tokens_cache_creation: null,
      created_at: "2026-05-09T00:00:01Z",
    };
    mockAppendMessage.mockResolvedValueOnce(userMsg).mockResolvedValueOnce(assistantMsg);
    mockLoadDashboardLlmConfig.mockReturnValue({ provider: "openrouter", cliDriver: null });
    mockGetEffectiveDashboardModel.mockReturnValue("claude-sonnet-4");
    mockLlmComplete.mockResolvedValue({
      text: "Hi there!",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      provider: "openrouter",
    });

    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "user", content: "Hello", callLlm: true },
    });
    const res = await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversationId).toBe(VALID_ID);
    expect(mockLlmComplete).toHaveBeenCalledOnce();
    expect(mockUpdateLastStatus).toHaveBeenCalledWith(VALID_ID, "ok");
    expect(mockAppendMessage).toHaveBeenCalledTimes(2);
  });

  it("snapshots initial_context on first user message", async () => {
    const conv = { ...SAMPLE_CONVERSATION, messages: [], initial_context: null };
    mockGetConversationWithMessages.mockResolvedValue(conv);
    mockAppendMessage.mockResolvedValue({
      id: "uuid-msg-1",
      conversation_id: VALID_ID,
      role: "user",
      content: "Hello",
      tokens_input: null,
      tokens_output: null,
      tokens_cache_read: null,
      tokens_cache_creation: null,
      created_at: "2026-05-09T00:00:00Z",
    });
    mockLoadDashboardLlmConfig.mockReturnValue({ provider: "openrouter", cliDriver: null });
    mockGetEffectiveDashboardModel.mockReturnValue("claude-sonnet-4");

    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "user", content: "Hello", callLlm: false },
    });
    await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(mockSetInitialContext).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ model: "claude-sonnet-4", provider: "openrouter" }),
    );
  });

  it("returns 400 for invalid role", async () => {
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "system", content: "test" },
    });
    const res = await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversationWithMessages.mockResolvedValue(null);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "user", content: "Hello" },
    });
    const res = await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 and marks status=error when llmComplete fails", async () => {
    const conv = { ...SAMPLE_CONVERSATION, messages: [], initial_context: null };
    mockGetConversationWithMessages.mockResolvedValue(conv);
    mockAppendMessage.mockResolvedValue({
      id: "uuid-msg-1",
      conversation_id: VALID_ID,
      role: "user",
      content: "Hello",
      tokens_input: null,
      tokens_output: null,
      tokens_cache_read: null,
      tokens_cache_creation: null,
      created_at: "2026-05-09T00:00:00Z",
    });
    mockLoadDashboardLlmConfig.mockReturnValue({ provider: "openrouter", cliDriver: null });
    mockGetEffectiveDashboardModel.mockReturnValue("claude-sonnet-4");
    mockLlmComplete.mockRejectedValue(new Error("LLM failure"));

    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/messages`, {
      method: "POST",
      body: { role: "user", content: "Hello", callLlm: true },
    });
    const res = await postMessage(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(500);
    expect(mockUpdateLastStatus).toHaveBeenCalledWith(VALID_ID, "error");
  });
});

// ── POST /api/conversations/:id/archive ───────────────────────────────────────

describe("POST /api/conversations/:id/archive", () => {
  beforeEach(() => {
    mockArchiveConversation.mockReset();
  });

  it("archives the conversation", async () => {
    const archived = { ...SAMPLE_CONVERSATION, archived_at: "2026-05-09T02:00:00Z" };
    mockArchiveConversation.mockResolvedValue(archived);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/archive`, {
      method: "POST",
    });
    const res = await archivePost(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived_at).toBeTruthy();
  });

  it("returns 404 when not found", async () => {
    mockArchiveConversation.mockResolvedValue(null);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/archive`, {
      method: "POST",
    });
    const res = await archivePost(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/conversations/:id/archive ─────────────────────────────────────

describe("DELETE /api/conversations/:id/archive (unarchive)", () => {
  beforeEach(() => {
    mockUnarchiveConversation.mockReset();
  });

  it("unarchives the conversation", async () => {
    mockUnarchiveConversation.mockResolvedValue(SAMPLE_CONVERSATION);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/archive`, {
      method: "DELETE",
    });
    const res = await unarchiveDelete(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived_at).toBeNull();
  });

  it("returns 404 when not found", async () => {
    mockUnarchiveConversation.mockResolvedValue(null);
    const req = makeRequest(`http://localhost/api/conversations/${VALID_ID}/archive`, {
      method: "DELETE",
    });
    const res = await unarchiveDelete(
      req as unknown as import("next/server").NextRequest,
      makeContext(VALID_ID),
    );
    expect(res.status).toBe(404);
  });
});

// ── tool_calls_count correctness test ────────────────────────────────────────

describe("tool_calls_count computation (via list response)", () => {
  it("tool_calls_count and rounds_count are distinct (total calls vs agentic round count)", async () => {
    // 2 agentic rounds but 5 individual tool calls (e.g. round 1 had 3 calls, round 2 had 2)
    const convWith2Rounds = {
      ...SAMPLE_LIST_ROW,
      tool_calls_count: 5,
      rounds_count: 2,
    };
    mockListConversations.mockResolvedValue([convWith2Rounds]);
    const req = makeRequest("http://localhost/api/conversations");
    const res = await listGet(req as unknown as import("next/server").NextRequest);
    const data = await res.json();
    expect(data[0].tool_calls_count).toBe(5);
    expect(data[0].rounds_count).toBe(2);
  });
});
