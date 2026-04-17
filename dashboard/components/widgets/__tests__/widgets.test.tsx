// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "./setup";
import {
  KpiRow,
  BarChartWidget,
  LineChartWidget,
  AreaChartWidget,
  DonutChartWidget,
  TableWidget,
  NumberWidget,
} from "../index";
import type {
  KpiRowWidget,
  BarChartWidget as BarChartSpec,
  LineChartWidget as LineChartSpec,
  AreaChartWidget as AreaChartSpec,
  DonutChartWidget as DonutChartSpec,
  TableWidget as TableSpec,
  NumberWidget as NumberSpec,
} from "@/lib/schema";
import type { WidgetData } from "../types";
import type { ComparisonRange } from "@/components/DateRangePicker";

// ---------------------------------------------------------------------------
// KpiRow
// ---------------------------------------------------------------------------

describe("KpiRow", () => {
  const widget: KpiRowWidget = {
    type: "kpi_row",
    items: [
      { label: "Ventas", sql: "", format: "currency", prefix: "\u20ac" },
      { label: "Tickets", sql: "", format: "number" },
    ],
  };

  it("renders labels and formatted values", () => {
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1234.5]] },
      { columns: ["value"], rows: [[42]] },
    ];
    render(<KpiRow widget={widget} data={data} />);
    expect(screen.getByText("Ventas")).toBeInTheDocument();
    expect(screen.getByText("Tickets")).toBeInTheDocument();
    expect(screen.getByText("\u20ac1.234,50")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows dash when data is missing for an item", () => {
    const data: (WidgetData | null)[] = [null, null];
    render(<KpiRow widget={widget} data={data} />);
    const dashes = screen.getAllByText("\u2014");
    expect(dashes).toHaveLength(2);
  });

  it("shows positive trend badge when trend_sql is set and value is higher", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "currency", prefix: "\u20ac", trend_sql: "SELECT 900" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[800]] }, // 25% increase
    ];
    render(<KpiRow widget={widgetWithTrend} data={data} trendData={trendData} />);
    // Should show positive percentage
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
  });

  it("shows negative trend badge when value is lower than comparison", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "currency", prefix: "\u20ac", trend_sql: "SELECT 1200" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[900]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] }, // 10% decrease
    ];
    render(<KpiRow widget={widgetWithTrend} data={data} trendData={trendData} />);
    expect(screen.getByText("-10.0%")).toBeInTheDocument();
  });

  it("does not show trend badge when trend_sql is not set", () => {
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[800]] },
    ];
    render(<KpiRow widget={widget} data={data} trendData={trendData} />);
    // No percentage text should appear
    expect(screen.queryByText(/[+-]\d+\.\d+%/)).not.toBeInTheDocument();
  });

  it("does not show trend badge when comparison value is null", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT NULL" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [null];
    render(<KpiRow widget={widgetWithTrend} data={data} trendData={trendData} />);
    expect(screen.queryByText(/[+-]\d+\.\d+%/)).not.toBeInTheDocument();
  });

  it("does not show trend badge when comparison value is zero (division guard)", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT 0" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[0]] },
    ];
    render(<KpiRow widget={widgetWithTrend} data={data} trendData={trendData} />);
    expect(screen.queryByText(/[+-]\d+\.\d+%/)).not.toBeInTheDocument();
  });

  it("shows comparison period label in trend badge for previous_month", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "currency", prefix: "€", trend_sql: "SELECT 800" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[800]] },
    ];
    const comparisonRange: ComparisonRange = {
      type: "previous_month",
      from: new Date("2026-03-01"),
      to: new Date("2026-03-31"),
    };
    render(
      <KpiRow
        widget={widgetWithTrend}
        data={data}
        trendData={trendData}
        comparisonRange={comparisonRange}
      />
    );
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
    expect(screen.getByText("vs mes anterior")).toBeInTheDocument();
  });

  it("shows vs período anterior label for previous_period type", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT 500" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[600]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[500]] },
    ];
    const comparisonRange: ComparisonRange = {
      type: "previous_period",
      from: new Date("2026-03-01"),
      to: new Date("2026-03-15"),
    };
    render(
      <KpiRow
        widget={widgetWithTrend}
        data={data}
        trendData={trendData}
        comparisonRange={comparisonRange}
      />
    );
    expect(screen.getByText("vs período anterior")).toBeInTheDocument();
  });

  it("shows vs mismo período año anterior label for yoy type", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT 900" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[900]] },
    ];
    const comparisonRange: ComparisonRange = {
      type: "yoy",
      from: new Date("2025-04-01"),
      to: new Date("2025-04-17"),
    };
    render(
      <KpiRow
        widget={widgetWithTrend}
        data={data}
        trendData={trendData}
        comparisonRange={comparisonRange}
      />
    );
    expect(screen.getByText("vs mismo período año anterior")).toBeInTheDocument();
  });

  it("shows vs período personalizado label for custom type", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT 700" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[700]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[700]] },
    ];
    const comparisonRange: ComparisonRange = {
      type: "custom",
      from: new Date("2026-01-01"),
      to: new Date("2026-01-31"),
    };
    render(
      <KpiRow
        widget={widgetWithTrend}
        data={data}
        trendData={trendData}
        comparisonRange={comparisonRange}
      />
    );
    const badge = document.querySelector('[data-testid="trend-badge"]');
    expect(badge).toBeInTheDocument();
    expect(badge?.getAttribute("title")).toBe("vs período personalizado");
  });

  it("shows no period label when comparisonRange is undefined", () => {
    const widgetWithTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Ventas", sql: "", format: "number", trend_sql: "SELECT 800" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[1000]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[800]] },
    ];
    render(
      <KpiRow
        widget={widgetWithTrend}
        data={data}
        trendData={trendData}
      />
    );
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
    expect(screen.queryByText(/^vs /)).not.toBeInTheDocument();
  });

  it("renders trend badge correctly with static trend_sql (no tokens)", () => {
    const widgetWithStaticTrend: KpiRowWidget = {
      type: "kpi_row",
      items: [
        { label: "Tickets", sql: "", format: "number", trend_sql: "SELECT COUNT(*) FROM ps_ventas WHERE fecha_creacion BETWEEN '2026-03-01' AND '2026-03-31'" },
      ],
    };
    const data: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[150]] },
    ];
    const trendData: (WidgetData | null)[] = [
      { columns: ["value"], rows: [[120]] },
    ];
    render(
      <KpiRow
        widget={widgetWithStaticTrend}
        data={data}
        trendData={trendData}
      />
    );
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NumberWidget
// ---------------------------------------------------------------------------

