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

// Valid 12-character hex ID that passes the route's validateId check.
const VALID_ID = "a1b2c3d4e5f6";

const MOCK_CONV = {
  id: VALID_ID,
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
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockGetConversation.mockReset();
  mockUpdateConversationTitle.mockReset();
  mockSetConversationArchived.mockReset();
});

describe("GET /api/conversations/:id", () => {
  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`);
    const res = await GET(req, params(VALID_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns conversation JSON when found", async () => {
    mockGetConversation.mockResolvedValue(MOCK_CONV);
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`);
    const res = await GET(req, params(VALID_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_ID);
    expect(body.title).toBe("My conversation");
  });

  it("returns 500 when getConversation throws", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`);
    const res = await GET(req, params(VALID_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });
});

describe("PATCH /api/conversations/:id", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req, params(VALID_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 404 when conversation not found", async () => {
    mockGetConversation.mockResolvedValue(null);
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const res = await PATCH(req, params(VALID_ID));
    expect(res.status).toBe(404);
  });

  it("updates title when title is provided", async () => {
    mockGetConversation.mockResolvedValue({ ...MOCK_CONV, title: "New Title" });
    mockUpdateConversationTitle.mockResolvedValue(undefined);

    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    const res = await PATCH(req, params(VALID_ID));
    expect(res.status).toBe(200);
    expect(mockUpdateConversationTitle).toHaveBeenCalledWith(VALID_ID, "New Title");
    const body = await res.json();
    expect(body.title).toBe("New Title");
  });

  it("archives conversation when archived=true", async () => {
    mockGetConversation.mockResolvedValue({ ...MOCK_CONV, archived_at: "2026-01-02T00:00:00Z" });
    mockSetConversationArchived.mockResolvedValue(undefined);

    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    const res = await PATCH(req, params(VALID_ID));
    expect(res.status).toBe(200);
    expect(mockSetConversationArchived).toHaveBeenCalledWith(VALID_ID, true);
  });

  it("skips title update for whitespace-only title", async () => {
    mockGetConversation.mockResolvedValue(MOCK_CONV);
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    await PATCH(req, params(VALID_ID));
    expect(mockUpdateConversationTitle).not.toHaveBeenCalled();
  });

  it("returns 500 when database throws", async () => {
    mockGetConversation.mockRejectedValue(new Error("DB error"));
    const req = new NextRequest(`http://localhost:4000/api/conversations/${VALID_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    const res = await PATCH(req, params(VALID_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });
});
