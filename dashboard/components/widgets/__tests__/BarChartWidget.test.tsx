// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { BarChartWidget } from "../BarChartWidget";
import type { BarChartWidget as BarChartSpec } from "@/lib/schema";
import type { WidgetData } from "../types";

vi.mock("@tremor/react", () => ({
  Card: ({
    children,
    className,
    title,
    ...rest
  }: {
    children: ReactNode;
    className?: string;
    title?: string;
  }) => (
    <div className={className} title={title} {...rest}>
      {children}
    </div>
  ),
  BarChart: ({
    onValueChange,
    index,
  }: {
    onValueChange?: (v: Record<string, unknown>) => void;
    index: string;
  }) => (
    <button
      type="button"
      data-testid="mock-bar"
      onClick={() =>
        onValueChange?.({
          eventType: "bar",
          categoryClicked: "Ventas",
          [index]: "Tienda 05",
          Ventas: 1234,
        })
      }
    >
      bar
    </button>
  ),
}));

describe("BarChartWidget drill-down", () => {
  it("invokes onDataPointClick when Tremor onValueChange fires", () => {
    const onDataPointClick = vi.fn();
    const widget: BarChartSpec = {
      type: "bar_chart",
      title: "Ventas por tienda",
      sql: "SELECT 1",
      x: "tienda",
      y: "Ventas",
    };
    const data: WidgetData = {
      columns: ["tienda", "Ventas"],
      rows: [
        ["Tienda 05", 1234],
        ["Tienda 01", 500],
      ],
    };
    render(<BarChartWidget widget={widget} data={data} onDataPointClick={onDataPointClick} />);
    fireEvent.click(screen.getAllByTestId("mock-bar")[0]);
    expect(onDataPointClick).toHaveBeenCalledTimes(1);
    expect(onDataPointClick).toHaveBeenCalledWith({
      label: "Tienda 05",
      value: "1234",
      widgetTitle: "Ventas por tienda",
      widgetType: "bar_chart",
    });
  });
});
