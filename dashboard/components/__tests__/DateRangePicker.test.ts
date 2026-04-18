import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeComparisonRange,
  CURRENT_PRESETS,
  PREVIOUS_PRESETS,
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

// Fixed test date: Wednesday 2026-04-15
const TEST_DATE = new Date(2026, 3, 15, 12, 0, 0, 0); // month is 0-indexed, April = 3

describe("CURRENT_PRESETS (fixed date: 2026-04-15, Wednesday)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Hoy: 2026-04-15 00:00 – 2026-04-15 23:59:59", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Hoy")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 15, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Semana actual: 2026-04-13 (Mon) – 2026-04-15 (today)", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Semana actual")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 13, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Mes Actual: 2026-04-01 – 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Mes Actual")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Trimestre Actual: Q2 starts 2026-04-01, ends today 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Trimestre Actual")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Año actual: 2026-01-01 – 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Año actual")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });
});

describe("PREVIOUS_PRESETS (fixed date: 2026-04-15, Wednesday)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Ayer: 2026-04-14 00:00 – 2026-04-14 23:59:59", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Ayer")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 14, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 14, 23, 59, 59, 999));
  });

  it("Semana Anterior: 2026-04-06 (Mon) – 2026-04-12 (Sun)", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Semana Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 6, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 12, 23, 59, 59, 999));
  });

  it("Mes Anterior: 2026-03-01 – 2026-03-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Mes Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 3, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("Trimestre Anterior: Q1 2026 = 2026-01-01 – 2026-03-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Trimestre Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("Año Anterior: 2025-01-01 – 2025-12-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Año Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2025, 1, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });
});

describe("CURRENT_PRESETS edge case: Sunday 2026-04-12", () => {
  const SUNDAY = new Date(2026, 3, 12, 10, 0, 0, 0); // Sunday

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Semana actual from Sunday: ISO Monday = 2026-04-06", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Semana actual")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2026, 4, 6, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 4, 12, 23, 59, 59, 999));
  });
});

describe("PREVIOUS_PRESETS edge case: January 2026-01-05 (Monday)", () => {
  const JAN_MON = new Date(2026, 0, 5, 10, 0, 0, 0); // Monday Jan 5

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(JAN_MON);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Mes Anterior from January: wraps to December 2025", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Mes Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2025, 12, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });

  it("Trimestre Anterior from Q1: wraps to Q4 of 2025", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Trimestre Anterior")!;
    const { from, to } = preset.range();
    expect(from).toEqual(d(2025, 10, 1, 0, 0, 0, 0));
    expect(to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });

  it("Semana Anterior from first week of Jan: wraps to Dec 2025", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Semana Anterior")!;
    const { from, to } = preset.range();
    // Jan 5 is Monday, so prev week Mon = Dec 29 2025, prev week Sun = Jan 4 2026
    expect(from).toEqual(d(2025, 12, 29, 0, 0, 0, 0));
    expect(to).toEqual(d(2026, 1, 4, 23, 59, 59, 999));
  });
});
