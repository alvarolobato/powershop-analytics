// @vitest-environment jsdom
/**
 * No regresión visual de las fotos de artículo (D-068).
 *
 * Una tabla sin metadato de artículo y sin columnas que la heurística
 * reconozca debe pintarse EXACTAMENTE como antes de que existieran las fotos.
 * El snapshot de este fichero se generó con el `TableWidget` anterior a la
 * fase 3, así que si pasa es que el HTML no ha cambiado ni en un atributo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TableWidget } from "../TableWidget";
import type { TableWidget as TableSpec } from "@/lib/schema";
import type { WidgetData } from "../types";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const widget: TableSpec = { type: "table", title: "Ventas por tienda", sql: "SELECT 1" };

const CASOS: [string, WidgetData][] = [
  [
    "tienda + familia + números + margen",
    {
      columns: ["Tienda", "Familia", "Unidades", "Importe", "Margen %"],
      rows: [
        ["MADRID CENTRO", "CAMISAS", 120, 4310.5, 61.2],
        ["LISBOA", "PANTALONES", 80, 2990, 48.9],
        ["FUNCHAL", null, 0, "", 55],
      ],
    },
  ],
  [
    "ranking con descripción sola: la descripción no activa nada",
    {
      columns: ["#", "Descripción", "Temporada", "Uds"],
      rows: [
        [1, "CAMISA FLORES C/CINTURON", "V26", 31],
        [2, "PANTALON CHINO", "2024", 12],
      ],
    },
  ],
  [
    "un 'Código' que no es de artículo",
    {
      columns: ["Código", "Tienda", "Ventas"],
      rows: [
        ["104", "FUNCHAL", 1000],
        ["169", "LISBOA", 2000],
      ],
    },
  ],
];

describe("TableWidget sin artículos: nada cambia", () => {
  it.each(CASOS)("%s → mismo HTML que antes de las fotos", (_nombre, data) => {
    const { container } = render(<TableWidget widget={widget} data={data} onDataPointClick={() => {}} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it.each(CASOS)("%s → ni indicador, ni columna Foto, ni una petición", async (_nombre, data) => {
    const { container, queryByTestId, queryByText } = render(<TableWidget widget={widget} data={data} />);
    await Promise.resolve();
    expect(queryByTestId("article-photo-trigger")).toBeNull();
    expect(queryByTestId("article-photo-glyph")).toBeNull();
    expect(queryByText("Foto")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
