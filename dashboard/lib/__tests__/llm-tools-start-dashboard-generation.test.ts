import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStartDashboardGeneration } from "@/lib/llm-tools/handlers/start-dashboard-generation";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/llm", () => ({
  generateDashboard: vi.fn(),
}));

vi.mock("@/lib/db-write", () => ({
  sql: vi.fn(),
}));

// Minimal valid spec returned by the mocked generateDashboard
const VALID_SPEC_JSON = JSON.stringify({
  title: "Panel de ventas",
  description: "Ventas por tienda",
  widgets: [
    {
      type: "bar_chart",
      title: "Ventas por tienda",
      sql: "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas GROUP BY tienda",
      x: "label",
      y: "value",
    },
  ],
});

const ctx: LlmAgenticContext = {
  requestId: "req_test_generate",
  endpoint: "test",
};

const ctxWithConv: LlmAgenticContext = {
  ...ctx,
  conversationId: "conv-abc123",
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("handleStartDashboardGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it("returns INVALID_ARGS for non-JSON rawArgs", async () => {
    const result = await handleStartDashboardGeneration("not-json", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  it("returns INVALID_ARGS for empty prompt", async () => {
    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "   " }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  it("returns INVALID_ARGS when prompt is missing", async () => {
    const result = await handleStartDashboardGeneration(JSON.stringify({}), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_ARGS");
    }
  });

  it("returns GENERATE_FAILED when generateDashboard throws", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("GENERATE_FAILED");
      expect(result.message).toContain("LLM timeout");
    }
  });

  it("returns INVALID_SPEC when generateDashboard returns invalid JSON", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce("this is not json at all");

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas de hoy" }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_SPEC");
    }
  });

  it("returns INVALID_SPEC when spec fails Zod validation", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    // Missing required `widgets` field
    vi.mocked(generateDashboard).mockResolvedValueOnce(
      JSON.stringify({ title: "Test", description: "Desc" }),
    );

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas" }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_SPEC");
    }
  });

  it("returns DB_ERROR when sql INSERT fails", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockRejectedValueOnce(new Error("DB connection refused"));

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas por tienda" }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DB_ERROR");
    }
  });

  it("returns success with correct shape on happy path (no conversation)", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 42 }]);

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas por tienda" }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        dashboard_id: "42",
        redirect_url: "/dashboards/42?tab=modify",
        summary: expect.stringContaining("Panel de ventas"),
      });
    }
  });

  it("includes continue param in redirect_url when conversationId is set", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 99 }]);

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Ventas por tienda este mes" }),
      ctxWithConv,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        dashboard_id: "99",
        redirect_url: "/dashboards/99?tab=modify&continue=conv-abc123",
      });
    }
  });

  it("calls handoff endpoint when conversationId is present", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 77 }]);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas" }),
      ctxWithConv,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/conversations/conv-abc123/handoff-to-dashboard");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as { dashboard_id: number };
    expect(body.dashboard_id).toBe(77);
  });

  it("still returns success when handoff endpoint fails", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 55 }]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas" }),
      ctxWithConv,
    );
    // Dashboard was created — handoff failure is non-fatal
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ dashboard_id: "55" });
    }
  });

  it("does not call handoff endpoint when no conversationId", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 10 }]);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas" }),
      ctx, // no conversationId
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts optional template parameter without error", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    vi.mocked(generateDashboard).mockResolvedValueOnce(VALID_SPEC_JSON);

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 20 }]);

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel de ventas", template: "ventas" }),
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it("unwraps JSON fenced in markdown code block", async () => {
    const { generateDashboard } = await import("@/lib/llm");
    // LLM sometimes returns ```json ... ``` fencing
    vi.mocked(generateDashboard).mockResolvedValueOnce(
      "```json\n" + VALID_SPEC_JSON + "\n```",
    );

    const { sql } = await import("@/lib/db-write");
    vi.mocked(sql).mockResolvedValueOnce([{ id: 33 }]);

    const result = await handleStartDashboardGeneration(
      JSON.stringify({ prompt: "Panel con markdown fence" }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ dashboard_id: "33" });
    }
  });
});
