/**
 * Unit tests for the turn-events data layer.
 * Mocks @/lib/db-write so no live DB is needed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSql = vi.fn();
// withTransaction runs the callback with a fake client whose .query is mockQuery.
const mockQuery = vi.fn();
const fakeClient = { query: (...a: unknown[]) => mockQuery(...a) };

vi.mock("@/lib/db-write", () => ({
  sql: (...a: unknown[]) => mockSql(...a),
  withTransaction: (fn: (c: unknown) => unknown) => fn(fakeClient),
}));

import {
  createTurnIfIdle,
  createBackgroundTurn,
  updateTurnStatus,
  insertTurnEvent,
  getTurnWithEvents,
  getConversationEvents,
} from "@/lib/turn-events";

const CONV_ID = "abcdef012345";
const TURN_ID = "550e8400-e29b-41d4-a716-446655440000";

const TURN_ROW = {
  id: TURN_ID,
  conversation_id: CONV_ID,
  turn_index: 0,
  user_message: "Hello world",
  status: "complete" as const,
  source: "user" as const,
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

describe("createTurnIfIdle", () => {
  beforeEach(() => mockQuery.mockReset());

  it("takes the advisory lock, finds no active turn, and inserts (#823)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // active-turn check
      .mockResolvedValueOnce({ rows: [{ id: TURN_ID, turn_index: 3 }] }); // insert

    const result = await createTurnIfIdle(CONV_ID, "test message");

    expect(result).toEqual({ ok: true, turnId: TURN_ID, turnIndex: 3 });
    // The lock is acquired before the check, all in one transaction.
    expect(mockQuery.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
  });

  it("rejects without inserting when an active turn already exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }); // active turn found

    const result = await createTurnIfIdle(CONV_ID, "second");

    expect(result).toEqual({ ok: false, reason: "active_turn" });
    // Only the lock + the check ran — no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("scopes the staleness cutoff so a crashed turn doesn't block forever", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TURN_ID, turn_index: 0 }] });

    await createTurnIfIdle(CONV_ID, "x");

    const checkQuery = mockQuery.mock.calls[1][0] as string;
    expect(checkQuery).toContain("status IN ('pending', 'streaming')");
    expect(checkQuery).toContain("created_at >");
  });

  // Review finding on PR #899: without this filter, a createBackgroundTurn
  // tracking row (status='streaming' for the whole 30s-2min generation) reads
  // as a genuine in-flight user turn here, and every message the user sends
  // in that window gets rejected with TURN_IN_PROGRESS. See the functional
  // regression test below (`createBackgroundTurn must not block...`) for the
  // end-to-end behavior this query text change is meant to produce.
  it("excludes background tracking turns from the active-turn check", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TURN_ID, turn_index: 0 }] });

    await createTurnIfIdle(CONV_ID, "x");

    const checkQuery = mockQuery.mock.calls[1][0] as string;
    expect(checkQuery).toContain("source = 'user'");
  });

  it("throws when the INSERT returns no row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(createTurnIfIdle(CONV_ID, "x")).rejects.toThrow(
      "createTurnIfIdle: no row returned",
    );
  });
});

// D-049: background jobs (start_dashboard_generation) track progress through
// a system-initiated turn, inserted directly rather than via createTurnIfIdle.
describe("createBackgroundTurn", () => {
  beforeEach(() => mockQuery.mockReset());

  it("takes the advisory lock (same as createTurnIfIdle) and inserts unconditionally", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [{ id: TURN_ID }] }); // insert

    const turnId = await createBackgroundTurn(CONV_ID, "[start_dashboard_generation] Ventas de hoy");

    expect(turnId).toBe(TURN_ID);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
  });

  it("does NOT check for an active turn — it must succeed while one is already streaming", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // lock
      .mockResolvedValueOnce({ rows: [{ id: TURN_ID }] }); // insert

    await createBackgroundTurn(CONV_ID, "x");

    // Exactly lock + insert — no intervening "active turn" SELECT that could reject it.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const insertQuery = mockQuery.mock.calls[1][0] as string;
    expect(insertQuery).toContain("INSERT INTO conversation_turns");
    expect(insertQuery).toContain("'streaming'");
    expect(insertQuery).toContain("'background'");
  });

  it("throws when the INSERT returns no row", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(createBackgroundTurn(CONV_ID, "x")).rejects.toThrow(
      "createBackgroundTurn: no row returned",
    );
  });
});

// Review finding on PR #899 (HIGH): createBackgroundTurn's tracking row sat in
// 'streaming' for the whole 30s-2min duration of a detached
// start_dashboard_generation run, indistinguishable from a genuine in-flight
// user turn to createTurnIfIdle's active-turn guard. Any message the user sent
// while their own dashboard was generating hit POST /api/conversations/:id/turns
// -> createTurnIfIdle -> saw the tracking row as active -> 409 TURN_IN_PROGRESS
// ("Hay una respuesta en curso... Espera a que termine") for up to two
// minutes — the chat going dead for exactly the scenario D-049 set out to fix.
//
// Unlike the tests above (which assert on the literal SQL text each function
// sends), this test drives BOTH functions against one small fake in-memory
// `conversation_turns` table whose active-turn / insert behavior is derived
// from parsing the real query text, so it actually exercises the interaction
// between createBackgroundTurn's INSERT and createTurnIfIdle's SELECT rather
// than hardcoding a response sequence. Confirmed to fail (result.ok === false)
// against the pre-fix code, where createBackgroundTurn's INSERT never sets
// `source` and createTurnIfIdle's active check has no `source` filter, so the
// still-streaming tracking row reads as an active turn and gets the user's
// real message rejected.
describe("createBackgroundTurn must not block a real user turn (PR #899 review)", () => {
  beforeEach(() => mockQuery.mockReset());

  it("lets the user open a real turn while a background generation turn is still streaming", async () => {
    // Five calls in strict order: createBackgroundTurn's [lock, insert], then
    // createTurnIfIdle's [lock, active-check, insert]. Rather than hardcoding
    // the active-check's answer, it is derived from the ACTUAL query text of
    // the two calls that matter — whether the background INSERT tagged its
    // row 'background' and whether the active-check SELECT filters on
    // `source = 'user'` — so this test is sensitive to the real fix, not to
    // a fixed response sequence. `mockImplementationOnce` (not a persistent
    // `mockImplementation`) is used deliberately: after these five are
    // consumed, any further call falls back to the default `undefined`
    // return instead of running our matching logic again.
    let bgInsertQuery = "";
    mockQuery
      .mockImplementationOnce(async () => ({ rows: [] })) // lock (createBackgroundTurn)
      .mockImplementationOnce(async (q: unknown) => {
        bgInsertQuery = q as string;
        return { rows: [{ id: "turn-bg" }] };
      }) // insert (createBackgroundTurn)
      .mockImplementationOnce(async () => ({ rows: [] })) // lock (createTurnIfIdle)
      .mockImplementationOnce(async (q: unknown) => {
        // Pre-fix: the background INSERT never set `source`, so the row is
        // indistinguishable from a real user turn. Post-fix: it's tagged
        // 'background', and the active-check SELECT below filters it out.
        const backgroundRowLooksLikeUser = !bgInsertQuery.includes("'background'");
        const activeCheckFiltersToUser = (q as string).includes("source = 'user'");
        const hasActive = !activeCheckFiltersToUser || backgroundRowLooksLikeUser;
        return hasActive
          ? { rowCount: 1, rows: [{ "?column?": 1 }] }
          : { rowCount: 0, rows: [] };
      }) // active-check SELECT (createTurnIfIdle)
      .mockImplementationOnce(async () => ({ rows: [{ id: "turn-user", turn_index: 1 }] })); // insert (createTurnIfIdle) — only reached when not rejected

    // A start_dashboard_generation background turn is already streaming...
    await createBackgroundTurn(CONV_ID, "[start_dashboard_generation] Ventas de hoy");

    // ...the user must still be able to open a real turn of their own.
    const result = await createTurnIfIdle(CONV_ID, "¿Y las devoluciones de esta semana?");

    expect(result.ok).toBe(true);
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
