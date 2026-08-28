import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock("@/lib/db-write", () => ({ sql: mockSql }));

import { logQueryError } from "../query-errors";

describe("logQueryError", () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockSql.mockResolvedValue([]);
  });

  it("persists the failing SQL, its param count and the Postgres code", async () => {
    const err = Object.assign(new Error("there is no parameter $1"), {
      code: "42P02",
    });
    await logQueryError({
      requestId: "req_abc123",
      code: "DB_QUERY",
      sqlText: "SELECT * FROM ps_ventas WHERE fecha = $1",
      paramCount: 0,
      durationMs: 12,
      error: err,
    });

    expect(mockSql).toHaveBeenCalledOnce();
    const [text, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("INSERT INTO query_errors");
    expect(params[0]).toBe("req_abc123");
    expect(params[1]).toBe("DB_QUERY");
    expect(params[2]).toBe("42P02");
    expect(String(params[3])).toContain("there is no parameter $1");
    expect(params[4]).toContain("ps_ventas");
    // The parameter-mismatch bug is visible precisely in this pairing:
    // SQL references $1 while zero params were bound.
    expect(params[5]).toBe(0);
  });

  it("stores a null pg_code when the error carries none", async () => {
    await logQueryError({
      requestId: "req_x",
      code: "UNKNOWN",
      error: new Error("boom"),
    });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBeNull();
  });

  it("truncates oversized SQL instead of storing it whole", async () => {
    await logQueryError({
      requestId: "req_x",
      code: "DB_QUERY",
      sqlText: "x".repeat(9000),
      error: new Error("boom"),
    });
    const [, params] = mockSql.mock.calls[0] as [string, unknown[]];
    expect((params[4] as string).length).toBeLessThan(9000);
    expect(params[4]).toContain("9000 chars");
  });

  it("never throws when the insert fails, and says why", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSql.mockRejectedValue(new Error("table missing"));
    await expect(
      logQueryError({ requestId: "req_y", code: "UNKNOWN", error: new Error("x") }),
    ).resolves.toBeUndefined();
    // Closing one silent hole must not open a quieter one.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
