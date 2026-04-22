import { describe, it, expect } from "vitest";
import { handleValidateQuery } from "@/lib/llm-tools/handlers/sql";

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
});
