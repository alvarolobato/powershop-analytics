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
  generateConversationId,
  createConversation,
  getConversation,
  getConversationWithMessages,
  listConversations,
  updateConversationTitle,
  setConversationArchived,
  archiveConversation,
  unarchiveConversation,
  updateTitle,
  updateLastStatus,
  syncLegacyCache,
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

  it("sets archived_at to a non-null value when archiving", async () => {
    mockSql.mockResolvedValue([]);
    await setConversationArchived("abc123", true);
    const [sql, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("archived_at");
    expect(params[1]).not.toBeNull(); // application timestamp
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

    // Should have called conditional UPDATE (WHERE title IS NULL) to persist the title
    expect(mockSql).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain("UPDATE conversations");
    expect(updateSql).toContain("title IS NULL");
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

    const [updateSql, updateParams] = mockSql.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain("title IS NULL");
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
// generateConversationId
// ---------------------------------------------------------------------------

describe("generateConversationId", () => {
  it("returns 12 hex characters", () => {
    const id = generateConversationId();
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// getConversationWithMessages
// ---------------------------------------------------------------------------

describe("getConversationWithMessages", () => {
  beforeEach(() => mockSql.mockReset());

  it("returns conversation with messages array", async () => {
    const conv = { id: "abc123", mode: "modify", title: null };
    const msg = { id: "msg-1", conversation_id: "abc123", role: "user", content: { text: "Hola" }, created_at: "2026-01-01" };
    mockSql
      .mockResolvedValueOnce([conv])  // getConversation
      .mockResolvedValueOnce([msg]);  // messages query

    const result = await getConversationWithMessages("abc123");
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0].role).toBe("user");
  });

  it("returns null when conversation not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await getConversationWithMessages("notexist");
    expect(result).toBeNull();
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe("listConversations", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.mockResolvedValue([]);
  });

  it("defaults to hiding archived (WHERE archived_at IS NULL)", async () => {
    await listConversations();
    const [query] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("archived_at IS NULL");
  });

  it("includes archived rows when include_archived=true", async () => {
    await listConversations({ include_archived: true });
    const [query] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain("archived_at IS NULL");
  });

  it("filters by context_kind and context_ref", async () => {
    await listConversations({ context_kind: "dashboard", context_ref: "42" });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("context_kind");
    expect(query).toContain("context_ref");
    expect(params).toContain("dashboard");
    expect(params).toContain("42");
  });

  it("filters by mode", async () => {
    await listConversations({ mode: "modify" });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("c.mode = ");
    expect(params).toContain("modify");
  });

  it("filters by q (search) with ILIKE and escaped wildcards", async () => {
    await listConversations({ q: "100%" });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("ILIKE");
    expect(params.some((p) => typeof p === "string" && p.includes("100\\%"))).toBe(true);
  });

  it("ignores empty q", async () => {
    await listConversations({ q: "   " });
    const [query] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain("ILIKE");
  });

  it("passes limit as a SQL parameter", async () => {
    await listConversations({ limit: 5 });
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("LIMIT $");
    expect(params).toContain(5);
  });
});

// ---------------------------------------------------------------------------
// archiveConversation / unarchiveConversation
// ---------------------------------------------------------------------------

describe("archiveConversation", () => {
  beforeEach(() => mockSql.mockReset());

  it("delegates to setConversationArchived(true) — sets archived_at to non-null", async () => {
    mockSql.mockResolvedValue([]);
    await archiveConversation("abc123");
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("abc123");
    expect(params[1]).not.toBeNull();
  });
});

describe("unarchiveConversation", () => {
  beforeEach(() => mockSql.mockReset());

  it("delegates to setConversationArchived(false) — clears archived_at", async () => {
    mockSql.mockResolvedValue([]);
    await unarchiveConversation("abc123");
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("abc123");
    expect(params[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTitle / updateLastStatus
// ---------------------------------------------------------------------------

describe("updateTitle", () => {
  beforeEach(() => mockSql.mockReset());

  it("updates the title column", async () => {
    mockSql.mockResolvedValue([]);
    await updateTitle("abc123", "Nuevo título");
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("title");
    expect(params[0]).toBe("abc123");
    expect(params[1]).toBe("Nuevo título");
  });
});

describe("updateLastStatus", () => {
  beforeEach(() => mockSql.mockReset());

  it("updates last_interaction_at and last_status", async () => {
    mockSql.mockResolvedValue([]);
    await updateLastStatus("abc123", "ok");
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("last_interaction_at");
    expect(params[0]).toBe("abc123");
    expect(params[1]).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// syncLegacyCache
// ---------------------------------------------------------------------------

describe("syncLegacyCache", () => {
  beforeEach(() => mockSql.mockReset());

  it("does nothing when conversation not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    await syncLegacyCache("abc123def456");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("does nothing when context_kind is not 'dashboard'", async () => {
    mockSql.mockResolvedValueOnce([{ id: "abc123def456", mode: "modify", context_kind: "home", context_ref: "1", archived_at: null }]);
    await syncLegacyCache("abc123def456");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("does nothing when mode is not modify or analyze", async () => {
    mockSql.mockResolvedValueOnce([{ id: "abc123def456", mode: "generate", context_kind: "dashboard", context_ref: "1", archived_at: null }]);
    await syncLegacyCache("abc123def456");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("does nothing when conversation is archived", async () => {
    mockSql.mockResolvedValueOnce([{ id: "abc123def456", mode: "modify", context_kind: "dashboard", context_ref: "1", archived_at: "2026-01-01" }]);
    await syncLegacyCache("abc123def456");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it("updates chat_messages_modify when mode=modify", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "abc123def456", mode: "modify", context_kind: "dashboard", context_ref: "42", archived_at: null }])
      .mockResolvedValueOnce([{ role: "user", content: { text: "Hola" }, created_at: "2026-01-01" }])
      .mockResolvedValueOnce([]);

    await syncLegacyCache("abc123def456");

    expect(mockSql).toHaveBeenCalledTimes(3);
    const [updateQuery, updateParams] = mockSql.mock.calls[2] as [string, unknown[]];
    expect(updateQuery).toContain("chat_messages_modify");
    expect(updateParams[0]).toBe(42);
    const legacy = JSON.parse(updateParams[1] as string);
    expect(legacy[0].content).toBe("Hola");
  });

  it("updates chat_messages_analyze when mode=analyze", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "abc123def456", mode: "analyze", context_kind: "dashboard", context_ref: "7", archived_at: null }])
      .mockResolvedValueOnce([{ role: "user", content: { text: "Info" }, created_at: "2026-01-01" }])
      .mockResolvedValueOnce([]);

    await syncLegacyCache("abc123def456");

    const [updateQuery] = mockSql.mock.calls[2] as [string, unknown[]];
    expect(updateQuery).toContain("chat_messages_analyze");
  });

  it("does nothing when context_ref is not a valid number", async () => {
    mockSql
      .mockResolvedValueOnce([{ id: "abc123def456", mode: "modify", context_kind: "dashboard", context_ref: "not-a-number", archived_at: null }])
      .mockResolvedValueOnce([]);

    await syncLegacyCache("abc123def456");
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Structural contract: no delete from conversations
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

  it("does not export deleteConversation", async () => {
    const mod = await import("../conversations");
    expect("deleteConversation" in mod).toBe(false);
  });
});
