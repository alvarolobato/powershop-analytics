/**
 * Tests for POST /api/conversations
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreateConversation = vi.fn();

vi.mock("@/lib/conversations", () => ({
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
}));

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return { ...actual, generateRequestId: () => "test-req-id" };
});

import { POST } from "../route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:4000/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateConversation.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/conversations", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost:4000/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_BODY");
  });

  it("returns 400 when mode is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_MODE");
  });

  it("returns 400 when mode is empty string", async () => {
    const res = await POST(makeRequest({ mode: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_MODE");
  });

  it("returns 400 for invalid mode value", async () => {
    const res = await POST(makeRequest({ mode: "unknown_mode" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_MODE");
  });

  it("creates conversation and returns 201 with URLs", async () => {
    mockCreateConversation.mockResolvedValue({
      id: "conv-123",
      c_url: "/c/conv-123",
      k_url: "/k/conv-123",
    });
    const res = await POST(makeRequest({ mode: "analyze", context_kind: "dashboard", context_ref: "42" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("conv-123");
    expect(body.c_url).toBe("/c/conv-123");
    expect(body.k_url).toBe("/k/conv-123");
  });

  it("passes seed_prompt and first_user_prompt to createConversation", async () => {
    mockCreateConversation.mockResolvedValue({ id: "x", c_url: "/c/x", k_url: "/k/x" });
    await POST(makeRequest({
      mode: "chat",
      seed_prompt: "Hello",
      first_user_prompt: "World",
      context_url: "/dashboard/1",
    }));
    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ seed_prompt: "Hello", first_user_prompt: "World", context_url: "/dashboard/1" })
    );
  });

  it("returns 500 when createConversation throws", async () => {
    mockCreateConversation.mockRejectedValue(new Error("DB error"));
    const res = await POST(makeRequest({ mode: "generate" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("DB_ERROR");
  });
});
