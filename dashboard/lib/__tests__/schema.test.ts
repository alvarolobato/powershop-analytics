import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  validateSpec,
  DashboardSpecSchema,
  WidgetSchema,
  type DashboardSpec,
} from "../schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid spec matching the ARCHITECTURE.md example. */
const VALID_SPEC: DashboardSpec = {
  title: "Cuadro de Mandos — Ventas Marzo 2026",
  description: "Panel para el responsable de ventas",
  widgets: [
    {
      id: "w1",
      type: "kpi_row",
      items: [
        {
          label: "Ventas Netas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency",
          prefix: "€",
        },
        {
          label: "Tickets",
          sql: "SELECT COUNT(DISTINCT reg_ventas) FROM ps_ventas",
          format: "number",
        },
      ],
    },
    {
      type: "bar_chart",
      title: "Ventas por Tienda",
      sql: "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas GROUP BY tienda",
      x: "label",
      y: "value",
    },
    {
      type: "line_chart",
      title: "Tendencia Semanal",
      sql: "SELECT DATE_TRUNC('week', fecha_creacion) AS x, SUM(total_si) AS y FROM ps_ventas GROUP BY 1",
    },
    {
      type: "table",
      title: "Top 10 Artículos",
      sql: 'SELECT ccrefejofacm AS "Referencia" FROM ps_articulos LIMIT 10',
    },
  ],
};

// ---------------------------------------------------------------------------
// Valid spec tests
// ---------------------------------------------------------------------------

