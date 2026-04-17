import { describe, it, expect } from "vitest";
import {
  computeComparisonRange,
} from "../DateRangePicker";
import type { DateRange, ComparisonType } from "../DateRangePicker";

function d(year: number, month: number, day: number, h = 0, min = 0, sec = 0, ms = 0): Date {
  return new Date(year, month - 1, day, h, min, sec, ms);
}

const primary: DateRange = {
  from: d(2026, 3, 1),
  to: d(2026, 3, 31, 23, 59, 59, 999),
};

describe("computeComparisonRange", () => {
  it("returns null for none", () => {
    expect(computeComparisonRange(primary, "none")).toBeNull();
  });

  it("returns null for custom", () => {
    expect(computeComparisonRange(primary, "custom")).toBeNull();
  });

  it("previous_period: same duration immediately before primary", () => {
    const range: DateRange = {
      from: d(2026, 1, 11),
      to: d(2026, 1, 20, 23, 59, 59, 999),
    };
    const result = computeComparisonRange(range, "previous_period");
    expect(result).not.toBeNull();
    expect(result!.to).toEqual(new Date(range.from.getTime() - 1));
    const durationMs = range.to.getTime() - range.from.getTime();
    expect(result!.from).toEqual(new Date(result!.to.getTime() - durationMs));
  });

  it("previous_month: full calendar month before primary.from", () => {
    const result = computeComparisonRange(primary, "previous_month");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2026, 2, 1));
    expect(result!.to).toEqual(d(2026, 2, 28, 23, 59, 59, 999));
  });

  it("previous_month: wraps to December of previous year for January", () => {
    const janPrimary: DateRange = {
      from: d(2026, 1, 15),
      to: d(2026, 1, 31, 23, 59, 59, 999),
    };
    const result = computeComparisonRange(janPrimary, "previous_month");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2025, 12, 1));
    expect(result!.to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });

  it("previous_quarter: Q1 primary -> Q4 of previous year", () => {
    const result = computeComparisonRange(primary, "previous_quarter");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2025, 10, 1));
    expect(result!.to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });

  it("previous_quarter: Q3 primary -> Q2 same year", () => {
    const q3Primary: DateRange = {
      from: d(2026, 8, 1),
      to: d(2026, 8, 31, 23, 59, 59, 999),
    };
    const result = computeComparisonRange(q3Primary, "previous_quarter");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2026, 4, 1));
    expect(result!.to).toEqual(d(2026, 6, 30, 23, 59, 59, 999));
  });

  it("previous_year: full year Jan 1 - Dec 31 of year-1", () => {
    const result = computeComparisonRange(primary, "previous_year");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2025, 1, 1));
    expect(result!.to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });

  it("yoy: same date range shifted back one year", () => {
    const result = computeComparisonRange(primary, "yoy");
    expect(result).not.toBeNull();
    expect(result!.from).toEqual(d(2025, 3, 1));
    expect(result!.to).toEqual(d(2025, 3, 31, 23, 59, 59, 999));
  });
});
