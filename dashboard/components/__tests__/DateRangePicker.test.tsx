// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DateRangePicker, presetToDateRange } from "../DateRangePicker";
import type { DateRange } from "../DateRangePicker";

const FIXED_NOW = new Date(2026, 2, 15, 12, 0, 0);

describe("presetToDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("today: full day 00:00:00 to 23:59:59", () => {
    const r = presetToDateRange("today");
    expect(r.from).toEqual(new Date(2026, 2, 15, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("last_7_days: 6 days ago to today", () => {
    const r = presetToDateRange("last_7_days");
    expect(r.from).toEqual(new Date(2026, 2, 9, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("last_30_days: 29 days ago to today", () => {
    const r = presetToDateRange("last_30_days");
    expect(r.from).toEqual(new Date(2026, 1, 14, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("current_month: first day of month to today", () => {
    const r = presetToDateRange("current_month");
    expect(r.from).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("last_month: full previous calendar month Feb 2026", () => {
    const r = presetToDateRange("last_month");
    expect(r.from).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });

  it("year_to_date: Jan 1 to today", () => {
    const r = presetToDateRange("year_to_date");
    expect(r.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("last_month in January returns December of prior year", () => {
    vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
    const r = presetToDateRange("last_month");
    expect(r.from).toEqual(new Date(2025, 11, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });

  it("year_to_date on Jan 1 returns single-day range", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    const r = presetToDateRange("year_to_date");
    expect(r.from.getFullYear()).toBe(2026);
    expect(r.from.getMonth()).toBe(0);
    expect(r.from.getDate()).toBe(1);
    expect(r.to.getFullYear()).toBe(2026);
    expect(r.to.getMonth()).toBe(0);
    expect(r.to.getDate()).toBe(1);
  });
});

describe("DateRangePicker", () => {
  const defaultRange: DateRange = { from: new Date(2026, 1, 1), to: new Date(2026, 1, 28) };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => { vi.useRealTimers(); });

  function openPicker(onChange = vi.fn()) {
    render(<DateRangePicker value={defaultRange} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /seleccionar rango/i }));
    return onChange;
  }

  it("shows exactly 6 preset labels in Spanish", () => {
    openPicker();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("Últimos 7 días")).toBeInTheDocument();
    expect(screen.getByText("Últimos 30 días")).toBeInTheDocument();
    expect(screen.getByText("Mes actual")).toBeInTheDocument();
    expect(screen.getByText("Mes anterior")).toBeInTheDocument();
    expect(screen.getByText("Año en curso")).toBeInTheDocument();
  });

  it("does not show Último trimestre", () => {
    openPicker();
    expect(screen.queryByText("Último trimestre")).not.toBeInTheDocument();
  });

  it("clicking Hoy calls onChange with today range", () => {
    const onChange = openPicker();
    fireEvent.click(screen.getByText("Hoy"));
    expect(onChange).toHaveBeenCalledOnce();
    const [r] = onChange.mock.calls[0];
    expect(r.from).toEqual(new Date(2026, 2, 15, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 2, 15, 23, 59, 59, 999));
  });

  it("clicking Mes anterior calls onChange with Feb 2026", () => {
    const onChange = openPicker();
    fireEvent.click(screen.getByText("Mes anterior"));
    expect(onChange).toHaveBeenCalledOnce();
    const [r] = onChange.mock.calls[0];
    expect(r.from).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });

  it("custom date range input still works", () => {
    const onChange = openPicker();
    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByText("Aplicar"));
    expect(onChange).toHaveBeenCalledOnce();
    const [r] = onChange.mock.calls[0];
    expect(r.from.getMonth()).toBe(0);
    expect(r.from.getDate()).toBe(1);
    expect(r.to.getDate()).toBe(31);
  });
});
