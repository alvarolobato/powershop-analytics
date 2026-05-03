// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// The /api/home route fans out into ~22 parallel `query()` calls. CI
// has no postgres, so we stub `@/lib/db.query` with a generic mock that
// returns an "all-null row" shape compatible with the route's
// destructuring + safe-coerce helpers (every `num(row[i])` becomes 0,
// every text becomes ""). The result is a 200 with a valid envelope and
// stub data — enough to assert on shape and contract, which is what this
// integration-style test should be doing.
vi.mock("@/lib/db", () => {
  const NULL_ROW = Array(20).fill(null);
  return {
    query: vi.fn(async (sql: string) => {
      // The pivot query reads max/min of fecha_creacion + Madrid today.
      // Return a believable date so the rest of the route picks a real
      // as-of and computes per-flow date arithmetic without bombing.
      if (sql.includes("max_synced") && sql.includes("today_madrid")) {
        return {
          rows: [
            [
              "2026-04-30",
              "2024-01-01",
              "2026-05-03",
              "2026-05-03T07:00:00Z",
            ],
          ],
        };
      }
      // Hourly cumulative queries return 24 rows (h=0..23, cumul=0,
      // has_data=false) so the route's "no intraday data" branch fires.
      if (sql.includes("generate_series(0, 23)")) {
        return {
          rows: Array.from({ length: 24 }, (_, h) => [h, 0, false]),
        };
      }
      // Daily-trend query returns an array of day rows. The shape
      // {day:int, actual:numeric|null, ly:numeric} per row.
      if (sql.includes("dailyTrend") || sql.includes("AS day,")) {
        return {
          rows: Array.from({ length: 30 }, (_, i) => [i + 1, null, 0]),
        };
      }
      // Top-stores query: 10 rows of (codigo, identificador, poblacion,
      // sales). Empty list is also valid; the route handles len < 10.
      if (sql.includes("FROM ps_ventas") && sql.includes("GROUP BY tienda")) {
        return { rows: [] };
      }
      // etl_sync_runs is checked with rows.length > 0 — empty bypasses
      // the `new Date(null)` path that would otherwise throw "Invalid
      // time value".
      if (sql.includes("etl_sync_runs")) {
        return { rows: [] };
      }
      // The watermark query unconditionally reads rows[0][0]; return a
      // single null-row so the destructure succeeds with NaN syncAge.
      if (sql.includes("etl_watermarks")) {
        return { rows: [[null]] };
      }
      // Generic single-row response of nulls; safe for SUM(...) AS curr,
      // SUM(...) AS prev, SUM(...) AS lyear style queries.
      return { rows: [NULL_ROW] };
    }),
  };
});

import { NextRequest } from "next/server";

import { GET } from "../route";

function makeReq(date?: string) {
  const url = `http://localhost/api/home${date ? `?date=${date}` : ""}`;
  return new NextRequest(url);
}

describe("GET /api/home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  it("returns a JSON body with the documented top-level keys", async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body).toHaveProperty("asOf");
    expect(body).toHaveProperty("asOfDate");
    expect(body).toHaveProperty("maxAvailableDate");
    expect(body).toHaveProperty("hero");
    expect(body).toHaveProperty("periods");
    expect(body).toHaveProperty("dailyTrend");
    expect(body).toHaveProperty("topStores");
    expect(body).toHaveProperty("opsRetail");
    expect(body).toHaveProperty("health");
    // Removed in PR #458 (the home page is retail-only and dropped alerts).
    expect(body).not.toHaveProperty("alerts");
    expect(body).not.toHaveProperty("opsWholesale");
  });

  it("returns hero with required fields including comparisonLabel", async () => {
    const res = await GET(makeReq());
    const { hero } = await res.json();
    expect(typeof hero.todayValue).toBe("number");
    expect(typeof hero.forecastEOD).toBe("number");
    expect(typeof hero.todayPace).toBe("number");
    expect(typeof hero.vsYesterday).toBe("number");
    expect(typeof hero.vsLY).toBe("number");
    expect(typeof hero.yesterday).toBe("number");
    expect(typeof hero.lastYear).toBe("number");
    expect(["on-pace", "below", "above"]).toContain(hero.status);
    expect(Array.isArray(hero.hourly)).toBe(true);
    expect(Array.isArray(hero.hourlyComparison)).toBe(true);
    expect(typeof hero.comparisonLabel).toBe("string");
    expect(hero.comparisonLabel.endsWith(" anterior")).toBe(true);
  });

  it("returns 4 periods", async () => {
    const res = await GET(makeReq());
    const { periods } = await res.json();
    expect(periods).toHaveLength(4);
    const ids = periods.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["hoy", "semana", "mes", "anyo"]));
  });

  it("returns dailyTrend entries with day, actual, ly", async () => {
    const res = await GET(makeReq());
    const { dailyTrend } = await res.json();
    expect(Array.isArray(dailyTrend)).toBe(true);
    expect(dailyTrend.length).toBeGreaterThan(0);
    for (const entry of dailyTrend) {
      expect(typeof entry.day).toBe("number");
      expect(typeof entry.ly).toBe("number");
      expect(entry.actual === null || typeof entry.actual === "number").toBe(true);
    }
  });

  it("returns health with syncAge, lastEtl, anomalies, rows", async () => {
    const res = await GET(makeReq());
    const { health } = await res.json();
    expect(typeof health.syncAge).toBe("string");
    expect(typeof health.lastEtl).toBe("string");
    expect(typeof health.anomalies).toBe("number");
    expect(typeof health.rows).toBe("number");
  });

  it("respects ?date= when within the available range", async () => {
    const res = await GET(makeReq("2026-04-29"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asOfDate).toBe("2026-04-29");
  });

  it("clamps ?date= forward to today_madrid when in the future", async () => {
    const res = await GET(makeReq("2099-12-31"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asOfDate).toBe("2026-05-03");
  });
});
