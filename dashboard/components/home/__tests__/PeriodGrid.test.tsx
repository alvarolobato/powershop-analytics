// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PeriodGrid } from "../PeriodGrid";
import type { HomeViewModel } from "@/lib/home-types";

const PERIODS: HomeViewModel["periods"] = [
  {
    id: "hoy",
    label: "Hoy",
    value: 38420,
    deltaPrev: 0.082,
    prevLabel: "vs ayer",
    deltaYoY: -0.114,
    yoyLabel: "vs lun 5 may 2025",
    spark: [29200, 31100, 33800, 28900, 35510, 30200, 38420],
    sparkLabels: ["mar", "mié", "jue", "vie", "sáb", "dom", "hoy"],
  },
  {
    id: "semana",
    label: "Semana",
    value: 218400,
    deltaPrev: -0.043,
    prevLabel: "vs sem ant",
    deltaYoY: -0.092,
    yoyLabel: "vs sem 18 2025",
    spark: [195400, 210800, 228180, 232400, 205100, 218400],
    sparkLabels: ["s14", "s15", "s16", "s17", "s18", "s19"],
  },
  {
    id: "mes",
    label: "Mes",
    value: 134802,
    deltaPrev: -0.189,
    prevLabel: "vs abril",
    deltaYoY: -0.132,
    yoyLabel: "vs may 2025",
    spark: [142100, 148300, 159200, 166217, 134802],
    sparkLabels: ["ene", "feb", "mar", "abr", "may"],
  },
  {
    id: "anyo",
    label: "Año (YTD)",
    value: 1842600,
    deltaPrev: 0.034,
    prevLabel: "vs YTD 2025",
    deltaYoY: 0.034,
    yoyLabel: "vs 2025 mismo tramo",
    spark: [320100, 389200, 415300, 477200, 134802],
    sparkLabels: ["ene", "feb", "mar", "abr", "may"],
  },
];

describe("PeriodGrid", () => {
  it("renders all 4 period cards", () => {
    render(<PeriodGrid periods={PERIODS} />);
    expect(screen.getByTestId("period-card-hoy")).toBeInTheDocument();
    expect(screen.getByTestId("period-card-semana")).toBeInTheDocument();
    expect(screen.getByTestId("period-card-mes")).toBeInTheDocument();
    expect(screen.getByTestId("period-card-anyo")).toBeInTheDocument();
  });

  it("renders positive deltaPrev in Hoy card", () => {
    render(<PeriodGrid periods={PERIODS} />);
    const hoyCard = screen.getByTestId("period-card-hoy");
    expect(hoyCard.textContent).toContain("+8,2%");
  });

  it("renders negative deltaYoY in Hoy card", () => {
    render(<PeriodGrid periods={PERIODS} />);
    const hoyCard = screen.getByTestId("period-card-hoy");
    expect(hoyCard.textContent).toContain("-11,4%");
  });

  it("renders correct section title", () => {
    render(<PeriodGrid periods={PERIODS} />);
    expect(screen.getByRole("heading", { name: "Comparativa por periodo" })).toBeInTheDocument();
  });

  it("renders 'vs año pasado' label in each card", () => {
    render(<PeriodGrid periods={PERIODS} />);
    const labels = screen.getAllByText("vs año pasado");
    expect(labels).toHaveLength(4);
  });

  it("renders em-dash when deltaYoY is null", () => {
    const periodsWithMissingYoY: HomeViewModel["periods"] = [
      { ...PERIODS[0], deltaYoY: null },
    ];
    render(<PeriodGrid periods={periodsWithMissingYoY} />);
    expect(screen.getByTestId("period-card-hoy").textContent).toContain("—");
  });
});
