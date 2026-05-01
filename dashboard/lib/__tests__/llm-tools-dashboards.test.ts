import { describe, it, expect } from "vitest";
import { extractDashboardSqlRefs } from "@/lib/llm-tools/dashboard-query-extractor";
import { handleValidateDashboardSpec } from "@/lib/llm-tools/handlers/dashboards";
import type { DashboardSpec } from "@/lib/schema";
import type { LlmAgenticContext } from "@/lib/llm-tools/types";

const ctx: LlmAgenticContext = {
  requestId: "req_test",
  endpoint: "test",
};

describe("dashboard-query-extractor", () => {
  it("collects primary and comparison SQL from chart widgets", () => {
    const spec: DashboardSpec = {
      title: "Demo",
      widgets: [
        {
          type: "bar_chart",
          title: "Ventas",
          sql: "SELECT 1 AS a",
          x: "a",
          y: "b",
          comparison_sql: "SELECT 2 AS a",
        },
      ],
    };
    const refs = extractDashboardSqlRefs(spec);
    expect(refs.map((r) => r.kind)).toEqual(["chart_sql", "comparison_sql"]);
    expect(refs[0].sql).toContain("SELECT 1");
    expect(refs[1].sql).toContain("SELECT 2");
  });

  it("expands kpi_row items including optional sql fields", () => {
    const spec: DashboardSpec = {
      title: "K",
      widgets: [
        {
          type: "kpi_row",
          items: [
            {
              label: "A",
              sql: "SELECT 1",
              format: "number",
              trend_sql: "SELECT 2",
              anomaly_sql: "SELECT 3",
            },
          ],
        },
      ],
    };
    const refs = extractDashboardSqlRefs(spec);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.kind)).toEqual(["kpi_sql", "kpi_trend", "kpi_anomaly"]);
  });
});

type ValidateData = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  hint: string;
};

describe("handleValidateDashboardSpec", () => {
  it("rejects missing 'spec' argument", async () => {
    const out = await handleValidateDashboardSpec("{}", ctx);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("INVALID_ARGS");
  });

  it("rejects non-object spec", async () => {
    const out = await handleValidateDashboardSpec(
      JSON.stringify({ spec: "not an object" }),
      ctx,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("INVALID_ARGS");
  });

  it("returns ok=false with structural errors when spec is malformed", async () => {
    const out = await handleValidateDashboardSpec(
      JSON.stringify({ spec: { title: "x" } }),
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as ValidateData;
      expect(data.ok).toBe(false);
      expect(data.errors.length).toBeGreaterThan(0);
      expect(data.errors.join("\n")).toMatch(/widgets/);
      expect(data.hint).toMatch(/structural errors/);
    }
  });

  it("returns ok=true with no errors and no warnings for a clean spec", async () => {
    const spec: DashboardSpec = {
      title: "Clean",
      widgets: [
        {
          id: "w1",
          type: "bar_chart",
          title: "Ventas",
          sql: "SELECT label, value FROM ps_ventas LIMIT 10",
          x: "label",
          y: "value",
        },
      ],
    };
    const out = await handleValidateDashboardSpec(JSON.stringify({ spec }), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as ValidateData;
      expect(data.ok).toBe(true);
      expect(data.errors).toEqual([]);
      expect(data.hint).toMatch(/valid/i);
    }
  });

  it("surfaces SQL lint warnings while keeping structural errors empty", async () => {
    const spec: DashboardSpec = {
      title: "Lint",
      widgets: [
        {
          id: "w1",
          type: "kpi_row",
          items: [
            {
              label: "Última venta",
              sql: "SELECT COALESCE(MAX(fecha_creacion), 'sin datos') AS v FROM ps_ventas",
              format: "number",
            },
          ],
        },
      ],
    };
    const out = await handleValidateDashboardSpec(JSON.stringify({ spec }), ctx);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as ValidateData;
      expect(data.errors).toEqual([]);
      expect(data.warnings.length).toBeGreaterThan(0);
      expect(data.warnings.join(" ")).toMatch(/COALESCE|texto/);
    }
  });
});
