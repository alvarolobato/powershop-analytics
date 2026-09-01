// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ExportButton } from "../ExportButton";
import { TableWidget } from "../TableWidget";
import { aCsv } from "@/lib/csv";

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

describe("exporta TODO, no lo que se ve en pantalla", () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:falso");
    global.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  const widget = { type: "table" as const, title: "Detalle", sql: "SELECT 1" };
  const muchas = {
    columns: ["Referencia", "Unidades"],
    rows: Array.from({ length: 500 }, (_, i) => [`REF${i}`, i]),
  };

  /**
   * Hoy `TableWidget` no pagina: pinta todas las filas y el botón se lleva esas
   * mismas. Este test fija ese contrato — si alguien añade paginación y pasa al
   * botón sólo la página visible, el fichero saldría recortado SIN AVISAR, que
   * es el peor resultado posible: parece completo y no lo está.
   */
  it("con 500 filas, el botón anuncia las 500", () => {
    render(<TableWidget widget={widget} data={muchas} />);
    expect(screen.getByTestId("export-csv")).toHaveAttribute(
      "title",
      "Exportar 500 fila(s) a CSV",
    );
  });

  it("y el CSV lleva las 500, de la primera a la última", () => {
    const csv = aCsv(muchas.columns, muchas.rows);
    // cabecera + 500 filas
    expect(csv.split("\r\n")).toHaveLength(501);
    expect(csv).toContain("REF0;0");
    expect(csv).toContain("REF499;499");
  });

  it("el orden que se exporta es el que se ve, no el de la consulta", () => {
    const datosSinOrdenar = {
      columns: ["Proveedor", "Margen"],
      rows: [["B", 10], ["A", 30], ["C", 20]],
    };
    render(<TableWidget widget={widget} data={datosSinOrdenar} />);
    // Ordenar por la segunda columna cambia lo que se ve...
    fireEvent.click(screen.getAllByRole("columnheader")[1]);
    // ...y el botón sigue anunciando las 3 filas, no un subconjunto.
    expect(screen.getByTestId("export-csv")).toHaveAttribute(
      "title",
      "Exportar 3 fila(s) a CSV",
    );
  });
});
