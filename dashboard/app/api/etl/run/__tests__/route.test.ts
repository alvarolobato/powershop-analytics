// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db-write", () => ({
  sql: vi.fn(),
}));

import { POST } from "../route";
import { query } from "@/lib/db";
import { sql } from "@/lib/db-write";

const mockQuery = vi.mocked(query);
const mockSql = vi.mocked(sql);

describe("POST /api/etl/run", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSql.mockReset();
  });

  it("returns 202 with trigger_id when no run is active", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], columns: [] });
    mockSql.mockResolvedValueOnce([{ id: 42 }]);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ trigger_id: 42 });
    expect(mockSql).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO etl_manual_trigger"),
    );
  });

  it("returns 409 with run_id when a non-stale run is active", async () => {
    const recentStart = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    mockQuery.mockResolvedValueOnce({
      rows: [[7, recentStart]],
      columns: ["id", "started_at"],
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "already_running", run_id: 7 });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("does not block on a stale run (started > 4 hours ago)", async () => {
    const staleStart = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    mockQuery.mockResolvedValueOnce({
      rows: [[3, staleStart]],
      columns: ["id", "started_at"],
    });
    mockSql.mockResolvedValueOnce([{ id: 99 }]);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ trigger_id: 99 });
  });

  it("coerces string trigger_id to number (BIGSERIAL returns string)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], columns: [] });
    mockSql.mockResolvedValueOnce([{ id: "42" }]);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ trigger_id: 42 });
    expect(typeof body.trigger_id).toBe("number");
  });

  it("returns 503 when the database query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "db_error" });
  });

  it("returns 503 when the INSERT throws", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], columns: [] });
    mockSql.mockRejectedValueOnce(new Error("DB write error"));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "db_error" });
  });
});
