import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@/lib/db", () => ({
  query: mockQuery,
  validateReadOnly: vi.fn(),
  SqlValidationError: class SqlValidationError extends Error {},
  QueryTimeoutError: class QueryTimeoutError extends Error {},
  ConnectionError: class ConnectionError extends Error {},
  resetPool: vi.fn(),
  stripLiteralsAndComments: vi.fn((s: string) => s),
}));

import { validateQueryCost, QueryTooExpensiveError } from "../query-validator";

function makePlanResult(totalCost: number, nodeType = "Seq Scan", relationName = "ps_ventas") {
  const plan = [
    {
      Plan: {
        "Node Type": nodeType,
        "Relation Name": relationName,
        "Total Cost": totalCost,
        Plans: [],
      },
    },
  ];
  return { columns: ["QUERY PLAN"], rows: [[JSON.stringify(plan)]] };
}

describe("validateQueryCost", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    delete process.env.QUERY_COST_LIMIT;
    delete process.env.QUERY_COST_OVERRIDE_SECRET;
  });

  afterEach(() => {
    delete process.env.QUERY_COST_LIMIT;
    delete process.env.QUERY_COST_OVERRIDE_SECRET;
  });

  // ─── Force-bypass ────────────────────────────────────────────────────────────

  it("returns 0 without calling EXPLAIN when force secret matches", async () => {
    process.env.QUERY_COST_OVERRIDE_SECRET = "s3cr3t";
    const cost = await validateQueryCost("SELECT * FROM ps_ventas", { forceHeader: "s3cr3t" });
    expect(cost).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still checks cost when force header does not match the secret", async () => {
    process.env.QUERY_COST_OVERRIDE_SECRET = "s3cr3t";
    mockQuery.mockResolvedValue(makePlanResult(500));
    const cost = await validateQueryCost("SELECT * FROM ps_ventas", { forceHeader: "wrong" });
    expect(cost).toBe(500);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("still checks cost when no secret env var is set", async () => {
    mockQuery.mockResolvedValue(makePlanResult(500));
    const cost = await validateQueryCost("SELECT * FROM ps_ventas", { forceHeader: "anything" });
    expect(cost).toBe(500);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  // ─── Cost threshold ──────────────────────────────────────────────────────────

  it("returns cost when below default threshold (100000)", async () => {
    mockQuery.mockResolvedValue(makePlanResult(99999));
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(99999);
  });

  it("throws QueryTooExpensiveError when cost exceeds default threshold", async () => {
    mockQuery.mockResolvedValue(makePlanResult(100001));
    await expect(validateQueryCost("SELECT * FROM ps_stock_tienda")).rejects.toThrow(
      QueryTooExpensiveError,
    );
  });

  it("throws QueryTooExpensiveError with the correct cost value", async () => {
    mockQuery.mockResolvedValue(makePlanResult(250000));
    try {
      await validateQueryCost("SELECT * FROM ps_stock_tienda");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryTooExpensiveError);
      expect((err as QueryTooExpensiveError).cost).toBe(250000);
    }
  });

  it("respects QUERY_COST_LIMIT env var", async () => {
    process.env.QUERY_COST_LIMIT = "5000";
    mockQuery.mockResolvedValue(makePlanResult(5001));
    await expect(validateQueryCost("SELECT * FROM ps_ventas")).rejects.toThrow(QueryTooExpensiveError);
  });

  it("supports float QUERY_COST_LIMIT", async () => {
    process.env.QUERY_COST_LIMIT = "50000.5";
    mockQuery.mockResolvedValue(makePlanResult(50000.6));
    await expect(validateQueryCost("SELECT * FROM ps_ventas")).rejects.toThrow(QueryTooExpensiveError);
  });

  it("falls back to 100000 threshold when QUERY_COST_LIMIT is not a number", async () => {
    process.env.QUERY_COST_LIMIT = "not-a-number";
    mockQuery.mockResolvedValue(makePlanResult(99999));
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(99999);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it("falls back to 100000 threshold when QUERY_COST_LIMIT is empty string", async () => {
    process.env.QUERY_COST_LIMIT = "";
    mockQuery.mockResolvedValue(makePlanResult(99999));
    const cost = await validateQueryCost("SELECT 1");
    expect(cost).toBe(99999);
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  // ─── EXPLAIN prefix stripping ─────────────────────────────────────────────────

  it("strips leading EXPLAIN so EXPLAIN (FORMAT JSON) is not doubled", async () => {
    mockQuery.mockResolvedValue(makePlanResult(500));
    await validateQueryCost("EXPLAIN SELECT * FROM ps_ventas");
    const calledSql = mockQuery.mock.calls[0][0] as string;
    expect(calledSql).not.toMatch(/EXPLAIN.*EXPLAIN/i);
    expect(calledSql).toMatch(/^EXPLAIN \(FORMAT JSON\)/i);
  });

  it("strips EXPLAIN ANALYZE prefix to prevent cost guard bypass", async () => {
    mockQuery.mockResolvedValue(makePlanResult(500));
    await validateQueryCost("EXPLAIN ANALYZE SELECT * FROM ps_ventas");
    const calledSql = mockQuery.mock.calls[0][0] as string;
    expect(calledSql).not.toMatch(/ANALYZE/i);
    expect(calledSql).toMatch(/^EXPLAIN \(FORMAT JSON\)/i);
  });

  // ─── Seq scan warnings ────────────────────────────────────────────────────────

  it("emits console.warn for seq scan on large tables", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValue(makePlanResult(500, "Seq Scan", "ps_stock_tienda"));
    await validateQueryCost("SELECT * FROM ps_stock_tienda");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ps_stock_tienda"));
    warnSpy.mockRestore();
  });

  it("does not warn for seq scan on small tables", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValue(makePlanResult(500, "Seq Scan", "ps_tiendas"));
    await validateQueryCost("SELECT * FROM ps_tiendas");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("emits console.warn for parallel seq scan on large tables", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValue(makePlanResult(500, "Parallel Seq Scan", "ps_stock_tienda"));
    await validateQueryCost("SELECT * FROM ps_stock_tienda");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ps_stock_tienda"));
    warnSpy.mockRestore();
  });

  it("does not warn for index scan on large tables", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockResolvedValue(makePlanResult(500, "Index Scan", "ps_ventas"));
    await validateQueryCost("SELECT * FROM ps_ventas WHERE id = 1");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ─── Fail-open on EXPLAIN errors ──────────────────────────────────────────────

  it("returns 0 (fail-open) when EXPLAIN query fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("syntax error"));
    const cost = await validateQueryCost("SELECT * FROM ps_ventas");
    expect(cost).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EXPLAIN failed"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("re-throws QueryTooExpensiveError even inside catch block", async () => {
    mockQuery.mockResolvedValue(makePlanResult(999999));
    await expect(validateQueryCost("SELECT * FROM ps_stock_tienda")).rejects.toThrow(
      QueryTooExpensiveError,
    );
  });
});
