// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DashboardFiltersBar } from "../DashboardFiltersBar";
import type { DashboardSpec } from "@/lib/schema";

const baseSpec: DashboardSpec = {
  title: "T",
  widgets: [{ type: "number", title: "N", sql: "SELECT 1", format: "number" }],
  filters: [
    {
      id: "tienda",
      type: "single_select",
      label: "Tienda",
      bind_expr: `v."tienda"`,
      value_type: "text",
      options_sql: "SELECT 1",
    },
  ],
};

const numericSpec: DashboardSpec = {
  ...baseSpec,
  filters: [
    {
      id: "n",
      type: "single_select",
      label: "N",
      bind_expr: "t.x",
      value_type: "numeric",
      options_sql: "SELECT 1",
    },
  ],
};

describe("DashboardFiltersBar", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loads options and calls onChange when selection changes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ options: [{ value: "A", label: "Alfa" }] }),
    } as unknown as Response);

    const onChange = vi.fn();

    render(
      <DashboardFiltersBar
        dashboardId={1}
        spec={baseSpec}
        value={{}}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("global-filters-bar")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Tienda"), { target: { value: "A" } });

    expect(onChange).toHaveBeenCalledWith({ tienda: "A" });
  });

  it("shows numeric single_select selection and emits a number", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          options: [
            { value: "42", label: "42" },
            { value: "7", label: "7" },
          ],
        }),
    } as unknown as Response);

    const onChange = vi.fn();

    render(
      <DashboardFiltersBar
        dashboardId={1}
        spec={numericSpec}
        value={{ n: 42 }}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("global-filters-bar")).toBeInTheDocument();
    });

    const sel = screen.getByLabelText("N") as HTMLSelectElement;
    expect(sel.value).toBe("42");

    fireEvent.change(sel, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ n: 7 });
  });
});
