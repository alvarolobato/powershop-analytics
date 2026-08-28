import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({
  query: mockQuery,
  validateReadOnly: () => {},
}));

import { handleListPsTables, handleDescribePsTable } from "@/lib/llm-tools/handlers/sql";

const ctx = { requestId: "req_log_test", endpoint: "test" };

/**
 * The agentic tool layer hands the model a deliberately generic message on
 * failure ("Could not list tables."). That is fine for the model, but the real
 * Postgres error used to be destroyed at the catch and existed nowhere else —
 * llm_tool_calls records that a tool failed and its error_code, never why.
 * These tests pin the cause reaching the log, and pin that the model-facing
 * response is unchanged.
 */
describe("tool handlers log the underlying cause", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockQuery.mockReset();
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("list_ps_tables logs the real error and still returns the generic code", async () => {
    const err = new Error("relation does not exist");
    mockQuery.mockRejectedValue(err);

    const out = await handleListPsTables("{}", ctx);

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("DB_ERROR");
    expect(spy).toHaveBeenCalledWith(
      `[${ctx.requestId}] list_ps_tables failed:`,
      err,
    );
  });

  it("describe_ps_table logs the failing table name alongside the error", async () => {
    const err = new Error("permission denied");
    mockQuery.mockRejectedValue(err);

    const out = await handleDescribePsTable(
      JSON.stringify({ table: "ps_ventas" }),
      ctx,
    );

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("DB_ERROR");
    expect(spy).toHaveBeenCalledWith(
      `[${ctx.requestId}] describe_ps_table failed (table=ps_ventas):`,
      err,
    );
  });

  it("passes the error object, not its message, so the stack survives", async () => {
    const err = new Error("boom");
    mockQuery.mockRejectedValue(err);
    await handleListPsTables("{}", ctx);
    const logged = spy.mock.calls[0][1];
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).stack).toBeTruthy();
  });
});
