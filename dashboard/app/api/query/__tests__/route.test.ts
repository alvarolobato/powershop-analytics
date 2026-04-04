import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg module before importing anything that uses it
const mockQuery = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  return {
    Pool: class MockPool {
      query = mockQuery;
      end = mockEnd;
    },
  };
});

import { POST } from "../route";
import { resetPool } from "@/lib/db";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:4000/api/query", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/query", () => {
  beforeEach(async () => {
    mockQuery.mockReset();
    mockEnd.mockClear();
    await resetPool();
  });

  // ─── Successful queries ───────────────────────────────────────────────

  it("returns columns and rows for a valid SELECT", async () => {
    mockQuery.mockResolvedValue({
      fields: [{ name: "id" }, { name: "total" }],
      rows: [
        [1, 100],
        [2, 200],
      ],
    });

    const res = await POST(makeRequest({ sql: "SELECT id, total FROM ps_ventas" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.columns).toEqual(["id", "total"]);
    expect(json.rows).toEqual([
      [1, 100],
      [2, 200],
    ]);
  });

  it("returns empty rows for a query with no results", async () => {
    mockQuery.mockResolvedValue({
      fields: [{ name: "id" }],
      rows: [],
    });

    const res = await POST(
      makeRequest({ sql: "SELECT id FROM ps_ventas WHERE 1=0" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.columns).toEqual(["id"]);
    expect(json.rows).toEqual([]);
  });

  // ─── Write rejection (403) ────────────────────────────────────────────

  it("rejects INSERT with 403", async () => {
    const res = await POST(
      makeRequest({ sql: "INSERT INTO ps_ventas (id) VALUES (1)" })
    );
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("read-only");
  });

  it("rejects UPDATE with 403", async () => {
    const res = await POST(
      makeRequest({ sql: "UPDATE ps_ventas SET total_si = 0" })
    );
    expect(res.status).toBe(403);
  });

  it("rejects DELETE with 403", async () => {
    const res = await POST(
      makeRequest({ sql: "DELETE FROM ps_ventas" })
    );
    expect(res.status).toBe(403);
  });

  it("rejects DROP with 403", async () => {
    const res = await POST(
      makeRequest({ sql: "DROP TABLE ps_ventas" })
    );
    expect(res.status).toBe(403);
  });

  it("rejects TRUNCATE with 403", async () => {
    const res = await POST(
      makeRequest({ sql: "TRUNCATE ps_ventas" })
    );
    expect(res.status).toBe(403);
  });

  // ─── Allows SELECT with write-keyword column names ────────────────────

  it("allows SELECT updated_at (column name, not statement)", async () => {
    mockQuery.mockResolvedValue({
      fields: [{ name: "updated_at" }],
      rows: [["2026-01-01"]],
    });

    const res = await POST(
      makeRequest({ sql: "SELECT updated_at FROM ps_ventas LIMIT 1" })
    );
    expect(res.status).toBe(200);
  });

  // ─── Bad SQL (400) ────────────────────────────────────────────────────

  it("rejects null JSON body with 400", async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("object");
  });

  it("rejects array JSON body with 400", async () => {
    const res = await POST(makeRequest([1, 2, 3]));
    expect(res.status).toBe(400);
  });

  it("rejects missing sql field with 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("sql");
  });

  it("rejects empty sql with 400", async () => {
    const res = await POST(makeRequest({ sql: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects non-string sql with 400", async () => {
    const res = await POST(makeRequest({ sql: 123 }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body with 400", async () => {
    const req = new NextRequest("http://localhost:4000/api/query", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid JSON");
  });

  // ─── Timeout (408) ────────────────────────────────────────────────────

  it("returns 408 on query timeout", async () => {
    mockQuery.mockRejectedValue({ code: "57014", message: "canceling statement due to statement timeout" });

    const res = await POST(
      makeRequest({ sql: "SELECT * FROM ps_stock_tienda" })
    );
    expect(res.status).toBe(408);

    const json = await res.json();
    expect(json.error).toContain("timed out");
  });

  // ─── Connection error (503) ───────────────────────────────────────────

  it("returns 503 on connection refused", async () => {
    mockQuery.mockRejectedValue({ code: "ECONNREFUSED", message: "Connection refused" });

    const res = await POST(
      makeRequest({ sql: "SELECT 1" })
    );
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.error).toContain("connection failed");
  });

  // ─── Client SQL errors (400) ───────────────────────────────────────────

  it("returns 400 on undefined table (PG 42P01)", async () => {
    mockQuery.mockRejectedValue({ code: "42P01", message: 'relation "nonexistent" does not exist' });

    const res = await POST(
      makeRequest({ sql: "SELECT * FROM nonexistent" })
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("nonexistent");
  });

  it("returns 400 on syntax error (PG 42601)", async () => {
    mockQuery.mockRejectedValue({ code: "42601", message: 'syntax error at or near "SELEC"' });

    const res = await POST(
      makeRequest({ sql: "SELECT SELEC FROM ps_ventas" })
    );
    expect(res.status).toBe(400);
  });

  // ─── Unexpected error (500) ───────────────────────────────────────────

  it("returns 500 on unexpected errors without leaking details", async () => {
    mockQuery.mockRejectedValue(new Error("something internal went wrong"));

    const res = await POST(
      makeRequest({ sql: "SELECT * FROM ps_ventas" })
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).not.toContain("internal");
    expect(json.error).toContain("unexpected");
  });
});
