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
