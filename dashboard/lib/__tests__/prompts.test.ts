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
      expect(prompt).toContain("53 pairs");
    });

    it("includes output format spec", () => {
      expect(prompt).toContain("Output Format");
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"widgets"');
    });

    it("includes glossary field in output format example", () => {
      expect(prompt).toContain('"glossary"');
    });

    it("includes rule requiring glossary to always be present", () => {
      expect(prompt).toContain('glossary" field MUST always be included');
    });

    it("includes glossary entry structure in output format", () => {
      expect(prompt).toContain('"term"');
      expect(prompt).toContain('"definition"');
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

    it("includes comparison_sql documentation", () => {
      expect(prompt).toContain("comparison_sql");
    });

    it("includes COMP_FROM and COMP_TO token documentation", () => {
      expect(prompt).toContain(":comp_from");
      expect(prompt).toContain(":comp_to");
    });

    it("includes all eight date placeholder tokens", () => {
      expect(prompt).toContain(":curr_from");
      expect(prompt).toContain(":curr_to");
      expect(prompt).toContain(":comp_from");
      expect(prompt).toContain(":comp_to");
      expect(prompt).toContain(":curr_mes_from");
      expect(prompt).toContain(":curr_mes_to");
      expect(prompt).toContain(":comp_mes_from");
      expect(prompt).toContain(":comp_mes_to");
    });

    it("includes colecciones and clave_temporada guidance", () => {
      expect(prompt).toContain("clave_temporada");
      expect(prompt).toContain("colec");
    });

    it("example JSON blocks use :curr_from/:curr_to instead of hardcoded CURRENT_DATE for date-filtered SQL", () => {
      const combined = buildGeneratePrompt() + "\n" + buildModifyPrompt("{}");

      // Extract all ```json ... ``` code blocks
      const codeBlockRe = /```json\s*([\s\S]*?)```/g;
      const dateColumns =
        /fecha_creacion|fecha_documento|fecha_envio|fecha_factura/;
      const hardcodedDate = /CURRENT_DATE/;

      let match: RegExpExecArray | null;
      while ((match = codeBlockRe.exec(combined)) !== null) {
        const blockText = match[1];

        // Walk sql/trend_sql fields (must use curr_from/curr_to)
        const primarySqlRe =
          /"(?:sql|trend_sql)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        let sqlMatch: RegExpExecArray | null;
        while ((sqlMatch = primarySqlRe.exec(blockText)) !== null) {
          const sql = sqlMatch[1];

          // Allow-list: anomaly_sql uses generate_series intentionally — skip
          if (sql.includes("generate_series")) continue;

          // If the SQL filters on a date column, it must use curr tokens, not literals
          if (dateColumns.test(sql)) {
            expect(sql).toContain(":curr_from");
            expect(sql).toContain(":curr_to");
            expect(sql).not.toMatch(hardcodedDate);
          }
        }

        // Walk comparison_sql fields (must use comp_from/comp_to, not literals)
        const compSqlRe =
          /"comparison_sql"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
        while ((sqlMatch = compSqlRe.exec(blockText)) !== null) {
          const sql = sqlMatch[1];
          if (dateColumns.test(sql)) {
            expect(sql).toContain(":comp_from");
            expect(sql).toContain(":comp_to");
            expect(sql).not.toMatch(hardcodedDate);
          }
        }
      }
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

    it("instructs to preserve existing glossary entries", () => {
      expect(prompt).toContain("Preserve all existing glossary entries");
    });

    it("instructs to add new glossary terms for new widgets", () => {
      expect(prompt).toContain("Add new entries for any new business terms");
    });

    it("instructs to always include glossary in the response", () => {
      expect(prompt).toContain("glossary' field MUST always be present");
    });

    it("includes the glossary field in the output format example", () => {
      expect(prompt).toContain('"glossary"');
    });
  });
});
