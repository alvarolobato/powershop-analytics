import { describe, it, expect } from "vitest";
import { extractDashboardSqlRefs } from "@/lib/llm-tools/dashboard-query-extractor";
import type { DashboardSpec } from "@/lib/schema";

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
