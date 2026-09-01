// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TableWidget } from "../TableWidget";

/**
 * Cada celda numérica con barra de calor reserva 120 px de ancho mínimo. Con
 * pocas columnas ayuda a comparar de un vistazo; con muchas —una tabla pivotada
 * por tallas son 30 columnas, o sea 3.600 px— la tabla no cabe a lo ancho y las
 * barras dejan de informar: nadie compara treinta entre sí.
 *
 * El dueño lo pidió sobre su panel 24 y el modelo no podía hacerlo: el spec era
 * `{id, type, title, sql}` en modo `.strict()`, sin ninguna opción.
 */
function datos(nCols: number, filas = 3) {
  const columns = ["Referencia", ...Array.from({ length: nCols }, (_, i) => `C${i}`)];
  const rows = Array.from({ length: filas }, (_, r) => [
    `REF${r}`,
    ...Array.from({ length: nCols }, (_, c) => (c + r + 1) * 2),
  ]);
  return { columns, rows };
}

/** Las barras se pintan como un div absoluto dentro de la celda. */
function cuentaBarras(container: HTMLElement): number {
  return container.querySelectorAll('td div[style*="position: absolute"]').length;
}

const widget = { type: "table" as const, title: "T", sql: "SELECT 1" };

describe("barras de calor en las columnas numéricas", () => {
  it("con pocas columnas se pintan, que es donde ayudan", () => {
    const { container } = render(<TableWidget widget={widget} data={datos(3)} />);
    expect(cuentaBarras(container)).toBeGreaterThan(0);
  });

  it("con muchas columnas se desactivan solas", () => {
    const { container } = render(<TableWidget widget={widget} data={datos(30)} />);
    expect(cuentaBarras(container)).toBe(0);
  });

  // El borde exacto, que es donde vive cualquier off-by-one entre el código y
  // lo que se le cuenta al modelo en el prompt.
  it("con 8 columnas todavía se pintan", () => {
    const { container } = render(<TableWidget widget={widget} data={datos(8)} />);
    expect(cuentaBarras(container)).toBeGreaterThan(0);
  });

  it("con 9 ya no", () => {
    const { container } = render(<TableWidget widget={widget} data={datos(9)} />);
    expect(cuentaBarras(container)).toBe(0);
  });

  it("`heat: false` las quita aunque haya pocas columnas", () => {
    const { container } = render(
      <TableWidget widget={{ ...widget, heat: false }} data={datos(3)} />,
    );
    expect(cuentaBarras(container)).toBe(0);
  });

  it("`heat: true` las fuerza aunque haya muchas", () => {
    const { container } = render(
      <TableWidget widget={{ ...widget, heat: true }} data={datos(30)} />,
    );
    expect(cuentaBarras(container)).toBeGreaterThan(0);
  });

  it("sin barras los números siguen ahí y alineados a la derecha", () => {
    render(<TableWidget widget={{ ...widget, heat: false }} data={datos(3)} />);
    // el primer valor de la primera fila es (0+0+1)*2 = 2
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });
});
