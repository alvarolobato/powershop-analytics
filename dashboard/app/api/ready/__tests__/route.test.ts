import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => ({
  Pool: class MockPool {
    query = mockQuery;
    end = mockEnd;
  },
}));

import { GET } from "../route";
import { resetPool } from "@/lib/db";

describe("GET /api/ready", () => {
  beforeEach(async () => {
    mockQuery.mockReset();
    mockEnd.mockClear();
    await resetPool();
  });

  it("returns 200 ready when postgres and watermarks respond", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [[1]], fields: [] }).mockResolvedValueOnce({
      rows: [
        ["ventas", new Date("2026-01-01T00:00:00.000Z")],
        ["articulos", new Date("2026-01-02T00:00:00.000Z")],
      ],
      fields: [],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.postgres).toBe("ok");
    expect(body.watermarks).toBe(2);
    expect(typeof body.overall_stale).toBe("boolean");
  });
});
