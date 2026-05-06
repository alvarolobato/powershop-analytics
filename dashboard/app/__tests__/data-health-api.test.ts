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

  // -------------------------------------------------------------------------
  // Headline freshness filter — see HEADLINE_FRESHNESS_EXCLUDED in route.ts
  // -------------------------------------------------------------------------
  describe("headline freshness ignores lookup-only tables", () => {
    it("excludes catalogos/tiendas/proveedores/gc_comerciales from stalestTable", async () => {
      // Lookup tables 10h old (only refresh on full / container restart),
      // transactional tables fresh. The TopBar must report the FRESH set,
      // not the stale lookup tables — otherwise it lies about data freshness.
      const lookupOld = new Date(NOW.getTime() - 10 * 60 * 60 * 1000);
      const fresh = freshDate();
      mockQuery.mockResolvedValue({
        columns: ["table_name", "last_sync_at", "status"],
        // ASC by last_sync_at — lookup tables come first
        rows: [
          ["catalogos", lookupOld, "ok"],
          ["tiendas", lookupOld, "ok"],
          ["proveedores", lookupOld, "ok"],
          ["gc_comerciales", lookupOld, "ok"],
          ["ventas", fresh, "ok"],
          ["lineas_ventas", fresh, "ok"],
        ],
      });

      const response = await GET();
      const body = await response.json();

      // Full list still includes all 6 tables — the banner needs them.
      expect(body.tables).toHaveLength(6);
      // Headline ignores the 4 lookup tables → first transactional is "ventas".
      expect(body.stalestTable?.name).toBe("ventas");
    });

    it("overallStale is false when only lookup tables are stale", async () => {
      // Real-world scenario: catalogos hasn't refreshed since the nightly
      // full at 02:00 (>36h ago) but ventas just synced. The headline must
      // NOT scream "stale" — the data the dashboard shows is fresh.
      mockQuery.mockResolvedValue({
        columns: ["table_name", "last_sync_at", "status"],
        rows: [
          ["catalogos", staleDate(), "ok"],
          ["tiendas", staleDate(), "ok"],
          ["ventas", freshDate(), "ok"],
        ],
      });

      const response = await GET();
      const body = await response.json();

      expect(body.overallStale).toBe(false);
      // Per-table isStale still flags the lookup tables (banner UX).
      const catalogos = body.tables.find(
        (t: { name: string }) => t.name === "catalogos",
      );
      expect(catalogos.isStale).toBe(true);
    });

    it("overallStale is true when a transactional table is stale", async () => {
      // Inverse: catalogos fresh, ventas stale. Headline must fire.
      mockQuery.mockResolvedValue({
        columns: ["table_name", "last_sync_at", "status"],
        rows: [
          ["ventas", staleDate(), "ok"],
          ["catalogos", freshDate(), "ok"],
        ],
      });

      const response = await GET();
      const body = await response.json();

      expect(body.overallStale).toBe(true);
      expect(body.stalestTable?.name).toBe("ventas");
    });

    it("falls back to the full set when only lookup tables exist", async () => {
      // Defensive: should never happen in practice, but if every
      // watermark is a lookup table, surfacing one is better than null.
      mockQuery.mockResolvedValue({
        columns: ["table_name", "last_sync_at", "status"],
        rows: [
          ["catalogos", freshDate(), "ok"],
          ["tiendas", freshDate(), "ok"],
        ],
      });

      const response = await GET();
      const body = await response.json();

      expect(body.stalestTable).not.toBeNull();
      expect(["catalogos", "tiendas"]).toContain(body.stalestTable.name);
    });
  });
});
