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
    const data = new Map<number, { value: string | number }>([
      [0, { value: 1234.5 }],
      [1, { value: 42 }],
    ]);
    render(<KpiRow widget={widget} data={data} />);
    expect(screen.getByText("Ventas")).toBeInTheDocument();
    expect(screen.getByText("Tickets")).toBeInTheDocument();
    expect(screen.getByText("\u20ac1.234,50")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows dash when data is missing for an item", () => {
    const data = new Map<number, { value: string | number }>();
    render(<KpiRow widget={widget} data={data} />);
    const dashes = screen.getAllByText("\u2014");
    expect(dashes).toHaveLength(2);
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
});
