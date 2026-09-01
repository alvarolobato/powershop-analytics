// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExportButton } from "../ExportButton";
import { TableWidget } from "../TableWidget";

const datos = {
  columns: ["Proveedor", "Ventas Netas"],
  rows: [
    ["LUCAS FASHION", 53246.93],
    ["CHLOE&LUCAS S.L", 12000],
  ],
};

describe("ExportButton", () => {
  let creado: string | null = null;

  beforeEach(() => {
    creado = null;
    // jsdom no implementa createObjectURL.
    global.URL.createObjectURL = vi.fn(() => "blob:falso");
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      creado = this.download;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("no se pinta si no hay datos: un botón que baja un fichero vacío estorba", () => {
    const { container } = render(<ExportButton data={null} titulo="Ventas" />);
    expect(container.firstChild).toBeNull();
  });

  it("tampoco con cero filas", () => {
    const { container } = render(
      <ExportButton data={{ columns: ["a"], rows: [] }} titulo="Ventas" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("es discreto: atenuado hasta que se interactúa", () => {
    render(<ExportButton data={datos} titulo="Ventas" />);
    const boton = screen.getByTestId("export-csv");
    expect(Number(boton.style.opacity)).toBeLessThan(1);
  });

  it("dice cuántas filas se lleva, para que no haya sorpresas", () => {
    render(<ExportButton data={datos} titulo="Ventas" />);
    expect(screen.getByTestId("export-csv")).toHaveAttribute(
      "title",
      "Exportar 2 fila(s) a CSV",
    );
  });

  it("al pulsar descarga un fichero con nombre derivado del título", () => {
    render(<ExportButton data={datos} titulo="Rentabilidad por Proveedor" />);
    fireEvent.click(screen.getByTestId("export-csv"));
    expect(creado).toMatch(/^rentabilidad-por-proveedor-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("libera el blob: si no, se queda en memoria mientras viva la pestaña", () => {
    render(<ExportButton data={datos} titulo="Ventas" />);
    fireEvent.click(screen.getByTestId("export-csv"));
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:falso");
  });

  it("tiene nombre accesible", () => {
    render(<ExportButton data={datos} titulo="Ventas" />);
    expect(screen.getByLabelText("Exportar a CSV")).toBeInTheDocument();
  });
});

describe("la tabla trae el botón puesto", () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:falso");
    global.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  const widget = { type: "table" as const, title: "Detalle", sql: "SELECT 1" };

  it("aparece en la cabecera cuando hay filas", () => {
    render(<TableWidget widget={widget} data={datos} />);
    expect(screen.getByTestId("export-csv")).toBeInTheDocument();
  });

  it("no aparece si la tabla está vacía", () => {
    render(<TableWidget widget={widget} data={{ columns: ["a"], rows: [] }} />);
    expect(screen.queryByTestId("export-csv")).toBeNull();
  });
});
