// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OperationsRow } from "../OperationsRow";
import type { Metric } from "@/lib/home-types";

const RETAIL_METRICS: Metric[] = [
  { id: "ticket",  label: "Ticket medio",   value: 26.55,    format: "eur2", delta:  0.138 },
  { id: "tickets", label: "Tickets",        value: 5077,     format: "int",  delta: -0.287 },
  { id: "margen",  label: "Margen",         value: 0.612,    format: "pct",  delta:  null },
  { id: "devolu",  label: "Devoluciones",   value: 12522.50, format: "eur",  delta:  0.083, inverted: true },
  { id: "conver",  label: "Conversión",     value: 0.184,    format: "pct",  delta:  0.006 },
];

describe("OperationsRow (RETAIL)", () => {
  it("renders all 5 metric cells", () => {
    render(
      <OperationsRow
        sectionLabel="RETAIL"
        title="Operativa retail"
        subtitle="hoy · vs ayer mismo tramo"
        metrics={RETAIL_METRICS}
      />
    );
    expect(screen.getByTestId("metric-cell-ticket")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-tickets")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-margen")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-devolu")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-conver")).toBeInTheDocument();
  });

  it("renders section label RETAIL", () => {
    render(
      <OperationsRow
        sectionLabel="RETAIL"
        title="Operativa retail"
        subtitle="hoy · vs ayer mismo tramo"
        metrics={RETAIL_METRICS}
      />
    );
    expect(screen.getByText("RETAIL")).toBeInTheDocument();
  });

  it("renders subtitle", () => {
    render(
      <OperationsRow
        sectionLabel="RETAIL"
        title="Operativa retail"
        subtitle="hoy · vs ayer mismo tramo"
        metrics={RETAIL_METRICS}
      />
    );
    expect(screen.getByText("hoy · vs ayer mismo tramo")).toBeInTheDocument();
  });

  it("renders the Devoluciones delta with inverted logic (positive delta → down color)", () => {
    render(
      <OperationsRow
        sectionLabel="RETAIL"
        title="Operativa retail"
        subtitle="hoy · vs ayer mismo tramo"
        metrics={RETAIL_METRICS}
      />
    );
    const devoluCell = screen.getByTestId("metric-cell-devolu");
    // The Delta chip for inverted=true, value=0.083 (positive) should render with --down color
    const chipStyle = devoluCell.querySelector("[aria-label]")?.getAttribute("style") ?? "";
    expect(chipStyle).toContain("var(--down)");
  });

  it("renders — for a metric with delta: null instead of a percentage chip", () => {
    render(
      <OperationsRow
        sectionLabel="RETAIL"
        title="Operativa retail"
        subtitle="hoy · vs ayer"
        metrics={RETAIL_METRICS}
      />
    );
    // The "Margen" metric has delta: null — expect em dash, no % chip
    const margenCell = screen.getByTestId("metric-cell-margen");
    expect(margenCell).toHaveTextContent("—");
    // The em dash should not carry an aria-label (which the % chip adds)
    expect(margenCell.querySelector("[aria-label]")).toBeNull();
  });

  it("renders correct number of metrics for MAYORISTA", () => {
    const wholesale: Metric[] = [
      { id: "fact",  label: "Facturación",        value: 84200,   format: "eur", delta:  0.041 },
      { id: "pend",  label: "Pedidos pendientes", value: 47,      format: "int", delta:  0.064, sub: "€312k valor" },
      { id: "stock", label: "Valor stock",        value: 2228214, format: "eur", delta: -0.018 },
      { id: "rotac", label: "Rotación",           value: 4.2,     format: "x",   delta:  0.08,  suffix: "x/año" },
    ];
    render(
      <OperationsRow
        sectionLabel="MAYORISTA"
        title="Operativa mayorista"
        subtitle="mes en curso · vs mes anterior"
        metrics={wholesale}
      />
    );
    expect(screen.getByTestId("operations-row-mayorista")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-fact")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cell-rotac")).toBeInTheDocument();
    // Sub-text for pedidos pendientes
    expect(screen.getByText("€312k valor")).toBeInTheDocument();
  });
});
