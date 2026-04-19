import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeComparisonRange,
  getHoyRange,
  getSemanaActualRange,
  getMesActualRange,
  getTrimestreActualRange,
  getAnioActualRange,
  getAyerRange,
  getSemanaAnteriorRange,
  getMesAnteriorRange,
  getTrimestreAnteriorRange,
  getAnioAnteriorRange,
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

// ---------------------------------------------------------------------------
// Preset range functions — fixed date: Wednesday 2026-04-15
// ---------------------------------------------------------------------------

describe("preset range functions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 2026-04-15
    vi.setSystemTime(new Date(2026, 3, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getHoyRange: today 00:00 – 23:59:59.999", () => {
    const { from, to } = getHoyRange();
    expect(from).toEqual(d(2026, 4, 15, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("getSemanaActualRange: ISO Monday of week to end of today", () => {
    // April 15 is Wednesday; Monday of that week is April 13
    const { from, to } = getSemanaActualRange();
    expect(from).toEqual(d(2026, 4, 13, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("getMesActualRange: April 1 to end of today", () => {
    const { from, to } = getMesActualRange();
    expect(from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("getTrimestreActualRange: Q2 (Apr 1) to end of today", () => {
    // April is in Q2 (Apr-Jun), which starts April 1
    const { from, to } = getTrimestreActualRange();
    expect(from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("getAnioActualRange: Jan 1 to end of today", () => {
    const { from, to } = getAnioActualRange();
    expect(from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("getAyerRange: yesterday 00:00 – 23:59:59.999", () => {
    const { from, to } = getAyerRange();
    expect(from).toEqual(d(2026, 4, 14, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 14, 23, 59, 59, 999));
  });

  it("getSemanaAnteriorRange: full previous ISO week Mon–Sun", () => {
    // Current week Mon = Apr 13; previous week: Apr 6 (Mon) – Apr 12 (Sun)
    const { from, to } = getSemanaAnteriorRange();
    expect(from).toEqual(d(2026, 4, 6, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 12, 23, 59, 59, 999));
  });

  it("getMesAnteriorRange: full previous calendar month (March)", () => {
    const { from, to } = getMesAnteriorRange();
    expect(from).toEqual(d(2026, 3, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("getTrimestreAnteriorRange: full Q1 (Jan 1 – Mar 31)", () => {
    // Current quarter = Q2 (Apr); previous = Q1 (Jan-Mar)
    const { from, to } = getTrimestreAnteriorRange();
    expect(from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("getAnioAnteriorRange: full previous calendar year (2025)", () => {
    const { from, to } = getAnioAnteriorRange();
    expect(from).toEqual(d(2025, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });
});
