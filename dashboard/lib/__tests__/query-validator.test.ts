import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateQueryCost, QueryTooExpensiveError } from "../query-validator";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
const mockQuery = vi.mocked(query);

function makePlan(
  totalCost: number,
  nodeType = "Hash Join",
  relationName?: string
): string {
  const node: Record<string, unknown> = {
    "Node Type": nodeType,
    "Total Cost": totalCost,
  };
  if (relationName) {
    node["Relation Name"] = relationName;
  }
  return JSON.stringify([{ Plan: node }]);
}

function makeSeqScanPlan(totalCost: number, tableName: string): string {
  return JSON.stringify([
    {
      Plan: {
        "Node Type": "Nested Loop",
        "Total Cost": totalCost,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Total Cost": totalCost,
            "Relation Name": tableName,
          },
        ],
      },
    },
  ]);
}

describe("validateQueryCost", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.QUERY_COST_LIMIT;
    delete process.env.QUERY_COST_OVERRIDE_SECRET;
  });

  afterEach(() => {
    delete process.env.QUERY_COST_LIMIT;
    delete process.env.QUERY_COST_OVERRIDE_SECRET;
  });

  it("returns cost for a low-cost query", async () => {
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(500)]],
    });
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(500);
  });

  it("throws QueryTooExpensiveError when cost exceeds default limit (100000)", async () => {
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(200000)]],
    });
    await expect(validateQueryCost("SELECT * FROM ps_stock_tienda")).rejects.toThrow(
      QueryTooExpensiveError
    );
  });

  it("QueryTooExpensiveError has cost property and Spanish message", async () => {
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(150000)]],
    });
    try {
      await validateQueryCost("SELECT * FROM ps_ventas");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryTooExpensiveError);
      const e = err as QueryTooExpensiveError;
      expect(e.cost).toBe(150000);
      expect(e.message).toContain("demasiado costosa");
    }
  });

  it("respects QUERY_COST_LIMIT env var override", async () => {
    process.env.QUERY_COST_LIMIT = "50000";
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(60000)]],
    });
    await expect(validateQueryCost("SELECT * FROM ps_ventas")).rejects.toThrow(
      QueryTooExpensiveError
    );
  });

  it("does not throw when cost is exactly at the limit", async () => {
    process.env.QUERY_COST_LIMIT = "50000";
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(50000)]],
    });
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(50000);
  });

  it("bypasses check when force header matches secret", async () => {
    process.env.QUERY_COST_OVERRIDE_SECRET = "supersecret";
    const cost = await validateQueryCost("SELECT * FROM ps_stock_tienda", {
      forceHeader: "supersecret",
    });
    expect(cost).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not bypass when force header is wrong secret", async () => {
    process.env.QUERY_COST_OVERRIDE_SECRET = "supersecret";
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(500)]],
    });
    const cost = await validateQueryCost("SELECT 1", { forceHeader: "wrong" });
    expect(cost).toBe(500);
  });

  it("does not bypass when QUERY_COST_OVERRIDE_SECRET is unset", async () => {
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(500)]],
    });
    const cost = await validateQueryCost("SELECT 1", {
      forceHeader: "anyvalue",
    });
    expect(cost).toBe(500);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("does not bypass when QUERY_COST_OVERRIDE_SECRET is empty string", async () => {
    process.env.QUERY_COST_OVERRIDE_SECRET = "";
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(500)]],
    });
    const cost = await validateQueryCost("SELECT 1", {
      forceHeader: "",
    });
    expect(cost).toBe(500);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("warns on seq scan on large table but does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makeSeqScanPlan(5000, "ps_stock_tienda")]],
    });
    const cost = await validateQueryCost("SELECT * FROM ps_stock_tienda");
    expect(cost).toBe(5000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ps_stock_tienda")
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Seq scan"));
    warnSpy.mockRestore();
  });

  it("does not warn for seq scan on small (non-listed) table", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [[makePlan(1000, "Seq Scan", "ps_small_table")]],
    });
    await validateQueryCost("SELECT * FROM ps_small_table");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 0 and does not throw when EXPLAIN query fails (fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("DB connection error"));
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EXPLAIN failed"),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it("returns 0 and does not throw when EXPLAIN returns malformed JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({
      columns: ["QUERY PLAN"],
      rows: [["not valid json {{{"]],
    });
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
