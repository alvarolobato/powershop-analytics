// @vitest-environment jsdom
/**
 * Fotos de artículo en TableWidget (D-068): qué celdas quedan envueltas, la
 * columna explícita de miniaturas y la convivencia con el drill-down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TableWidget } from "../TableWidget";
import type { TableWidget as TableSpec } from "@/lib/schema";
import type { WidgetData } from "../types";
import { __resetArticlePhotosCache } from "@/lib/use-article-photos";

/** 144750 tiene 3 fotos, 132374 una, 169 ninguna. V26212484 → 144750. */
const CON_FOTO: Record<string, number[]> = { "144750": [1, 2, 3], "132374": [1] };
const REF_A_CODIGO: Record<string, string> = { V26212484: "144750", V26000169: "169" };

const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const { codigos, refs } = JSON.parse(String(init.body)) as { codigos: string[]; refs: string[] };
  const porCodigo: Record<string, number[]> = {};
  for (const c of codigos) porCodigo[c] = CON_FOTO[c] ?? [];
  const porRef: Record<string, { codigo: string; slots: number[] }> = {};
  for (const r of refs) {
    const codigo = REF_A_CODIGO[r];
    if (codigo) porRef[r] = { codigo, slots: CON_FOTO[codigo] ?? [] };
  }
  return new Response(JSON.stringify({ porCodigo, porRef }), { status: 200 });
});

