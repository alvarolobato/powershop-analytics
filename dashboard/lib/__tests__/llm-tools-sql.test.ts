import { describe, it, expect } from "vitest";
import {
  handleExecuteQuery,
  handleValidateQuery,
} from "@/lib/llm-tools/handlers/sql";

const ctx = { requestId: "req_sql_test", endpoint: "test" };

describe("SQL tool handlers", () => {
  it("validate_query returns INVALID_ARGS for malformed JSON", async () => {
    const out = await handleValidateQuery("not-json", ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("INVALID_ARGS");
    }
  });

  it("validate_query returns INVALID_ARGS when sql is missing", async () => {
    const out = await handleValidateQuery("{}", ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("INVALID_ARGS");
    }
  });

  it("validate_query rejects bare EXPLAIN before touching the database", async () => {
    const out = await handleValidateQuery(
      JSON.stringify({ sql: "EXPLAIN SELECT 1" }),
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.valid).toBe(false);
      expect(out.data.reason).toMatch(/SELECT or WITH/i);
    }
  });

  it("execute_query rejects bare EXPLAIN before touching the database", async () => {
    const out = await handleExecuteQuery(
      JSON.stringify({ sql: "EXPLAIN ANALYZE SELECT 1" }),
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.error).toMatch(/SELECT or WITH/i);
    }
  });
});