describe("NumberWidget", () => {
  const widget: NumberSpec = {
    type: "number",
    title: "Total Ventas",
    sql: "",
    format: "currency",
    prefix: "\u20ac",
  };

  it("renders the formatted value", () => {
    const data: WidgetData = { columns: ["total"], rows: [[5000]] };
    render(<NumberWidget widget={widget} data={data} />);
    expect(screen.getByText("Total Ventas")).toBeInTheDocument();
    expect(screen.getByText("\u20ac5.000,00")).toBeInTheDocument();
  });

  it("shows empty message when no data", () => {
    render(<NumberWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BarChartWidget
// ---------------------------------------------------------------------------

describe("BarChartWidget", () => {
  const widget: BarChartSpec = {
    type: "bar_chart",
    title: "Ventas por Tienda",
    sql: "",
    x: "tienda",
    y: "ventas",
  };

  it("renders the title", () => {
    const data: WidgetData = {
      columns: ["tienda", "ventas"],
      rows: [["Madrid", 100]],
    };
    render(<BarChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Ventas por Tienda")).toBeInTheDocument();
  });

  it("shows empty message for null data", () => {
    render(<BarChartWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });

  it("shows empty message for empty rows", () => {
    const data: WidgetData = { columns: ["tienda", "ventas"], rows: [] };
    render(<BarChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });

  it("shows empty message when column names do not match", () => {
    const data: WidgetData = {
      columns: ["wrong_x", "wrong_y"],
      rows: [["A", 1]],
    };
    render(<BarChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LineChartWidget
// ---------------------------------------------------------------------------

describe("LineChartWidget", () => {
  const widget: LineChartSpec = {
    type: "line_chart",
    title: "Tendencia",
    sql: "",
    x: "semana",
    y: "ventas",
  };

  it("renders the title with data", () => {
    const data: WidgetData = {
      columns: ["semana", "ventas"],
      rows: [["S1", 100], ["S2", 200]],
    };
    render(<LineChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Tendencia")).toBeInTheDocument();
  });

  it("shows empty message for null data", () => {
    render(<LineChartWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AreaChartWidget
// ---------------------------------------------------------------------------

describe("AreaChartWidget", () => {
  const widget: AreaChartSpec = {
    type: "area_chart",
    title: "Ingresos",
    sql: "",
    x: "mes",
    y: "total",
  };

  it("renders the title with data", () => {
    const data: WidgetData = {
      columns: ["mes", "total"],
      rows: [["Ene", 50], ["Feb", 80]],
    };
    render(<AreaChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Ingresos")).toBeInTheDocument();
  });

  it("shows empty message for null data", () => {
    render(<AreaChartWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DonutChartWidget
// ---------------------------------------------------------------------------

describe("DonutChartWidget", () => {
  const widget: DonutChartSpec = {
    type: "donut_chart",
    title: "Mix Familias",
    sql: "",
    x: "familia",
    y: "pct",
  };

  it("renders the title with data", () => {
    const data: WidgetData = {
      columns: ["familia", "pct"],
      rows: [["A", 60], ["B", 40]],
    };
    render(<DonutChartWidget widget={widget} data={data} />);
    expect(screen.getByText("Mix Familias")).toBeInTheDocument();
  });

  it("shows empty message for null data", () => {
    render(<DonutChartWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TableWidget
// ---------------------------------------------------------------------------

describe("TableWidget", () => {
  const widget: TableSpec = {
    type: "table",
    title: "Top Articulos",
    sql: "",
  };

  it("renders column headers and rows", () => {
    const data: WidgetData = {
      columns: ["Ref", "Descripcion", "Unidades"],
      rows: [
        ["A1", "Camiseta", 10],
        ["A2", "Pantalon", 5],
      ],
    };
    render(<TableWidget widget={widget} data={data} />);
    expect(screen.getByText("Top Articulos")).toBeInTheDocument();
    expect(screen.getByText("Ref")).toBeInTheDocument();
    expect(screen.getByText("Descripcion")).toBeInTheDocument();
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    expect(screen.getByText("Pantalon")).toBeInTheDocument();
  });

  it("shows empty message for null data", () => {
    render(<TableWidget widget={widget} data={null} />);
    expect(screen.getByText("Sin datos")).toBeInTheDocument();
  });

  it("formats numeric cells with European style", () => {
    const data: WidgetData = {
      columns: ["Importe"],
      rows: [[12500]],
    };
    render(<TableWidget widget={widget} data={data} />);
    expect(screen.getByText("12.500")).toBeInTheDocument();
  });

  it("formats string numeric cells from PostgreSQL", () => {
    const data: WidgetData = {
      columns: ["Importe"],
      rows: [["12500.5"]],
    };
    render(<TableWidget widget={widget} data={data} />);
    expect(screen.getByText("12.500,5")).toBeInTheDocument();
  });

  it("shows dash for null cells", () => {
    const data: WidgetData = {
      columns: ["Valor"],
      rows: [[null]],
    };
    render(<TableWidget widget={widget} data={data} />);
    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });
});
