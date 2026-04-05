// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../api/data-health/route";

// ---------------------------------------------------------------------------
// Mock @/lib/db
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  ConnectionError: class ConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConnectionError";
    }
  },
}));

import { query, ConnectionError } from "@/lib/db";

const mockQuery = vi.mocked(query);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-05T12:00:00Z");

/** A timestamp that is fresh (10 hours ago) */
function freshDate(): Date {
  return new Date(NOW.getTime() - 10 * 60 * 60 * 1000);
}

/** A timestamp that is stale (48 hours ago) */
function staleDate(): Date {
  return new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/data-health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty response when etl_watermarks is empty", async () => {
    mockQuery.mockResolvedValue({ columns: ["table_name", "last_sync_at", "status"], rows: [] });

    const response = await GET();
    const body = await response.json();

    expect(body.tables).toEqual([]);
    expect(body.overallStale).toBe(false);
    expect(body.stalestTable).toBeNull();
  });

  it("marks table as fresh when last_sync_at is recent", async () => {
    const fresh = freshDate();
    mockQuery.mockResolvedValue({
      columns: ["table_name", "last_sync_at", "status"],
      rows: [["ps_ventas", fresh, "ok"]],
    });

    const response = await GET();
    const body = await response.json();

    expect(body.tables).toHaveLength(1);
    expect(body.tables[0].name).toBe("ps_ventas");
    expect(body.tables[0].isStale).toBe(false);
    expect(body.overallStale).toBe(false);
    expect(body.stalestTable).not.toBeNull();
  });

  it("marks table as stale when last_sync_at is >36 hours ago", async () => {
    const stale = staleDate();
    mockQuery.mockResolvedValue({
      columns: ["table_name", "last_sync_at", "status"],
      rows: [["ps_ventas", stale, "ok"]],
    });

    const response = await GET();
    const body = await response.json();

    expect(body.tables[0].isStale).toBe(true);
    expect(body.overallStale).toBe(true);
    expect(body.stalestTable?.name).toBe("ps_ventas");
  });

  it("stalestTable points to the oldest entry (sorted ASC)", async () => {
    const stale = staleDate();
    const fresh = freshDate();
    mockQuery.mockResolvedValue({
      columns: ["table_name", "last_sync_at", "status"],
      // Already sorted ASC (oldest first) as the query does
      rows: [
        ["ps_ventas", stale, "ok"],
        ["ps_articulos", fresh, "ok"],
      ],
    });

    const response = await GET();
    const body = await response.json();

    expect(body.stalestTable?.name).toBe("ps_ventas");
    expect(body.overallStale).toBe(true);
  });

  it("returns empty response when etl_watermarks table does not exist (42P01)", async () => {
    const pgErr = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    mockQuery.mockRejectedValue(pgErr);

    const response = await GET();
    const body = await response.json();

    expect(body.tables).toEqual([]);
    expect(body.overallStale).toBe(false);
    expect(response.status).toBe(200);
  });

  it("returns empty response on ConnectionError (graceful degradation)", async () => {
    mockQuery.mockRejectedValue(new ConnectionError("ECONNREFUSED"));

    const response = await GET();
    const body = await response.json();

    expect(body.tables).toEqual([]);
    expect(body.overallStale).toBe(false);
    expect(response.status).toBe(200);
  });

  it("returns empty response on unexpected error (graceful degradation)", async () => {
    mockQuery.mockRejectedValue(new Error("Unexpected DB error"));

    const response = await GET();
    const body = await response.json();

    expect(body.tables).toEqual([]);
    expect(body.overallStale).toBe(false);
    expect(response.status).toBe(200);
  });

  it("returns HTTP 200 in all cases (never crashes)", async () => {
    mockQuery.mockRejectedValue(new Error("fatal"));

    const response = await GET();
    expect(response.status).toBe(200);
  });
});
