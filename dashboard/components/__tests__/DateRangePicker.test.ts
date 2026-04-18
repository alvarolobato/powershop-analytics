import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeComparisonRange,
  CURRENT_PRESETS,
  PREVIOUS_PRESETS,
  startOfDay,
  endOfDay,
  isoWeekMonday,
  currentQuarterStart,
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
// Preset helper unit tests
// ---------------------------------------------------------------------------

describe("isoWeekMonday", () => {
  it("Wednesday 2026-04-15 -> Monday 2026-04-13", () => {
    expect(isoWeekMonday(d(2026, 4, 15))).toEqual(d(2026, 4, 13));
  });

  it("Monday 2026-04-13 -> itself", () => {
    expect(isoWeekMonday(d(2026, 4, 13))).toEqual(d(2026, 4, 13));
  });

  it("Sunday 2026-04-19 -> Monday 2026-04-13", () => {
    expect(isoWeekMonday(d(2026, 4, 19))).toEqual(d(2026, 4, 13));
  });
});

describe("currentQuarterStart", () => {
  it("April is Q2, starts Apr 1", () => {
    expect(currentQuarterStart(d(2026, 4, 15))).toEqual(d(2026, 4, 1));
  });

  it("January is Q1, starts Jan 1", () => {
    expect(currentQuarterStart(d(2026, 1, 15))).toEqual(d(2026, 1, 1));
  });

  it("December is Q4, starts Oct 1", () => {
    expect(currentQuarterStart(d(2026, 12, 1))).toEqual(d(2026, 10, 1));
  });
});

// ---------------------------------------------------------------------------
// Preset range tests — fixed date: Wednesday 2026-04-15
// ---------------------------------------------------------------------------

// Fixed "now" = 2026-04-15 (Wednesday) at noon, to avoid DST edge cases
const FIXED_NOW = new Date(2026, 3, 15, 12, 0, 0, 0); // month is 0-indexed: 3 = April

describe("CURRENT_PRESETS (fixed date: 2026-04-15 Wednesday)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Hoy: 2026-04-15 00:00 – 23:59:59", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Hoy")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 15, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Semana actual: Mon 2026-04-13 – today 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Semana actual")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 13, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Mes actual: 2026-04-01 – 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Mes actual")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Trimestre actual: Q2 starts 2026-04-01 – 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Trimestre actual")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });

  it("Año actual: 2026-01-01 – 2026-04-15", () => {
    const preset = CURRENT_PRESETS.find((p) => p.label === "Año actual")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 15, 23, 59, 59, 999));
  });
});

describe("PREVIOUS_PRESETS (fixed date: 2026-04-15 Wednesday)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Ayer: 2026-04-14 00:00 – 23:59:59", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Ayer")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 14, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 14, 23, 59, 59, 999));
  });

  it("Semana anterior: Mon 2026-04-06 – Sun 2026-04-12", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Semana anterior")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 4, 6, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 4, 12, 23, 59, 59, 999));
  });

  it("Mes anterior: 2026-03-01 – 2026-03-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Mes anterior")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 3, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("Trimestre anterior: Q1 2026-01-01 – 2026-03-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Trimestre anterior")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2026, 1, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2026, 3, 31, 23, 59, 59, 999));
  });

  it("Año anterior: 2025-01-01 – 2025-12-31", () => {
    const preset = PREVIOUS_PRESETS.find((p) => p.label === "Año anterior")!;
    const range = preset.range();
    expect(range.from).toEqual(d(2025, 1, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(d(2025, 12, 31, 23, 59, 59, 999));
  });
});
