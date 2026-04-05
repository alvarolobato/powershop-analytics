// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "../widgets/__tests__/setup";
import { DashboardRenderer } from "../DashboardRenderer";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSuccess(data: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const barSpec: DashboardSpec = {
  title: "Panel de Ventas",
  description: "Resumen mensual de ventas",
  widgets: [
    {
      id: "w1",
      type: "bar_chart",
      title: "Ventas por Tienda",
      sql: "SELECT tienda, total FROM ps_ventas",
      x: "tienda",
      y: "total",
    },
  ],
};

const kpiSpec: DashboardSpec = {
  title: "KPIs",
  widgets: [
    {
      type: "kpi_row",
      items: [
        {
          label: "Ventas Netas",
          sql: "SELECT SUM(total_si) FROM ps_ventas",
          format: "currency",
          prefix: "\u20ac",
        },
        {
          label: "Tickets",
          sql: "SELECT COUNT(*) FROM ps_ventas",
          format: "number",
        },
      ],
    },
  ],
};

const multiWidgetSpec: DashboardSpec = {
  title: "Dashboard Completo",
  description: "Todos los tipos",
  widgets: [
    {
      type: "kpi_row",
      items: [
        {
          label: "Total",
          sql: "SELECT 1",
          format: "number",
        },
      ],
    },
    {
      type: "bar_chart",
      title: "Barras",
      sql: "SELECT x, y FROM t",
      x: "x",
      y: "y",
    },
    {
      type: "line_chart",
      title: "Lineas",
      sql: "SELECT x, y FROM t",
      x: "x",
      y: "y",
    },
    {
      type: "area_chart",
      title: "Area",
      sql: "SELECT x, y FROM t",
      x: "x",
      y: "y",
    },
    {
      type: "donut_chart",
      title: "Donut",
      sql: "SELECT x, y FROM t",
      x: "x",
      y: "y",
    },
    {
      type: "table",
      title: "Tabla",
      sql: "SELECT a FROM t",
    },
    {
      type: "number",
      title: "Numero",
      sql: "SELECT 42",
      format: "number",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DashboardRenderer", () => {
  it("renders title and description", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess({
      columns: ["tienda", "total"],
      rows: [["Madrid", 100]],
    }));

    render(<DashboardRenderer spec={barSpec} />);

    expect(screen.getByText("Panel de Ventas")).toBeInTheDocument();
    expect(
      screen.getByText("Resumen mensual de ventas")
    ).toBeInTheDocument();
  });

  it("renders title without description when omitted", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess({
      columns: ["value"],
      rows: [[42]],
    }));

    render(<DashboardRenderer spec={kpiSpec} />);

    expect(screen.getByText("KPIs")).toBeInTheDocument();
  });

  it("shows loading skeleton initially", () => {
    // Make fetch hang indefinitely so we stay in loading state
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<DashboardRenderer spec={barSpec} />);

    expect(screen.getByTestId("widget-skeleton")).toBeInTheDocument();
  });

  it("renders correct widget component for bar_chart", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess({
      columns: ["tienda", "total"],
      rows: [["Madrid", 100]],
    }));

    render(<DashboardRenderer spec={barSpec} />);

    await waitFor(() => {
      expect(screen.getByText("Ventas por Tienda")).toBeInTheDocument();
    });
  });

  it("renders kpi_row with parallel fetches per item", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            columns: ["value"],
            rows: [[callCount === 1 ? 5000 : 123]],
          }),
      } as unknown as Response);
    }));

    render(<DashboardRenderer spec={kpiSpec} />);

    await waitFor(() => {
      expect(screen.getByText("Ventas Netas")).toBeInTheDocument();
      expect(screen.getByText("Tickets")).toBeInTheDocument();
    });

    // Should have called fetch for each KPI item
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shows error message on query failure without breaking other widgets", async () => {
    // First call fails, second succeeds
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Query timeout" }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            columns: ["x", "y"],
            rows: [["A", 1]],
          }),
      } as unknown as Response);
    }));

    const twoWidgetSpec: DashboardSpec = {
      title: "Mixed",
      widgets: [
        {
          type: "number",
          title: "Broken",
          sql: "SELECT fail",
          format: "number",
        },
        {
          type: "bar_chart",
          title: "Working",
          sql: "SELECT x, y FROM t",
          x: "x",
          y: "y",
        },
      ],
    };

    render(<DashboardRenderer spec={twoWidgetSpec} />);

    await waitFor(() => {
      // Error widget shows error message via ErrorDisplay
      expect(screen.getByText("Query timeout")).toBeInTheDocument();
      // Working widget still renders
      expect(screen.getByText("Working")).toBeInTheDocument();
    });
  });

  it("handles empty widgets array", () => {
    const emptySpec: DashboardSpec = {
      title: "Vacio",
      widgets: [
        {
          type: "number",
          title: "placeholder",
          sql: "SELECT 1",
          format: "number",
        },
      ],
    };
    // Override to truly empty - bypass zod min(1) for test purposes
    const hackedSpec = { ...emptySpec, widgets: [] } as unknown as DashboardSpec;

    // Should not call fetch at all
    vi.stubGlobal("fetch", vi.fn());

    render(<DashboardRenderer spec={hackedSpec} />);

    expect(screen.getByText("Vacio")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("widget-skeleton")).not.toBeInTheDocument();
  });

  it("renders all widget types correctly", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess({
      columns: ["x", "y"],
      rows: [["A", 42]],
    }));

    render(<DashboardRenderer spec={multiWidgetSpec} />);

    await waitFor(() => {
      expect(screen.getByText("Barras")).toBeInTheDocument();
      expect(screen.getByText("Lineas")).toBeInTheDocument();
      expect(screen.getByText("Area")).toBeInTheDocument();
      expect(screen.getByText("Donut")).toBeInTheDocument();
      expect(screen.getByText("Tabla")).toBeInTheDocument();
      expect(screen.getByText("Numero")).toBeInTheDocument();
    });
  });

  it("refetches when refreshKey changes", async () => {
    const fetchMock = mockFetchSuccess({
      columns: ["tienda", "total"],
      rows: [["Madrid", 100]],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <DashboardRenderer spec={barSpec} refreshKey={0} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ventas por Tienda")).toBeInTheDocument();
    });

    const callsAfterFirst = fetchMock.mock.calls.length;

    // Increment refreshKey without changing spec
    rerender(<DashboardRenderer spec={barSpec} refreshKey={1} />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  it("refetches when spec changes", async () => {
    const fetchMock = mockFetchSuccess({
      columns: ["tienda", "total"],
      rows: [["Madrid", 100]],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<DashboardRenderer spec={barSpec} />);

    await waitFor(() => {
      expect(screen.getByText("Ventas por Tienda")).toBeInTheDocument();
    });

    // Record call count after first spec's fetches
    const callsAfterFirst = fetchMock.mock.calls.length;

    const newSpec: DashboardSpec = {
      title: "Nuevo Panel",
      widgets: [
        {
          type: "number",
          title: "Nuevo Numero",
          sql: "SELECT 99",
          format: "number",
        },
      ],
    };

    rerender(<DashboardRenderer spec={newSpec} />);

    await waitFor(() => {
      expect(screen.getByText("Nuevo Panel")).toBeInTheDocument();
      expect(screen.getByText("Nuevo Numero")).toBeInTheDocument();
    });

    // Verify additional fetch calls were made for the new spec
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    // The last call should contain the new widget's SQL
    const lastCallBody = JSON.parse(
      fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body
    );
    expect(lastCallBody.sql).toBe("SELECT 99");
  });
});
