// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ArticlePhotoHover, HOVER_DELAY_MS } from "../ArticlePhotoHover";

function tactil(si: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: si && q.includes("hover: none"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  tactil(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pintar(props: Partial<React.ComponentProps<typeof ArticlePhotoHover>> = {}) {
  const onFila = vi.fn();
  const utils = render(
    // La fila de la tabla tiene su propio onClick (drill-down).
    <div data-testid="fila" onClick={onFila}>
      <ArticlePhotoHover codigo="144750" slots={[1, 2, 3]} referencia="V26212484" {...props}>
        <span>V26212484</span>
      </ArticlePhotoHover>
    </div>,
  );
  return { ...utils, onFila };
}

const avanzar = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("ArticlePhotoHover", () => {
  it("sin slots no renderiza indicador ni nada más que el contenido", () => {
    const { container } = render(
      <ArticlePhotoHover codigo="169" slots={[]}>
        <span>V26000001</span>
      </ArticlePhotoHover>,
    );
    expect(container.innerHTML).toBe("<span>V26000001</span>");
    expect(screen.queryByTestId("article-photo-glyph")).toBeNull();
    expect(screen.queryByTestId("article-photo-trigger")).toBeNull();
  });

  it("cerrado por defecto: glifo sí, <img> y tooltip no", () => {
    pintar();
    expect(screen.getByTestId("article-photo-glyph")).toBeInTheDocument();
    expect(screen.getByText("V26212484")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("el hover monta la <img> tras 250 ms, no antes", () => {
    pintar();
    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));

    avanzar(HOVER_DELAY_MS - 1);
    expect(document.querySelector("img")).toBeNull();

    avanzar(1);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveAttribute("data-visible", "true");
    const img = tooltip.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/api/fotos/144750/1?w=256");
    expect(img).toHaveAttribute("alt", "Foto del artículo V26212484");
    expect(screen.getByTestId("article-photo-trigger")).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("cruzar con el ratón (entrar y salir antes de 250 ms) no descarga nada", () => {
    pintar();
    const trigger = screen.getByTestId("article-photo-trigger");
    fireEvent.mouseEnter(trigger);
    avanzar(100);
    fireEvent.mouseLeave(trigger);
    avanzar(1000);
    expect(document.querySelector("img")).toBeNull();
  });

  it("al salir se oculta, y la <img> ya montada no se vuelve a pedir", () => {
    pintar();
    const trigger = screen.getByTestId("article-photo-trigger");
    fireEvent.mouseEnter(trigger);
    avanzar(HOVER_DELAY_MS);
    fireEvent.mouseLeave(trigger);
    expect(screen.getByTestId("article-photo-tooltip")).toHaveAttribute("data-visible", "false");
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("el foco de teclado lo muestra sin esperar", () => {
    pintar();
    fireEvent.focus(screen.getByTestId("article-photo-trigger"));
    avanzar(0);
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-visible", "true");
  });

  it("hay esqueleto hasta que la foto carga", () => {
    pintar();
    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));
    avanzar(HOVER_DELAY_MS);
    expect(screen.getByTestId("article-photo-skeleton")).toBeInTheDocument();
    fireEvent.load(screen.getByRole("tooltip").querySelector("img")!);
    expect(screen.queryByTestId("article-photo-skeleton")).toBeNull();
  });

  it("indica 1/3 con varias fotos y nada con una sola", () => {
    const varias = pintar();
    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));
    avanzar(HOVER_DELAY_MS);
    expect(screen.getByTestId("article-photo-count")).toHaveTextContent("1/3");
    varias.unmount();

    pintar({ slots: [2] });
    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));
    avanzar(HOVER_DELAY_MS);
    expect(screen.queryByTestId("article-photo-count")).toBeNull();
    // Con una sola foto en el slot 2, es esa la que se enseña.
    expect(screen.getByRole("tooltip").querySelector("img")).toHaveAttribute(
      "src",
      "/api/fotos/144750/2?w=256",
    );
  });

  it("el click abre el lightbox y NO llega a la fila", () => {
    const { onFila } = pintar();
    fireEvent.click(screen.getByText("V26212484"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onFila).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])("la tecla %j abre el lightbox", (key) => {
    const { onFila } = pintar();
    const trigger = screen.getByTestId("article-photo-trigger");
    expect(trigger).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(trigger, { key });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onFila).not.toHaveBeenCalled();
  });

  it("otras teclas no hacen nada", () => {
    pintar();
    fireEvent.keyDown(screen.getByTestId("article-photo-trigger"), { key: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cerrar el lightbox tampoco dispara el click de la fila", () => {
    const { onFila } = pintar();
    fireEvent.click(screen.getByTestId("article-photo-trigger"));
    fireEvent.click(screen.getByTestId("photo-lightbox-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onFila).not.toHaveBeenCalled();
  });

  it("táctil: sin hover no hay tooltip; el toque abre el lightbox directamente", () => {
    tactil(true);
    pintar();
    const trigger = screen.getByTestId("article-photo-trigger");
    // Un toque sintetiza mouseenter y focus antes del click.
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    avanzar(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // El glifo se mantiene: indica que es pulsable.
    expect(screen.getByTestId("article-photo-glyph")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("glifo={false} envuelve sin añadir la cámara", () => {
    pintar({ glifo: false });
    expect(screen.queryByTestId("article-photo-glyph")).toBeNull();
    expect(screen.getByTestId("article-photo-trigger")).toBeInTheDocument();
  });

  it("escapa el código en la URL", () => {
    pintar({ codigo: "AB.1-2", slots: [1] });
    fireEvent.mouseEnter(screen.getByTestId("article-photo-trigger"));
    avanzar(HOVER_DELAY_MS);
    expect(screen.getByRole("tooltip").querySelector("img")).toHaveAttribute(
      "src",
      "/api/fotos/AB.1-2/1?w=256",
    );
  });
});
