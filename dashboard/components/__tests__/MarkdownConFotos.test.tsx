// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MarkdownConFotos } from "../MarkdownConFotos";
import { __resetArticlePhotoTokensCache } from "@/lib/use-article-photo-tokens";

/** Respuesta de /api/articulos/fotos en modo tokens. */
function respuesta(porToken: Record<string, unknown[]>) {
  return {
    ok: true,
    json: async () => ({ porCodigo: {}, porRef: {}, porToken }),
  } as Response;
}

const UN_ARTICULO = [
  {
    codigo: "144750",
    referencia: "I26530116",
    descripcion: "BLUSA C/LAZO",
    color: "TURQUESA",
    slots: [1, 2],
  },
];

/** Un «modelo»: tres colores del mismo diseño, cada uno con su foto. */
const UN_MODELO = [
  { codigo: "144360", referencia: "I26300212", descripcion: "T-SHIRT", color: "MARINO", slots: [1] },
  { codigo: "144361", referencia: "I26300220", descripcion: "T-SHIRT", color: "BLANCO", slots: [1] },
  { codigo: "144357", referencia: "I26300299", descripcion: "T-SHIRT", color: "NEGRO", slots: [1, 2] },
];

const TABLA = [
  "| Modelo | Descripción |",
  "|---|---|",
  "| I263002 | T-SHIRT M/LARGA |",
].join("\n");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetArticlePhotoTokensCache();
  fetchMock = vi.fn().mockResolvedValue(respuesta({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MarkdownConFotos", () => {
  it("pinta el texto igual cuando ningún token es un artículo", async () => {
    render(<MarkdownConFotos>{TABLA}</MarkdownConFotos>);

    expect(screen.getByText("I263002")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Sin artículos no hay disparador de foto en ninguna celda.
    expect(document.querySelector("[data-testid='article-photo-trigger']")).toBeNull();
  });

  it("no pregunta por nada si el texto no tiene candidatos", () => {
    render(<MarkdownConFotos>{"Las ventas suben respecto al mes pasado."}</MarkdownConFotos>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pide los tokens en UNA sola petición por mensaje", async () => {
    const md = "Los más vendidos: I263002, V263428 y I262104.";
    render(<MarkdownConFotos>{md}</MarkdownConFotos>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tokens.sort()).toEqual(["I262104", "I263002", "V263428"]);
  });

  it("decora la celda cuyo token es un artículo con foto", async () => {
    fetchMock.mockResolvedValue(respuesta({ I263002: UN_ARTICULO }));
    render(<MarkdownConFotos>{TABLA}</MarkdownConFotos>);

    const trigger = await screen.findByTestId("article-photo-trigger");
    expect(trigger).toHaveTextContent("I263002");
    // La descripción de la fila no se toca: no identifica un artículo.
    expect(screen.getByText(/T-SHIRT M\/LARGA/)).toBeInTheDocument();
  });

  it("funciona también en prosa, no solo en tablas", async () => {
    fetchMock.mockResolvedValue(respuesta({ I263002: UN_ARTICULO }));
    render(<MarkdownConFotos>{"El más vendido es I263002 este mes."}</MarkdownConFotos>);

    const trigger = await screen.findByTestId("article-photo-trigger");
    expect(trigger).toHaveTextContent("I263002");
    // El texto de alrededor sigue entero.
    expect(screen.getByText(/El más vendido es/)).toBeInTheDocument();
    expect(screen.getByText(/este mes\./)).toBeInTheDocument();
  });

  it("no monta la imagen hasta que se pasa el ratón", async () => {
    fetchMock.mockResolvedValue(respuesta({ I263002: UN_ARTICULO }));
    render(<MarkdownConFotos>{TABLA}</MarkdownConFotos>);
    await screen.findByTestId("article-photo-trigger");

    expect(document.querySelector("img")).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));
    await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
  });

  it("un modelo abre el lightbox con las fotos de todos sus colores", async () => {
    fetchMock.mockResolvedValue(respuesta({ I263002: UN_MODELO }));
    render(<MarkdownConFotos>{TABLA}</MarkdownConFotos>);

    const trigger = await screen.findByTestId("article-photo-trigger");
    fireEvent.click(trigger);

    const contador = await screen.findByTestId("photo-lightbox-counter");
    // 1 + 1 + 2 slots = 4 fotos recorribles, no las 2 del primer artículo.
    expect(contador).toHaveTextContent("1/4");
    // Y cada una rotulada con su color, que es lo que las distingue.
    expect(contador).toHaveTextContent("MARINO");
  });

  it("no parte una Referencia en su modelo más dos dígitos", async () => {
    // "I26300201" contiene a "I263002" como prefijo: si el orden del regex
    // fuera el equivocado, la celda saldría troceada.
    fetchMock.mockResolvedValue(
      respuesta({ I263002: UN_ARTICULO, I26300201: UN_ARTICULO }),
    );
    render(<MarkdownConFotos>{"La referencia I26300201 del modelo I263002."}</MarkdownConFotos>);

    const triggers = await screen.findAllByTestId("article-photo-trigger");
    // El textContent lleva ademas el ", ver foto" que solo oyen los lectores
    // de pantalla; lo que se comprueba es que el token va entero y sin partir.
    expect(triggers.map((t) => t.textContent?.split(",")[0])).toEqual([
      "I26300201",
      "I263002",
    ]);
  });

  it("si la API falla, el texto se pinta igual y sin romper nada", async () => {
    fetchMock.mockRejectedValue(new Error("sin red"));
    render(<MarkdownConFotos>{TABLA}</MarkdownConFotos>);

    expect(await screen.findByText("I263002")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(document.querySelector("[data-testid='article-photo-trigger']")).toBeNull();
  });

  // --- canal explícito: [texto](articulo:ID) -------------------------------

  it("un enlace articulo: pone la foto sobre la DESCRIPCIÓN, que sola no identifica", async () => {
    fetchMock.mockResolvedValue(respuesta({ "144750": UN_ARTICULO }));
    render(
      <MarkdownConFotos>
        {"El más vendido es [PARKA REVERSIBLE](articulo:144750) este mes."}
      </MarkdownConFotos>,
    );

    const trigger = await screen.findByTestId("article-photo-trigger");
    expect(trigger).toHaveTextContent("PARKA REVERSIBLE");
    // Y no queda ningún enlace con un esquema que el navegador no entiende.
    expect(document.querySelector('a[href^="articulo:"]')).toBeNull();
  });

  it("pide el identificador del enlace aunque no tenga forma de token", async () => {
    render(<MarkdownConFotos>{"Ver [la parka](articulo:ART00001)."}</MarkdownConFotos>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tokens).toContain("ART00001");
  });

  it("un identificador inventado por el LLM no enseña nada ni deja enlace roto", async () => {
    // La BD no lo reconoce: lo que el modelo afirma no se cree a ciegas.
    fetchMock.mockResolvedValue(respuesta({}));
    render(<MarkdownConFotos>{"Mira la [BLUSA](articulo:NOEXISTE9)."}</MarkdownConFotos>);

    expect(await screen.findByText(/BLUSA/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(document.querySelector("[data-testid='article-photo-trigger']")).toBeNull();
    expect(document.querySelector('a[href^="articulo:"]')).toBeNull();
  });

  it("los enlaces normales siguen funcionando y respetan al renderer del consumidor", async () => {
    fetchMock.mockResolvedValue(respuesta({}));
    render(
      <MarkdownConFotos
        components={{
          a: ({ children: c, ...p }) => (
            <a data-testid="enlace-del-consumidor" {...p}>
              {c}
            </a>
          ),
        }}
      >
        {"Ver [la documentación](https://example.com)."}
      </MarkdownConFotos>,
    );

    const enlace = await screen.findByTestId("enlace-del-consumidor");
    expect(enlace).toHaveAttribute("href", "https://example.com");
  });
});
