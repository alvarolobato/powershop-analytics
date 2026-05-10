/**
 * Tests for GET /api/conversations/:id and PATCH /api/conversations/:id
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetConversation = vi.fn();
const mockUpdateConversationTitle = vi.fn();
const mockSetConversationArchived = vi.fn();

vi.mock("@/lib/conversations", () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  updateConversationTitle: (...args: unknown[]) => mockUpdateConversationTitle(...args),
  setConversationArchived: (...args: unknown[]) => mockSetConversationArchived(...args),
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

import { GET, PATCH } from "../route";

const MOCK_CONV = {
  id: "conv-abc",
  mode: "analyze",
  title: "My conversation",
  first_user_prompt: "Hello",
  context_url: "/dashboard/1",
  context_kind: "dashboard",
  context_ref: "1",
  created_at: "2026-01-01T00:00:00Z",
  last_interaction_at: "2026-01-01T00:01:00Z",
  archived_at: null,
  last_status: "ok",
};

function params(id: string) {
  return { params: { id } };
}

beforeEach(() => {
  mockGetConversation.mockReset();
  mockUpdateConversationTitle.mockReset();
  mockSetConversationArchived.mockReset();
});

describe("GET /api/conversations/:id", () => {
  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const req = new NextRequest("http://localhost:4000/api/conversations/missing");
    const res = await GET(req, params("missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns conversation JSON when found", async () => {
    mockGetConversation.mockResolvedValue(MOCK_CONV);
    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc");
    const res = await GET(req, params("conv-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("conv-abc");
    expect(body.title).toBe("My conversation");
  });

  it("returns 500 when getConversation throws", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest("http://localhost:4000/api/conversations/bad");
    const res = await GET(req, params("bad"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });
});

describe("PATCH /api/conversations/:id", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req, params("conv-abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const req = new NextRequest("http://localhost:4000/api/conversations/missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const res = await PATCH(req, params("missing"));
    expect(res.status).toBe(404);
  });

  it("updates title when title is provided", async () => {
    mockGetConversation
      .mockResolvedValueOnce(MOCK_CONV)
      .mockResolvedValueOnce({ ...MOCK_CONV, title: "New Title" });
    mockUpdateConversationTitle.mockResolvedValue(undefined);

    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const res = await PATCH(req, params("conv-abc"));
    expect(res.status).toBe(200);
    expect(mockUpdateConversationTitle).toHaveBeenCalledWith("conv-abc", "New Title");
    const body = await res.json();
    expect(body.title).toBe("New Title");
  });

  it("archives conversation when archived=true", async () => {
    mockGetConversation
      .mockResolvedValueOnce(MOCK_CONV)
      .mockResolvedValueOnce({ ...MOCK_CONV, archived_at: "2026-01-02T00:00:00Z" });
    mockSetConversationArchived.mockResolvedValue(undefined);

    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    const res = await PATCH(req, params("conv-abc"));
    expect(res.status).toBe(200);
    expect(mockSetConversationArchived).toHaveBeenCalledWith("conv-abc", true);
  });

  it("skips title update when title is empty string", async () => {
    mockGetConversation
      .mockResolvedValueOnce(MOCK_CONV)
      .mockResolvedValueOnce(MOCK_CONV);
    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    await PATCH(req, params("conv-abc"));
    expect(mockUpdateConversationTitle).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest("http://localhost:4000/api/conversations/conv-abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    const res = await PATCH(req, params("conv-abc"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });
});
