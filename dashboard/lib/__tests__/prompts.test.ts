import { describe, it, expect } from "vitest";
import { buildGeneratePrompt, buildModifyPrompt } from "../prompts";

describe("prompts", () => {
  describe("buildGeneratePrompt", () => {
    const prompt = buildGeneratePrompt();

    it("includes the role description", () => {
      expect(prompt).toContain("dashboard generator");
      expect(prompt).toContain("Spanish retail");
    });

    it("includes widget type definitions", () => {
      expect(prompt).toContain("kpi_row");
      expect(prompt).toContain("bar_chart");
      expect(prompt).toContain("line_chart");
      expect(prompt).toContain("area_chart");
      expect(prompt).toContain("donut_chart");
      expect(prompt).toContain("table");
      expect(prompt).toContain("number");
    });

    it("includes JSON format examples", () => {
      expect(prompt).toContain('"type": "kpi_row"');
      expect(prompt).toContain('"type": "bar_chart"');
      expect(prompt).toContain('"type": "line_chart"');
    });

    it("includes PostgreSQL schema", () => {
      expect(prompt).toContain("ps_ventas");
      expect(prompt).toContain("ps_lineas_ventas");
      expect(prompt).toContain("ps_articulos");
      expect(prompt).toContain("ps_stock_tienda");
    });

    it("includes business rules", () => {
      expect(prompt).toContain("total_si");
      expect(prompt).toContain("fecha_creacion");
      expect(prompt).toContain("ccrefejofacm");
    });

    it("includes SQL pairs", () => {
      expect(prompt).toContain("Example SQL Patterns");
      expect(prompt).toContain("52 pairs");
    });

    it("includes output format spec", () => {
      expect(prompt).toContain("Output Format");
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"widgets"');
    });

    it("includes SQL rules", () => {
      expect(prompt).toContain("SQL Rules");
      expect(prompt).toContain("NEVER use total");
      expect(prompt).toContain("almacén central");
    });

    it("includes table relationships", () => {
      expect(prompt).toContain("Table Relationships");
      expect(prompt).toContain("MANY_TO_ONE");
    });
  });

  describe("buildModifyPrompt", () => {
    const sampleSpec = JSON.stringify({
      title: "Test Dashboard",
      widgets: [{ id: "w1", type: "number", title: "Test", sql: "SELECT 1" }],
    });
    const prompt = buildModifyPrompt(sampleSpec);

    it("includes the modifier role", () => {
      expect(prompt).toContain("dashboard modifier");
    });

    it("includes the current spec", () => {
      expect(prompt).toContain("Current Dashboard Spec");
      expect(prompt).toContain("Test Dashboard");
    });

    it("does not wrap current spec in markdown fences", () => {
      expect(prompt).not.toContain("```json\n" + sampleSpec);
      expect(prompt).toContain("Do not wrap your response in markdown fences");
    });

    it("instructs to preserve existing widgets", () => {
      expect(prompt).toContain("Preserve all existing widgets");
    });

    it("instructs to continue id sequence", () => {
      expect(prompt).toContain("continue the id sequence");
    });

    it("still includes all reference sections", () => {
      expect(prompt).toContain("Widget Types");
      expect(prompt).toContain("PostgreSQL Schema");
      expect(prompt).toContain("Business Rules");
      expect(prompt).toContain("Example SQL Patterns");
    });
  });
});