beforeEach(() => {
  __resetArticlePhotosCache();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const base: TableSpec = { type: "table", title: "Top artículos", sql: "SELECT 1" };

const articulos: WidgetData = {
  columns: ["codigo", "Referencia", "Descripción", "Unidades"],
  rows: [
    ["144750", "V26212484", "CAMISA FLORES C/CINTURON", 31],
    ["132374", "V26112233", "PANTALON CHINO", 12],
    ["169", "V26000169", "CAMISA FLORES C/CINTURON", 5],
  ],
};

const fila = (texto: string) => screen.getByText(texto).closest("tr")!;
const disparadores = (tr: HTMLElement) => within(tr).queryAllByTestId("article-photo-trigger");

async function cargado() {
  await waitFor(() => expect(screen.queryAllByTestId("article-photo-trigger").length).toBeGreaterThan(0));
}

describe("TableWidget — hover de fotos", () => {
  it("con articulo_codigo_col, código, referencia y descripción de la fila quedan envueltos", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();

    const tr = fila("V26212484");
    expect(disparadores(tr)).toHaveLength(3);
    // Envuelve, no sustituye: la referencia conserva su estilo de siempre.
    const ref = screen.getByText("V26212484");
    expect(ref).toHaveStyle({ color: "var(--accent)" });
    expect(ref.closest('[data-testid="article-photo-trigger"]')).not.toBeNull();
    // La celda numérica no se toca.
    expect(within(tr).getByText("31").closest('[data-testid="article-photo-trigger"]')).toBeNull();
  });

  it("una sola petición por widget, solo con códigos (las refs no hacen falta si hay código)", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.codigos.sort()).toEqual(["132374", "144750", "169"]);
    expect(body.refs).toEqual([]);
  });

  it("el artículo sin foto no lleva indicador ni dispara una sola petición de imagen", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();

    const tr = fila("V26000169");
    expect(disparadores(tr)).toHaveLength(0);
    expect(within(tr).queryByTestId("article-photo-glyph")).toBeNull();
    // Y en toda la tabla, sin hover, no hay ninguna <img>.
    expect(document.querySelector("img")).toBeNull();
  });

  it("la descripción se resuelve por el código de SU fila, nunca por el texto", async () => {
    // Dos artículos con la misma descripción: uno con foto, otro sin.
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();

    const celdaDesc = (ref: string) => fila(ref).querySelectorAll("td")[2];
    const conFoto = celdaDesc("V26212484");
    const sinFoto = celdaDesc("V26000169");
    // Mismo texto en las dos filas…
    expect(conFoto.textContent).toContain("Camisa Flores");
    expect(sinFoto.textContent).toBe(conFoto.textContent!.replace(", ver foto", ""));
    // …y solo la del artículo que tiene foto lleva hover.
    expect(within(conFoto).queryByTestId("article-photo-trigger")).not.toBeNull();
    expect(within(sinFoto).queryByTestId("article-photo-trigger")).toBeNull();
  });

  it("solo referencia: se traduce a código y la foto es la de ese código", async () => {
    const data: WidgetData = {
      columns: ["Referencia", "Descripción", "Importe"],
      rows: [
        ["V26212484", "CAMISA FLORES", 100],
        ["V26000169", "CAMISA SIN FOTO", 50],
        ["NOEXISTE", "FANTASMA", 1],
      ],
    };
    render(<TableWidget widget={base} data={data} />);
    await cargado();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ codigos: [], refs: ["NOEXISTE", "V26000169", "V26212484"] });
    expect(disparadores(fila("V26212484"))).toHaveLength(2);
    expect(disparadores(fila("V26000169"))).toHaveLength(0);
    expect(disparadores(fila("NOEXISTE"))).toHaveLength(0);

    fireEvent.click(screen.getByText("V26212484"));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      "/api/fotos/144750/1?w=1024",
    );
  });

  it("articulo_ref_col señala una referencia con nombre que la heurística no conoce", async () => {
    const data: WidgetData = { columns: ["SKU", "Uds"], rows: [["V26212484", 3]] };
    render(<TableWidget widget={{ ...base, articulo_ref_col: "SKU" }} data={data} />);
    await cargado();
    expect(disparadores(fila("V26212484"))).toHaveLength(1);
  });

  it("heurística: una tabla antigua con 'codigo' + 'Referencia' tiene hover por la referencia", async () => {
    render(<TableWidget widget={base} data={articulos} />);
    await cargado();
    // Referencia y descripción; el 'codigo' a secas no se toca (podría ser de otra cosa).
    expect(disparadores(fila("V26212484"))).toHaveLength(2);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.codigos).toEqual([]);
    expect(body.refs.sort()).toEqual(["V26000169", "V26112233", "V26212484"]);
  });

  it("un 'Código' de tienda igual al código de un artículo con foto NO enseña esa foto", async () => {
    // La tienda 144750 no es el artículo 144750.
    const data: WidgetData = {
      columns: ["Código", "Tienda", "Referencia", "Uds"],
      rows: [["144750", "LISBOA", "V26000169", 3]],
    };
    // La referencia SÍ tiene foto en este caso: así "0 disparadores en la celda
    // del código" no puede ser simplemente que la respuesta aún no ha llegado.
    data.rows[0][2] = "V26212484";
    render(<TableWidget widget={base} data={data} />);
    await cargado();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).codigos).toEqual([]);
    const celdas = fila("V26212484").querySelectorAll("td");
    // El hover está en la referencia (foto del artículo de ESA referencia)…
    expect(within(celdas[2] as HTMLElement).queryByTestId("article-photo-trigger")).not.toBeNull();
    // …y el código de tienda queda intacto.
    expect(within(celdas[0] as HTMLElement).queryByTestId("article-photo-trigger")).toBeNull();
    fireEvent.click(screen.getByText("V26212484"));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute("src", "/api/fotos/144750/1?w=1024");
  });

  it("con articulo_codigo_col el código se pinta como identificador, no como número ni ranking", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();
    // Ni "144.750" (separador de miles) ni una barra de calor.
    expect(screen.getByText("144750")).toBeInTheDocument();
    expect(screen.queryByText("144.750")).toBeNull();
    // "169" es < 1000 y va en la primera columna: sin el spec sería un ranking.
    expect(screen.getByText("169")).toBeInTheDocument();
    const th = screen.getByRole("columnheader", { name: /codigo/ });
    expect(th).toHaveStyle({ textAlign: "left" });
  });

  it("el click en la celda abre el lightbox y NO dispara el drill-down de la fila", async () => {
    const onDataPointClick = vi.fn();
    render(
      <TableWidget
        widget={{ ...base, articulo_codigo_col: "codigo" }}
        data={articulos}
        onDataPointClick={onDataPointClick}
      />,
    );
    await cargado();

    fireEvent.click(screen.getByText("V26212484"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("V26212484");
    expect(dialog).toHaveTextContent("CAMISA FLORES C/CINTURON");
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("1/3");
    expect(onDataPointClick).not.toHaveBeenCalled();

    // Cerrar tampoco lo dispara…
    fireEvent.click(screen.getByTestId("photo-lightbox-backdrop"));
    expect(onDataPointClick).not.toHaveBeenCalled();

    // …pero el resto de la fila sigue siendo drill-down.
    fireEvent.click(within(fila("V26212484")).getByText("31"));
    expect(onDataPointClick).toHaveBeenCalledTimes(1);
  });

  it("al reordenar, cada fila conserva su foto", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();
    fireEvent.click(screen.getByRole("button", { name: /Unidades/ }));
    expect(disparadores(fila("V26212484"))).toHaveLength(3);
    expect(disparadores(fila("V26000169"))).toHaveLength(0);
  });

  it("reordenar después de un hover no arrastra el estado al artículo que ocupa esa fila", async () => {
    // Las filas van por índice. Sin clave por artículo, la instancia de la
    // fila 1 (ya con la <img> montada) pasaría a ser la de OTRO artículo y
    // descargaría su foto sin que nadie pasara el ratón.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dos: WidgetData = { columns: articulos.columns, rows: articulos.rows.slice(0, 2) };
      render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={dos} />);
      await cargado();

      // Orden inicial: 144750 arriba. Hover sobre su referencia.
      fireEvent.mouseEnter(screen.getByText("V26212484").closest('[data-testid="article-photo-trigger"]')!);
      await vi.advanceTimersByTimeAsync(300);
      expect(document.querySelectorAll("img")).toHaveLength(1);
      expect(document.querySelector("img")).toHaveAttribute("src", "/api/fotos/144750/1?w=256");

      // Por unidades ascendente, la fila de arriba pasa a ser 132374, que
      // también tiene foto.
      fireEvent.click(screen.getByRole("button", { name: /Unidades/ }));
      expect(screen.getAllByRole("row")[1]).toHaveTextContent("132374");

      const srcs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"));
      // Ninguna foto del 132374, que nadie ha mirado.
      expect(srcs.filter((s) => s?.includes("/132374/"))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("una sola parada de Tab por fila, no una por celda", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();

    const enFila = disparadores(fila("V26212484"));
    expect(enFila).toHaveLength(3);
    expect(enFila.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    // La enfocable es la primera celda del artículo (el código).
    expect(enFila[0]).toHaveAttribute("tabindex", "0");
    // En toda la tabla: 2 artículos con foto → 2 paradas.
    expect(
      screen.getAllByTestId("article-photo-trigger").filter((t) => t.getAttribute("tabindex") === "0"),
    ).toHaveLength(2);
  });

  it("la parada de Tab cae en la primera celda que de verdad lleva hover", async () => {
    // Referencia numérica < 1000 en la primera columna: se pinta como ranking
    // y no se envuelve. La parada tiene que ir a la descripción, no perderse.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ porCodigo: {}, porRef: { "777": { codigo: "144750", slots: [1] } } }), {
          status: 200,
        }),
      ),
    );
    const data: WidgetData = { columns: ["Ref", "Descripción", "Uds"], rows: [[777, "CAMISA", 3]] };
    render(<TableWidget widget={base} data={data} />);
    await cargado();
    const todos = screen.getAllByTestId("article-photo-trigger");
    expect(todos).toHaveLength(1);
    expect(todos[0]).toHaveAttribute("tabindex", "0");
    expect(todos[0]).toHaveTextContent("Camisa");
  });

  it("con mostrar_fotos la parada de Tab es la miniatura", async () => {
    render(
      <TableWidget widget={{ ...base, articulo_codigo_col: "codigo", mostrar_fotos: true }} data={articulos} />,
    );
    await cargado();
    const enFila = disparadores(fila("V26212484"));
    expect(enFila).toHaveLength(4);
    expect(enFila.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("si el endpoint falla la tabla se pinta igual, sin fotos y sin error", async () => {
    const roto = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", roto);
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await waitFor(() => expect(roto).toHaveBeenCalled());
    // Que el rechazo recorra todo el camino del hook antes de mirar.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("V26212484")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.queryAllByTestId("article-photo-trigger")).toHaveLength(0);
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});

describe("TableWidget — mostrar_fotos", () => {
  it("por defecto NO hay columna de fotos", async () => {
    render(<TableWidget widget={{ ...base, articulo_codigo_col: "codigo" }} data={articulos} />);
    await cargado();
    expect(screen.queryByRole("columnheader", { name: "Foto" })).toBeNull();
    expect(screen.queryAllByTestId("article-photo-cell")).toHaveLength(0);
  });

  it("mostrar_fotos: true antepone una columna con miniatura de 40 px a w=160", async () => {
    render(
      <TableWidget
        widget={{ ...base, articulo_codigo_col: "codigo", mostrar_fotos: true }}
        data={articulos}
      />,
    );
    await cargado();

    const cabeceras = screen.getAllByRole("columnheader");
    expect(cabeceras[0]).toHaveTextContent("Foto");
    expect(cabeceras).toHaveLength(5);
    expect(screen.getAllByTestId("article-photo-cell")).toHaveLength(3);

    const mini = within(fila("V26212484")).getByRole("img");
    expect(mini).toHaveAttribute("src", "/api/fotos/144750/1?w=160");
    expect(mini).toHaveAttribute("width", "40");
    expect(mini).toHaveAttribute("loading", "lazy");
    // La fila sin foto deja la celda vacía: ninguna petición de imagen.
    const celdaVacia = within(fila("V26000169")).getByTestId("article-photo-cell");
    expect(celdaVacia).toBeEmptyDOMElement();
    expect(document.querySelectorAll("img")).toHaveLength(2);
  });

  it("la miniatura abre el lightbox sin disparar el drill-down", async () => {
    const onDataPointClick = vi.fn();
    render(
      <TableWidget
        widget={{ ...base, articulo_codigo_col: "codigo", mostrar_fotos: true }}
        data={articulos}
        onDataPointClick={onDataPointClick}
      />,
    );
    await cargado();
    fireEvent.click(within(fila("V26212484")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDataPointClick).not.toHaveBeenCalled();
  });

  it("ordenar por una columna sigue funcionando con la columna Foto delante", async () => {
    render(
      <TableWidget
        widget={{ ...base, articulo_codigo_col: "codigo", mostrar_fotos: true }}
        data={articulos}
      />,
    );
    await cargado();
    fireEvent.click(screen.getByRole("button", { name: /Unidades/ }));
    const filas = screen.getAllByRole("row").slice(1);
    expect(within(filas[0]).getByText("V26000169")).toBeInTheDocument();
    expect(within(filas[2]).getByText("V26212484")).toBeInTheDocument();
  });

  it("mostrar_fotos sin columnas de artículo: la columna existe pero vacía, sin romper nada", async () => {
    const data: WidgetData = { columns: ["Tienda", "Ventas"], rows: [["LISBOA", 10]] };
    render(<TableWidget widget={{ ...base, mostrar_fotos: true }} data={data} />);
    await Promise.resolve();
    expect(screen.getByRole("columnheader", { name: "Foto" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
