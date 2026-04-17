import { describe, it, expect } from "vitest";
import { TEMPLATES, type DashboardTemplate } from "../templates";
import { validateSpec, DashboardSpecSchema } from "../schema";

// ---------------------------------------------------------------------------
// Structural tests
// ---------------------------------------------------------------------------

describe("TEMPLATES array", () => {
  it("exports exactly 5 templates", () => {
    expect(TEMPLATES).toHaveLength(5);
  });

  it("has unique slugs", () => {
    const slugs = TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every template has a non-empty name and description", () => {
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Zod validation for each template spec
// ---------------------------------------------------------------------------

describe.each(TEMPLATES.map((t) => [t.slug, t] as [string, DashboardTemplate]))(
  "template '%s' passes Zod validation",
  (_slug, template) => {
    it("validateSpec does not throw", () => {
      expect(() => validateSpec(template.spec)).not.toThrow();
    });

    it("safeParse returns success", () => {
      const result = DashboardSpecSchema.safeParse(template.spec);
      expect(result.success).toBe(true);
    });

    it("has a non-empty title in the spec", () => {
      expect(template.spec.title.length).toBeGreaterThan(0);
    });

    it("has at least one widget", () => {
      expect(template.spec.widgets.length).toBeGreaterThanOrEqual(1);
    });

    it("every widget SQL is non-empty", () => {
      for (const widget of template.spec.widgets) {
        if (widget.type === "kpi_row") {
          for (const item of widget.items) {
            expect(item.sql.trim().length).toBeGreaterThan(0);
          }
        } else {
          expect(widget.sql.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it("every widget SQL references ps_* tables", () => {
      const allSql: string[] = [];
      for (const widget of template.spec.widgets) {
        if (widget.type === "kpi_row") {
          for (const item of widget.items) {
            allSql.push(item.sql);
          }
        } else {
          allSql.push(widget.sql);
        }
      }
      for (const sql of allSql) {
        expect(sql).toMatch(/ps_/);
      }
    });

    it("every widget SQL with a date filter uses :curr_from / :curr_to tokens (no hardcoded CURRENT_DATE)", () => {
      const allSql: string[] = [];
      for (const widget of template.spec.widgets) {
        if (widget.type === "kpi_row") {
          for (const item of widget.items) {
            allSql.push(item.sql);
          }
        } else {
          allSql.push(widget.sql);
        }
      }
      for (const sql of allSql) {
        // If the SQL contains a date filter, it must use :curr_from/:curr_to, never CURRENT_DATE
        if (/>=|<=|BETWEEN/.test(sql) && /date|fecha/i.test(sql)) {
          expect(sql).toMatch(/:curr_from/);
          expect(sql).toMatch(/:curr_to/);
          expect(sql).not.toMatch(/CURRENT_DATE/);
        }
      }
    });
  },
);

// ---------------------------------------------------------------------------
// SQL rule compliance
// ---------------------------------------------------------------------------

describe("SQL rule compliance across all templates", () => {
  const allSql: string[] = [];
  for (const t of TEMPLATES) {
    for (const widget of t.spec.widgets) {
      if (widget.type === "kpi_row") {
        for (const item of widget.items) {
          allSql.push(item.sql);
        }
      } else {
        allSql.push(widget.sql);
      }
    }
  }

  it("never uses the 'total' column without _si suffix for retail ventas", () => {
    for (const sql of allSql) {
      if (/ps_ventas/.test(sql) || /ps_lineas_ventas/.test(sql)) {
        // Should not have standalone "total" as aggregate target (total_si is ok)
        // Match SUM("total") or SUM(total) but not SUM("total_si") or SUM("total_coste_si")
        expect(sql).not.toMatch(/SUM\(\s*"?total"?\s*\)(?!_)/);
      }
    }
  });

  it("never uses fecha_documento", () => {
    for (const sql of allSql) {
      expect(sql).not.toMatch(/fecha_documento/);
    }
  });

  it("retail ventas queries exclude tienda 99", () => {
    for (const sql of allSql) {
      if (/ps_ventas/.test(sql) || /ps_lineas_ventas/.test(sql)) {
        expect(sql).toMatch(/"?tienda"?\s*(<>|!=)\s*'99'/);
      }
    }
  });

  it("all time-filtered SQL contains both :curr_from and :curr_to tokens", () => {
    for (const sql of allSql) {
      if (/>=|<=|BETWEEN/.test(sql) && /date|fecha/i.test(sql)) {
        expect(sql).toMatch(/:curr_from/);
        expect(sql).toMatch(/:curr_to/);
      }
    }
  });
});
