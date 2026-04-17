import { describe, it, expect } from "vitest";
import {
  substituteDateParams,
  CURR_FROM, CURR_TO, COMP_FROM, COMP_TO,
  CURR_MES_FROM, CURR_MES_TO, COMP_MES_FROM, COMP_MES_TO,
} from "../date-params";

const curr = { from: new Date("2025-01-01"), to: new Date("2025-01-31") };
const comp = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

describe("substituteDateParams", () => {
  it("replaces CURR_FROM and CURR_TO with date strings", () => {
    const sql = "WHERE d BETWEEN " + CURR_FROM + " AND " + CURR_TO;
    const result = substituteDateParams(sql, { curr });
    expect(result).toBe("WHERE d BETWEEN '2025-01-01' AND '2025-01-31'");
  });

  it("replaces CURR_MES tokens with YYYYMM integers", () => {
    const sql = "WHERE mes BETWEEN " + CURR_MES_FROM + " AND " + CURR_MES_TO;
    const result = substituteDateParams(sql, { curr });
    expect(result).toBe("WHERE mes BETWEEN 202501 AND 202501");
  });

  it("replaces COMP tokens when comp is provided", () => {
    const sql = COMP_FROM + " AND " + COMP_TO;
    const result = substituteDateParams(sql, { curr, comp });
    expect(result).toBe("'2024-01-01' AND '2024-01-31'");
  });

  it("leaves COMP tokens unchanged when comp is undefined", () => {
    const sql = COMP_FROM + " AND " + COMP_TO;
    const result = substituteDateParams(sql, { curr });
    expect(result).toBe(COMP_FROM + " AND " + COMP_TO);
  });

  it("is a no-op for SQL with no tokens", () => {
    const sql = "SELECT COUNT(*) FROM ps_ventas";
    const result = substituteDateParams(sql, { curr });
    expect(result).toBe(sql);
  });

  it("replaces COMP_MES tokens when comp is provided", () => {
    const sql = COMP_MES_FROM + " AND " + COMP_MES_TO;
    const result = substituteDateParams(sql, { curr, comp });
    expect(result).toBe("202401 AND 202401");
  });

  it("handles December correctly - toMesInt uses getMonth()+1", () => {
    const dec = { from: new Date("2025-12-01"), to: new Date("2025-12-31") };
    const sql = CURR_MES_FROM + " AND " + CURR_MES_TO;
    const result = substituteDateParams(sql, { curr: dec });
    expect(result).toBe("202512 AND 202512");
  });

  it("replaces all occurrences of a token in the SQL", () => {
    const sql = CURR_FROM + " OR " + CURR_FROM;
    const result = substituteDateParams(sql, { curr });
    expect(result).toBe("'2025-01-01' OR '2025-01-01'");
  });
});
