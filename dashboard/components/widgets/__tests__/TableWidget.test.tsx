// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { TableWidget } from "../TableWidget";
import type { TableWidget as TableSpec } from "@/lib/schema";
import type { WidgetData } from "../types";

vi.mock("@tremor/react", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

describe("TableWidget drill-down", () => {
  it("invokes onDataPointClick with first column as label when a row is clicked", () => {
    const onDataPointClick = vi.fn();
    const widget: TableSpec = {
      type: "table",
      title: "Detalle por tienda",
      sql: "SELECT 1",
    };
    const data: WidgetData = {
      columns: ["Tienda", "Ventas"],
      rows: [
        ["Tienda 05", 100],
        ["Tienda 01", 200],
      ],
    };
    render(<TableWidget widget={widget} data={data} onDataPointClick={onDataPointClick} />);
    fireEvent.click(screen.getByText("Tienda 05"));
    expect(onDataPointClick).toHaveBeenCalledTimes(1);
    expect(onDataPointClick).toHaveBeenCalledWith({
      label: "Tienda 05",
      value: "",
      widgetTitle: "Detalle por tienda",
      widgetType: "table",
    });
  });
});

describe("TableWidget numeric column header alignment", () => {
  // Regression for closed PR #423 Copilot blocker: numeric column detection
  // used `colMaxValues[idx] > 0`, which silently mis-classified columns
  // whose values were ALL 0 or ALL negative as non-numeric (left-aligned).
  it("right-aligns numeric column headers even when every value is 0", () => {
    const widget: TableSpec = {
      type: "table",
      title: "Pedidos pendientes",
      sql: "SELECT 1",
    };
    const data: WidgetData = {
      columns: ["Tienda", "Pendientes"],
      rows: [
        ["Tienda 05", 0],
        ["Tienda 01", 0],
      ],
    };
    render(<TableWidget widget={widget} data={data} />);
    const header = screen.getByText("Pendientes").closest("th");
    expect(header).not.toBeNull();
    expect(header!).toHaveStyle({ textAlign: "right" });
  });

  it("right-aligns numeric column headers when every value is negative", () => {
    const widget: TableSpec = {
      type: "table",
      title: "Variación",
      sql: "SELECT 1",
    };
    const data: WidgetData = {
      columns: ["Tienda", "Δ"],
      rows: [
        ["Tienda 05", -10],
        ["Tienda 01", -5],
      ],
    };
    render(<TableWidget widget={widget} data={data} />);
    const header = screen.getByText("Δ").closest("th");
    expect(header).not.toBeNull();
    expect(header!).toHaveStyle({ textAlign: "right" });
  });

  it("left-aligns string column headers", () => {
    const widget: TableSpec = {
      type: "table",
      title: "Lista",
      sql: "SELECT 1",
    };
    const data: WidgetData = {
      columns: ["Tienda", "Ventas"],
      rows: [
        ["Tienda 05", 100],
        ["Tienda 01", 200],
      ],
    };
    render(<TableWidget widget={widget} data={data} />);
    const header = screen.getByText("Tienda").closest("th");
    expect(header).not.toBeNull();
    expect(header!).toHaveStyle({ textAlign: "left" });
  });
});
