// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/home", () => {
  it("returns 200", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("returns a JSON body with all top-level keys", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body).toHaveProperty("asOf");
    expect(body).toHaveProperty("hero");
    expect(body).toHaveProperty("periods");
    expect(body).toHaveProperty("dailyTrend");
    expect(body).toHaveProperty("topStores");
    expect(body).toHaveProperty("alerts");
    expect(body).toHaveProperty("opsRetail");
    expect(body).toHaveProperty("opsWholesale");
    expect(body).toHaveProperty("health");
  });

  it("returns hero with required fields", async () => {
    const res = await GET();
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
    expect(hero.hourly).toHaveLength(24);
    expect(Array.isArray(hero.hourlyComparison)).toBe(true);
    expect(hero.hourlyComparison).toHaveLength(24);
    expect(typeof hero.comparisonLabel).toBe("string");
    expect(hero.comparisonLabel.endsWith(" anterior")).toBe(true);
  });

  it("returns 4 periods", async () => {
    const res = await GET();
    const { periods } = await res.json();
    expect(periods).toHaveLength(4);
    const ids = periods.map((p: { id: string }) => p.id);
    expect(ids).toContain("hoy");
    expect(ids).toContain("semana");
    expect(ids).toContain("mes");
    expect(ids).toContain("anyo");
  });

  it("returns 10 top stores", async () => {
    const res = await GET();
    const { topStores } = await res.json();
    expect(topStores).toHaveLength(10);
  });

  it("each store has required fields", async () => {
    const res = await GET();
    const { topStores } = await res.json();
    for (const store of topStores) {
      expect(store).toHaveProperty("code");
      expect(store).toHaveProperty("name");
      expect(store).toHaveProperty("sales");
      expect(store).toHaveProperty("delta");
      expect(store).toHaveProperty("spark");
      expect(store).toHaveProperty("status");
      expect(["ok", "watch", "alert"]).toContain(store.status);
    }
  });

  it("returns alerts with sev pills", async () => {
    const res = await GET();
    const { alerts } = await res.json();
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(["crit", "warn", "info"]).toContain(alert.sev);
      expect(typeof alert.store).toBe("string");
      expect(typeof alert.reason).toBe("string");
      expect(typeof alert.action).toBe("string");
    }
  });

  it("returns opsRetail and opsWholesale arrays", async () => {
    const res = await GET();
    const { opsRetail, opsWholesale } = await res.json();
    expect(Array.isArray(opsRetail)).toBe(true);
    expect(opsRetail.length).toBeGreaterThan(0);
    expect(Array.isArray(opsWholesale)).toBe(true);
    expect(opsWholesale.length).toBeGreaterThan(0);
  });

  it("each metric has id, label, value, format, delta", async () => {
    const res = await GET();
    const { opsRetail } = await res.json();
    for (const m of opsRetail) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(typeof m.value).toBe("number");
      expect(["eur", "eur2", "int", "pct", "x"]).toContain(m.format);
      expect(typeof m.delta).toBe("number");
    }
  });

  it("returns health with syncAge, lastEtl, anomalies, rows", async () => {
    const res = await GET();
    const { health } = await res.json();
    expect(typeof health.syncAge).toBe("string");
    expect(typeof health.lastEtl).toBe("string");
    expect(typeof health.anomalies).toBe("number");
    expect(typeof health.rows).toBe("number");
  });

  it("dailyTrend has entries with day, actual, ly", async () => {
    const res = await GET();
    const { dailyTrend } = await res.json();
    expect(Array.isArray(dailyTrend)).toBe(true);
    expect(dailyTrend.length).toBeGreaterThan(0);
    for (const entry of dailyTrend) {
      expect(typeof entry.day).toBe("number");
      expect(typeof entry.ly).toBe("number");
      // actual can be null or number
      expect(entry.actual === null || typeof entry.actual === "number").toBe(true);
    }
  });
});
