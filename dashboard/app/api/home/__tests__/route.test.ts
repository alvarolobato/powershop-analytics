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
      // today_mirror_hour=8 (today's data is synced through hour 8) and
      // today_row_count=42 (today has rows) so cutoffActive=true when
      // ?date=2026-05-03 is passed; LEAST(9, 8) = 8 is the effective
      // cutoff hour.
      if (sql.includes("max_synced") && sql.includes("today_madrid")) {
        return {
          rows: [
            [
              "2026-04-30",
              "2024-01-01",
              "2026-05-03",
              "2026-05-03T07:00:00Z",
              8,
              42,
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
    expect(body).toHaveProperty("inactiveStores");
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
    // Same-hour-cutoff fields. When the as-of date is in the past
    // (the default in this test fixture: 2026-04-30 vs today 2026-05-03)
    // the cutoff is inactive and these are null.
    expect(hero).toHaveProperty("comparisonCutoffHour");
    expect(hero).toHaveProperty("yesterdayCutoff");
    expect(hero).toHaveProperty("lastYearCutoff");
    expect(hero.comparisonCutoffHour).toBeNull();
    expect(hero.yesterdayCutoff).toBeNull();
    expect(hero.lastYearCutoff).toBeNull();
  });

  it("activates same-hour cutoff when ?date= is today_madrid", async () => {
    // The mock pivot row reports today_madrid = 2026-05-03,
    // now_utc = 2026-05-03T07:00:00Z (Madrid is UTC+2 in May / CEST → 09:00),
    // and today_mirror_hour = 8 (ETL has only synced through hour 8 today).
    // Effective cutoff is LEAST(9, 8) = 8.
    const { query: queryMock } = (await import("@/lib/db")) as unknown as {
      query: ReturnType<typeof vi.fn>;
    };
    const res = await GET(makeReq("2026-05-03"));
    const { hero, periods } = await res.json();
    // Exact value, not just a range — locks in the LEAST(wall, mirror) math.
    expect(hero.comparisonCutoffHour).toBe(8);
    expect(typeof hero.yesterdayCutoff).toBe("number");
    expect(typeof hero.lastYearCutoff).toBe("number");
    // The "Hoy" period card surfaces the exact cutoff hour in its labels.
    const hoyPeriod = periods.find((p: { id: string }) => p.id === "hoy");
    expect(hoyPeriod.prevLabel).toContain("hasta las 08:00");
    expect(hoyPeriod.yoyLabel).toContain("hasta las 08:00");
    // The cutoff-aware queries (hero + periodHoy) MUST receive parameters
    // in [asOfDate, cutoffHour, cutoffActive] order — a swap would silently
    // produce wrong totals. Inspect the mock to lock that down.
    const heroSqlCalls = queryMock.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("ayer_cutoff") &&
        sql.includes("ly_cutoff"),
    );
    expect(heroSqlCalls.length).toBe(1);
    expect(heroSqlCalls[0][1]).toEqual(["2026-05-03", 8, true]);
    const periodHoySqlCalls = queryMock.mock.calls.filter(
      ([sql]) =>
        typeof sql === "string" &&
        sql.includes("AS hoy") &&
        sql.includes("AS ayer") &&
        sql.includes("AS lyear") &&
        !sql.includes("ayer_cutoff"), // disambiguate from hero
    );
    expect(periodHoySqlCalls.length).toBe(1);
    expect(periodHoySqlCalls[0][1]).toEqual(["2026-05-03", 8, true]);
  });

  it("deactivates the cutoff when today has zero mirrored rows", async () => {
    // Re-mock the pivot row so today_row_count=0 and today_mirror_hour=null.
    const { query: queryMock } = (await import("@/lib/db")) as unknown as {
      query: ReturnType<typeof vi.fn>;
    };
    queryMock.mockImplementationOnce(async () => ({
      rows: [["2026-04-30", "2024-01-01", "2026-05-03", "2026-05-03T07:00:00Z", null, 0]],
    }));
    const res = await GET(makeReq("2026-05-03"));
    const { hero } = await res.json();
    // No rows for today → cutoff inactive even though as-of is today.
    expect(hero.comparisonCutoffHour).toBeNull();
    expect(hero.yesterdayCutoff).toBeNull();
    expect(hero.lastYearCutoff).toBeNull();
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