describe("validateSpec — valid inputs", () => {
  it("accepts the full ARCHITECTURE.md example spec", () => {
    const result = validateSpec(VALID_SPEC);
    expect(result.title).toBe(VALID_SPEC.title);
    expect(result.widgets).toHaveLength(4);
  });

  it("accepts a spec without description (optional)", () => {
    const spec = { ...VALID_SPEC, description: undefined };
    const result = validateSpec(spec);
    expect(result.description).toBeUndefined();
  });

  it("accepts every widget type", () => {
    const spec: DashboardSpec = {
      title: "All Types",
      widgets: [
        {
          type: "kpi_row",
          items: [{ label: "X", sql: "SELECT 1", format: "number" }],
        },
        {
          type: "bar_chart",
          title: "B",
          sql: "SELECT 1",
          x: "a",
          y: "b",
        },
        { type: "line_chart", title: "L", sql: "SELECT 1" },
        { type: "area_chart", title: "A", sql: "SELECT 1" },
        { type: "donut_chart", title: "D", sql: "SELECT 1" },
        { type: "table", title: "T", sql: "SELECT 1" },
        {
          type: "number",
          title: "N",
          sql: "SELECT 1",
          format: "percent",
        },
      ],
    };
    const result = validateSpec(spec);
    expect(result.widgets).toHaveLength(7);
  });

  it("accepts widgets with optional id", () => {
    const spec: DashboardSpec = {
      title: "IDs",
      widgets: [
        {
          id: "custom-id",
          type: "table",
          title: "T",
          sql: "SELECT 1",
        },
      ],
    };
    const result = validateSpec(spec);
    expect(result.widgets[0].id).toBe("custom-id");
  });

  it("accepts number widget with prefix", () => {
    const spec: DashboardSpec = {
      title: "Num",
      widgets: [
        {
          type: "number",
          title: "Revenue",
          sql: "SELECT 42",
          format: "currency",
          prefix: "€",
        },
      ],
    };
    const result = validateSpec(spec);
    const w = result.widgets[0];
    expect(w.type).toBe("number");
    if (w.type === "number") {
      expect(w.prefix).toBe("€");
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid spec tests
// ---------------------------------------------------------------------------

describe("validateSpec — invalid inputs", () => {
  it("rejects null", () => {
    expect(() => validateSpec(null)).toThrow(ZodError);
  });

  it("rejects a string", () => {
    expect(() => validateSpec("not a spec")).toThrow(ZodError);
  });

  it("rejects missing title", () => {
    const spec = { widgets: VALID_SPEC.widgets };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects empty title", () => {
    const spec = { ...VALID_SPEC, title: "" };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects missing widgets", () => {
    const spec = { title: "No widgets" };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects empty widgets array", () => {
    const spec = { title: "Empty", widgets: [] };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects unknown widget type", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "pie_chart", title: "P", sql: "SELECT 1" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects kpi_row with empty items array", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "kpi_row", items: [] }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects kpi item with missing sql", () => {
    const spec = {
      title: "Bad",
      widgets: [
        {
          type: "kpi_row",
          items: [{ label: "X", format: "number" }],
        },
      ],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects kpi item with invalid format", () => {
    const spec = {
      title: "Bad",
      widgets: [
        {
          type: "kpi_row",
          items: [{ label: "X", sql: "SELECT 1", format: "dollars" }],
        },
      ],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects bar_chart without x/y", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "bar_chart", title: "B", sql: "SELECT 1" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects number widget without format", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "number", title: "N", sql: "SELECT 1" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects table widget without sql", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "table", title: "T" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects empty string for optional id", () => {
    const spec = {
      title: "Bad",
      widgets: [{ id: "", type: "table", title: "T", sql: "SELECT 1" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects empty string for optional prefix", () => {
    const spec = {
      title: "Bad",
      widgets: [
        {
          type: "number",
          title: "N",
          sql: "SELECT 1",
          format: "currency",
          prefix: "",
        },
      ],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects unknown properties on widgets (strict mode)", () => {
    const spec = {
      title: "Bad",
      widgets: [
        {
          type: "table",
          title: "T",
          sql: "SELECT 1",
          extraField: "unexpected",
        },
      ],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects unknown properties on the dashboard spec (strict mode)", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "table", title: "T", sql: "SELECT 1" }],
      theme: "dark",
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// Schema-level tests
// ---------------------------------------------------------------------------

describe("DashboardSpecSchema", () => {
  it("safeParse returns success=false for invalid input", () => {
    const result = DashboardSpecSchema.safeParse({ title: 123 });
    expect(result.success).toBe(false);
  });

  it("safeParse returns success=true for valid input", () => {
    const result = DashboardSpecSchema.safeParse(VALID_SPEC);
    expect(result.success).toBe(true);
  });
});

describe("WidgetSchema", () => {
  it("parses a standalone bar_chart widget", () => {
    const w = {
      type: "bar_chart",
      title: "Test",
      sql: "SELECT 1",
      x: "a",
      y: "b",
    };
    const result = WidgetSchema.parse(w);
    expect(result.type).toBe("bar_chart");
  });
});

// ---------------------------------------------------------------------------
// comparison_sql field tests
// ---------------------------------------------------------------------------

describe("comparison_sql field", () => {
  it("accepts bar_chart with comparison_sql set", () => {
    const spec = {
      title: "Comparacion",
      widgets: [{
        type: "bar_chart",
        title: "Ventas vs Anio Anterior",
        sql: "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas GROUP BY tienda",
        x: "label",
        y: "value",
        comparison_sql: "SELECT tienda AS label, SUM(total_si) AS value FROM ps_ventas WHERE anio = 2025 GROUP BY tienda",
      }],
    };
    const result = validateSpec(spec);
    const w = result.widgets[0];
    expect(w.type).toBe("bar_chart");
    if (w.type === "bar_chart") {
      expect(w.comparison_sql).toBeDefined();
    }
  });

  it("accepts line_chart with comparison_sql set", () => {
    const spec = {
      title: "Tendencia",
      widgets: [{
        type: "line_chart",
        title: "Tendencia Semanal",
        sql: "SELECT DATE_TRUNC('week', fecha) AS x, SUM(total_si) AS y FROM ps_ventas GROUP BY 1",
        comparison_sql: "SELECT DATE_TRUNC('week', fecha) AS x, SUM(total_si) AS y FROM ps_ventas WHERE anio = 2025 GROUP BY 1",
      }],
    };
    const result = validateSpec(spec);
    expect(result.widgets).toHaveLength(1);
  });

  it("accepts area_chart with comparison_sql set", () => {
    const spec = {
      title: "Area",
      widgets: [{
        type: "area_chart",
        title: "Tendencia",
        sql: "SELECT fecha AS x, SUM(total_si) AS y FROM ps_ventas GROUP BY 1",
        comparison_sql: "SELECT fecha AS x, SUM(total_si) AS y FROM ps_ventas WHERE anio = 2025 GROUP BY 1",
      }],
    };
    const result = validateSpec(spec);
    const w = result.widgets[0];
    expect(w.type).toBe("area_chart");
    if (w.type === "area_chart") {
      expect(w.comparison_sql).toBeDefined();
    }
  });

  it("accepts donut_chart with comparison_sql set", () => {
    const spec = {
      title: "Donut",
      widgets: [{
        type: "donut_chart",
        title: "Mix",
        sql: "SELECT familia AS label, SUM(total_si) AS value FROM ps_ventas GROUP BY 1",
        comparison_sql: "SELECT familia AS label, SUM(total_si) AS value FROM ps_ventas WHERE anio = 2025 GROUP BY 1",
      }],
    };
    const result = validateSpec(spec);
    const w = result.widgets[0];
    expect(w.type).toBe("donut_chart");
    if (w.type === "donut_chart") {
      expect(w.comparison_sql).toBeDefined();
    }
  });

  it("rejects kpi_row with comparison_sql (strict mode)", () => {
    const spec = {
      title: "Bad",
      widgets: [{
        type: "kpi_row",
        items: [{ label: "X", sql: "SELECT 1", format: "number" }],
        comparison_sql: "SELECT 2",
      }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects table widget with comparison_sql (strict mode)", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "table", title: "T", sql: "SELECT 1", comparison_sql: "SELECT 2" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });

  it("rejects number widget with comparison_sql (strict mode)", () => {
    const spec = {
      title: "Bad",
      widgets: [{ type: "number", title: "N", sql: "SELECT 1", format: "number", comparison_sql: "SELECT 2" }],
    };
    expect(() => validateSpec(spec)).toThrow(ZodError);
  });
});
