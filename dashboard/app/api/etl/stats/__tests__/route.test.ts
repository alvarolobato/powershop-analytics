// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { GET } from "../route";
import { query } from "@/lib/db";

const mockQuery = vi.mocked(query);

// Mock returns data in DESC order (newest first), matching ORDER BY started_at DESC.
// The route reverses rows to oldest-first for charting.
// Columns: started_at, duration_ms, status, total_rows_synced (merged single query).
const MOCK_TREND_ROWS_DESC = [
  [new Date("2026-04-11T02:00:00Z"), null, "failed", null],       // newest
  [new Date("2026-04-10T02:00:00Z"), 3600000, "success", 46000],
  [new Date("2026-04-09T02:00:00Z"), 3500000, "success", 45000],   // oldest
];

const MOCK_TABLE_DUR_ROWS = [
  ["stock", 2700000, 2800000],
  ["ventas", 900000, 950000],
];

const MOCK_RATE_ROWS = [[30, 28, 1, 1]];

function setupMocks() {
  mockQuery
    .mockResolvedValueOnce({ rows: MOCK_TREND_ROWS_DESC, columns: [] })
    .mockResolvedValueOnce({ rows: MOCK_TABLE_DUR_ROWS, columns: [] })
    .mockResolvedValueOnce({ rows: MOCK_RATE_ROWS, columns: [] });
}

describe("GET /api/etl/stats", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns all stats fields", async () => {
    setupMocks();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("duration_trend");
    expect(body).toHaveProperty("rows_trend");
    expect(body).toHaveProperty("table_durations");
    expect(body).toHaveProperty("success_rate");
  });

  it("duration_trend reversed to oldest-first for charting", async () => {
    setupMocks();

    const res = await GET();
    const body = await res.json();

    expect(body.duration_trend).toHaveLength(3);
    // Oldest first after reverse
    expect(body.duration_trend[0].started_at).toBe("2026-04-09T02:00:00.000Z");
    expect(body.duration_trend[2].started_at).toBe("2026-04-11T02:00:00.000Z");
    expect(body.duration_trend[2].duration_ms).toBeNull();
    expect(body.duration_trend[2].status).toBe("failed");
  });

  it("rows_trend reversed to oldest-first for charting", async () => {
    setupMocks();

    const res = await GET();
    const body = await res.json();

    expect(body.rows_trend).toHaveLength(3);
    // Oldest first after reverse
    expect(body.rows_trend[0].started_at).toBe("2026-04-09T02:00:00.000Z");
    expect(body.rows_trend[2].started_at).toBe("2026-04-11T02:00:00.000Z");
    expect(body.rows_trend[2].total_rows_synced).toBeNull();
  });

  it("success_rate has correct totals", async () => {
    setupMocks();

    const res = await GET();
    const body = await res.json();

    expect(body.success_rate.total).toBe(30);
    expect(body.success_rate.success).toBe(28);
    expect(body.success_rate.partial).toBe(1);
    expect(body.success_rate.failed).toBe(1);
  });

  it("table_durations sorted by avg_duration_ms DESC", async () => {
    setupMocks();

    const res = await GET();
    const body = await res.json();

    expect(body.table_durations[0].table_name).toBe("stock");
    expect(body.table_durations[0].avg_duration_ms).toBe(2700000);
    expect(body.table_durations[1].table_name).toBe("ventas");
  });

  it("handles empty runs table gracefully", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], columns: [] })
      .mockResolvedValueOnce({ rows: [], columns: [] })
      .mockResolvedValueOnce({ rows: [[0, 0, 0, 0]], columns: [] });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duration_trend).toHaveLength(0);
    expect(body.success_rate.total).toBe(0);
  });

  it("returns 500 on database error", async () => {
    mockQuery.mockRejectedValue(new Error("db error"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe("DB_QUERY");
    expect(body.requestId).toBeDefined();
  });
});
