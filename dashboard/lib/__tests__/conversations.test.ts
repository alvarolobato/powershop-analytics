import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSql, mockLlmComplete } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockLlmComplete: vi.fn(),
}));

vi.mock("@/lib/db-write", () => ({
  sql: mockSql,
}));

vi.mock("@/lib/llm-client", () => ({
  llmComplete: mockLlmComplete,
}));

// Mock crypto to produce deterministic ids in tests
vi.mock("crypto", () => ({
  default: {
    randomBytes: (n: number) => ({
      toString: () => "a".repeat(n * 2),
    }),
  },
  randomBytes: (n: number) => ({
    toString: () => "a".repeat(n * 2),
  }),
}));

import {
  createConversation,
  getConversation,
  updateConversationTitle,
  setConversationArchived,
  appendMessage,
  countMessages,
  maybeGenerateTitle,
} from "../conversations";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createConversation", () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it("inserts a row and returns id + viewer URLs", async () => {
    mockSql.mockResolvedValue([]);
    const result = await createConversation({ mode: "analyze" });

    expect(result.id).toHaveLength(12);
    expect(result.c_url).toBe(`/c/${result.id}`);
    expect(result.k_url).toBe(`/k/${result.id}`);

    expect(mockSql).toHaveBeenCalledOnce();
    const [sql, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO conversations");
    expect(params[0]).toBe(result.id);
    expect(params[1]).toBe("analyze");
  });

  it("stores first_user_prompt from seed_prompt when first_user_prompt is absent", async () => {
    mockSql.mockResolvedValue([]);
    await createConversation({ mode: "analyze", seed_prompt: "Analiza esto" });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe("Analiza esto");
  });

  it("prefers first_user_prompt over seed_prompt", async () => {
    mockSql.mockResolvedValue([]);
    await createConversation({
      mode: "analyze",
      seed_prompt: "seed",
      first_user_prompt: "explicit",
    });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe("explicit");
  });

  it("stores context fields when provided", async () => {
    mockSql.mockResolvedValue([]);
    await createConversation({
      mode: "analyze",
      context_kind: "dashboard",
      context_ref: "42",
      context_url: "/dashboards/42",
    });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe("/dashboards/42");
    expect(params[4]).toBe("dashboard");
    expect(params[5]).toBe("42");
  });
});

describe("getConversation", () => {
  beforeEach(() => mockSql.mockReset());

  it("returns the first row when found", async () => {
    const conv = { id: "abc123", mode: "analyze", title: null };
    mockSql.mockResolvedValue([conv]);
    const result = await getConversation("abc123");
    expect(result).toEqual(conv);
  });

  it("returns null when not found", async () => {
    mockSql.mockResolvedValue([]);
    const result = await getConversation("notexist");
    expect(result).toBeNull();
  });
});

describe("updateConversationTitle", () => {
  beforeEach(() => mockSql.mockReset());

  it("executes an UPDATE with the correct params", async () => {
    mockSql.mockResolvedValue([]);
    await updateConversationTitle("abc123", "Mi análisis");
    const [sql, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE conversations");
    expect(sql).toContain("title");
    expect(params).toEqual(["abc123", "Mi análisis"]);
  });
});

describe("setConversationArchived", () => {
  beforeEach(() => mockSql.mockReset());

  it("sets archived_at to a timestamp when archiving", async () => {
    mockSql.mockResolvedValue([]);
    await setConversationArchived("abc123", true);
    const [sql, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("archived_at");
    expect(typeof params[1]).toBe("string"); // ISO timestamp
  });

  it("sets archived_at to null when unarchiving", async () => {
    mockSql.mockResolvedValue([]);
    await setConversationArchived("abc123", false);
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBeNull();
  });
});

describe("appendMessage", () => {
  beforeEach(() => mockSql.mockReset());

  it("inserts with the correct role and serialized content", async () => {
    mockSql.mockResolvedValue([]);
    await appendMessage("conv1", "user", { text: "Hola" });
    const [sql, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO conversation_messages");
    expect(params[0]).toBe("conv1");
    expect(params[1]).toBe("user");
    expect(params[2]).toBe('{"text":"Hola"}');
  });
});

describe("countMessages", () => {
  beforeEach(() => mockSql.mockReset());

  it("returns the parsed count from the DB", async () => {
    mockSql.mockResolvedValue([{ n: "7" }]);
    const n = await countMessages("conv1");
    expect(n).toBe(7);
  });

  it("returns 0 when no rows returned", async () => {
    mockSql.mockResolvedValue([]);
    const n = await countMessages("conv1");
    expect(n).toBe(0);
  });
});

describe("maybeGenerateTitle", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockLlmComplete.mockReset();
  });

  const messages = [
    { role: "user" as const, content: "¿Cuánto vendimos ayer?" },
    { role: "assistant" as const, content: "Vendimos 12.345 € en total ayer." },
  ];

  it("calls llmComplete and updates title when conversation has no title", async () => {
    // getConversation returns a conv with title=null
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]);
    mockLlmComplete.mockResolvedValue({ text: "Ventas de ayer análisis" });
    // updateConversationTitle INSERT
    mockSql.mockResolvedValueOnce([]);

    await maybeGenerateTitle("conv1", messages);

    expect(mockLlmComplete).toHaveBeenCalledOnce();
    const req = mockLlmComplete.mock.calls[0][0];
    expect(req.flow).toBe("title");
    expect(req.maxOutputTokens).toBe(30);

    // Should have called UPDATE to persist the title
    expect(mockSql).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain("UPDATE conversations");
    expect(updateParams[1]).toBe("Ventas de ayer análisis");
  });

  it("skips title generation when title is already set", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: "Existing title" }]);
    await maybeGenerateTitle("conv1", messages);
    expect(mockLlmComplete).not.toHaveBeenCalled();
  });

  it("skips when conversation not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    await maybeGenerateTitle("conv1", messages);
    expect(mockLlmComplete).not.toHaveBeenCalled();
  });

  it("skips when messages lack both user and assistant", async () => {
    await maybeGenerateTitle("conv1", []);
    expect(mockSql).not.toHaveBeenCalled();
    expect(mockLlmComplete).not.toHaveBeenCalled();
  });

  it("strips surrounding quotes from generated title", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]);
    mockLlmComplete.mockResolvedValue({ text: '"Ventas ayer"' });
    mockSql.mockResolvedValueOnce([]);

    await maybeGenerateTitle("conv1", messages);

    const [, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect(updateParams[1]).toBe("Ventas ayer");
  });

  it("swallows errors silently — non-blocking", async () => {
    mockSql.mockResolvedValueOnce([{ id: "conv1", title: null }]);
    mockLlmComplete.mockRejectedValue(new Error("LLM is down"));
    // Should not throw
    await expect(maybeGenerateTitle("conv1", messages)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Structural contract: no DELETE FROM conversations
// ---------------------------------------------------------------------------

describe("no-delete contract", () => {
  it("conversations module does not contain DELETE FROM conversations", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      __dirname,
      "..",
      "conversations.ts",
    );
    const src = fs.readFileSync(filePath, "utf-8");
    expect(src).not.toMatch(/DELETE\s+FROM\s+conversations/i);
  });
});
