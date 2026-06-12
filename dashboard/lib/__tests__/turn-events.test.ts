/**
 * Unit tests for the turn-events data layer.
 * Mocks @/lib/db-write so no live DB is needed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSql = vi.fn();

vi.mock("@/lib/db-write", () => ({
  sql: (...a: unknown[]) => mockSql(...a),
}));

import {
  createTurn,
  updateTurnStatus,
  insertTurnEvent,
  getTurnWithEvents,
  getConversationEvents,
  getNextTurnIndex,
} from "@/lib/turn-events";

const CONV_ID = "abcdef012345";
const TURN_ID = "550e8400-e29b-41d4-a716-446655440000";

const TURN_ROW = {
  id: TURN_ID,
  conversation_id: CONV_ID,
  turn_index: 0,
  user_message: "Hello world",
  status: "complete" as const,
  started_at: "2026-01-01T00:00:01Z",
  completed_at: "2026-01-01T00:00:05Z",
  error: null,
  created_at: "2026-01-01T00:00:00Z",
};

const TURN_EVENTS = [
  {
    id: 1,
    turn_id: TURN_ID,
    seq: 0,
    event_type: "context",
    payload: { model: "claude-sonnet-4-6" },
    created_at: "2026-01-01T00:00:01Z",
  },
  {
    id: 2,
    turn_id: TURN_ID,
    seq: 1,
    event_type: "complete",
    payload: { messageId: "msg-001" },
    created_at: "2026-01-01T00:00:05Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTurn", () => {
  it("returns turnId and turnIndex from INSERT RETURNING", async () => {
    mockSql.mockResolvedValueOnce([{ id: TURN_ID, turn_index: 3 }]);
    const result = await createTurn(CONV_ID, "test message");
    expect(result.turnId).toBe(TURN_ID);
    expect(result.turnIndex).toBe(3);
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it("throws when INSERT returns no rows", async () => {
    mockSql.mockResolvedValueOnce([]);
    await expect(createTurn(CONV_ID, "test")).rejects.toThrow("createTurn: no row returned");
  });
});

describe("updateTurnStatus", () => {
  it("sets started_at when status=streaming", async () => {
    mockSql.mockResolvedValueOnce([]);
    await updateTurnStatus(TURN_ID, "streaming");
    const [query] = mockSql.mock.calls[0] as [string];
    expect(query).toContain("started_at");
    expect(query).not.toContain("completed_at");
  });

  it("sets completed_at when status=complete", async () => {
    mockSql.mockResolvedValueOnce([]);
    await updateTurnStatus(TURN_ID, "complete");
    const [query] = mockSql.mock.calls[0] as [string];
    expect(query).toContain("completed_at");
    expect(query).not.toContain("started_at");
  });

  it("sets error column when status=error", async () => {
    mockSql.mockResolvedValueOnce([]);
    await updateTurnStatus(TURN_ID, "error", "something failed");
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("error");
    expect(params).toContain("something failed");
  });

  it("sets only status when status=pending", async () => {
    mockSql.mockResolvedValueOnce([]);
    await updateTurnStatus(TURN_ID, "pending");
    const [query] = mockSql.mock.calls[0] as [string];
    expect(query).not.toContain("started_at");
    expect(query).not.toContain("completed_at");
  });
});

describe("insertTurnEvent", () => {
  it("writes correct params to DB", async () => {
    mockSql.mockResolvedValueOnce([{ id: 42 }]);
    await insertTurnEvent(TURN_ID, 5, "log", { kind: "meta", text: "Procesando…" });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(TURN_ID);
    expect(params[1]).toBe(5);
    expect(params[2]).toBe("log");
    const payload = JSON.parse(params[3] as string);
    expect(payload.kind).toBe("meta");
  });
});

describe("getTurnWithEvents", () => {
  it("returns null when turn not found", async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await getTurnWithEvents(TURN_ID);
    expect(result).toBeNull();
  });

  it("returns turn with events when found", async () => {
    mockSql.mockResolvedValueOnce([TURN_ROW]).mockResolvedValueOnce(TURN_EVENTS);
    const result = await getTurnWithEvents(TURN_ID);
    expect(result?.turn.id).toBe(TURN_ID);
    expect(result?.events).toHaveLength(2);
  });
});

describe("getConversationEvents", () => {
  it("returns all events when sinceId is not provided", async () => {
    mockSql.mockResolvedValueOnce(TURN_EVENTS);
    const events = await getConversationEvents(CONV_ID);
    expect(events).toHaveLength(2);
    const [query] = mockSql.mock.calls[0] as [string];
    expect(query).not.toContain("te.id >");
  });

  it("filters events by id when sinceId is provided", async () => {
    mockSql.mockResolvedValueOnce([TURN_EVENTS[1]]);
    const events = await getConversationEvents(CONV_ID, 1);
    expect(events).toHaveLength(1);
    const [query, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("te.id >");
    expect(params[1]).toBe(1);
  });
});

describe("getNextTurnIndex", () => {
  it("returns 0 when no turns exist", async () => {
    mockSql.mockResolvedValueOnce([{ next_index: 0 }]);
    const idx = await getNextTurnIndex(CONV_ID);
    expect(idx).toBe(0);
  });

  it("returns correct next index", async () => {
    mockSql.mockResolvedValueOnce([{ next_index: 5 }]);
    const idx = await getNextTurnIndex(CONV_ID);
    expect(idx).toBe(5);
  });
});

describe("createTurn — turn_index race (#823)", () => {
  it("retries on unique violation and succeeds on the next attempt", async () => {
    const uniqueErr = Object.assign(new Error("duplicate key"), { code: "23505" });
    mockSql
      .mockRejectedValueOnce(uniqueErr)
      .mockResolvedValueOnce([{ id: TURN_ID, turn_index: 3 }]);

    const result = await createTurn(CONV_ID, "hola");

    expect(result).toEqual({ turnId: TURN_ID, turnIndex: 3 });
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries on persistent unique violations", async () => {
    mockSql.mockImplementation(async () => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });

    let caught: Error | null = null;
    try {
      await createTurn(CONV_ID, "hola");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toBe("duplicate key");
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-unique-violation errors", async () => {
    mockSql.mockImplementation(async () => {
      throw new Error("connection refused");
    });

    let caught: Error | null = null;
    try {
      await createTurn(CONV_ID, "hola");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toBe("connection refused");
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

describe("hasActiveTurn (#823)", () => {
  it("returns true when a pending/streaming turn exists", async () => {
    mockSql.mockResolvedValue([{ one: 1 }]);
    const { hasActiveTurn } = await import("@/lib/turn-events");
    await expect(hasActiveTurn(CONV_ID)).resolves.toBe(true);
    const [query] = mockSql.mock.calls[0] as [string];
    expect(query).toContain("'pending', 'streaming'");
    // Stale-turn cutoff: a crashed turn must not block the conversation forever.
    expect(query).toContain("created_at >");
  });

  it("returns false when no in-flight turn exists", async () => {
    mockSql.mockResolvedValue([]);
    const { hasActiveTurn } = await import("@/lib/turn-events");
    await expect(hasActiveTurn(CONV_ID)).resolves.toBe(false);
  });
});
