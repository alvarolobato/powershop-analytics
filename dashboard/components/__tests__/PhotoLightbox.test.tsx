// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PhotoLightbox, urlFoto } from "../PhotoLightbox";

const precargadas: string[] = [];

beforeEach(() => {
  precargadas.length = 0;
  // rAF síncrono: el foco inicial entra sin esperar a un frame.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  class ImagenFalsa {
    set src(v: string) {
      precargadas.push(v);
    }
  }
  vi.stubGlobal("Image", ImagenFalsa);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function abrir(props: Partial<React.ComponentProps<typeof PhotoLightbox>> = {}) {
  const onClose = vi.fn();
  const onFila = vi.fn();
  const onTeclaFila = vi.fn();
  const utils = render(
    <div onClick={onFila} onKeyDown={onTeclaFila}>
      <PhotoLightbox
        codigo="144750"
        slots={[1, 2, 3]}
        referencia="V26212484"
        descripcion="Camisa flores c/cinturon"
        onClose={onClose}
        {...props}
      />
    </div>,
  );
  return { ...utils, onClose, onFila, onTeclaFila };
}

const foto = () => screen.getByRole("dialog").querySelector("img")!;

describe("urlFoto", () => {
  it("compone la ruta del endpoint, con y sin ancho", () => {
    expect(urlFoto("144750", 2)).toBe("/api/fotos/144750/2");
    expect(urlFoto("144750", 2, 1024)).toBe("/api/fotos/144750/2?w=1024");
    expect(urlFoto("a/b", 1)).toBe("/api/fotos/a%2Fb/1");
  });
});

describe("PhotoLightbox", () => {
  it("es un diálogo modal con la foto a 1024 y el pie con referencia y descripción", () => {
    abrir();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/1?w=1024");
    expect(foto()).toHaveAttribute("alt", "Foto 1 de 3 del artículo V26212484");
    expect(dialog).toHaveTextContent("V26212484");
    expect(dialog).toHaveTextContent("Camisa flores c/cinturon");
    expect(dialog).toHaveAccessibleName(/V26212484/);
  });

  it("vive en document.body, fuera del contenedor que lo renderiza", () => {
    const { container } = abrir();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("navega con los botones y da la vuelta", () => {
    abrir();
    const contador = screen.getByTestId("photo-lightbox-counter");
    expect(contador).toHaveTextContent("1/3");

    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    expect(contador).toHaveTextContent("2/3");
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/2?w=1024");

    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    expect(contador).toHaveTextContent("1/3");

    fireEvent.click(screen.getByRole("button", { name: "Foto anterior" }));
    expect(contador).toHaveTextContent("3/3");
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/3?w=1024");
  });

  it("navega con las flechas del teclado", () => {
    abrir();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("2/3");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("3/3");
  });

  it("las flechas no desplazan la página de detrás, y el body no hace scroll mientras está abierto", () => {
    document.body.style.overflow = "auto";
    const { unmount } = abrir();
    expect(document.body.style.overflow).toBe("hidden");

    const ev = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    unmount();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("usa los slots reales, no 1..n: con fotos en 1 y 3 salta el 2", () => {
    abrir({ slots: [1, 3] });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/3?w=1024");
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("2/2");
  });

  it("si una revalidación quita un slot con el diálogo abierto, el contador no dice 3/2", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PhotoLightbox codigo="144750" slots={[1, 2, 3]} inicial={3} onClose={onClose} />);
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("3/3");

    rerender(<PhotoLightbox codigo="144750" slots={[1, 2]} inicial={3} onClose={onClose} />);

    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("2/2");
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/2?w=1024");
  });

  it("abre en el slot inicial pedido", () => {
    abrir({ inicial: 3 });
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/3?w=1024");
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("3/3");
  });

  it("con una sola foto no hay flechas ni contador, y las teclas no hacen nada", () => {
    abrir({ slots: [1] });
    expect(screen.queryByRole("button", { name: "Foto siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Foto anterior" })).toBeNull();
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/1?w=1024");
    expect(precargadas).toEqual([]);
  });

  it("precarga la siguiente", () => {
    abrir();
    expect(precargadas).toEqual(["/api/fotos/144750/2?w=1024"]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(precargadas.at(-1)).toBe("/api/fotos/144750/3?w=1024");
  });

  it("Escape cierra", () => {
    const { onClose } = abrir();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("las teclas funcionan con el foco DENTRO del diálogo, que es donde está siempre", () => {
    // Regresión cazada por el e2e: el diálogo corta la propagación de teclas
    // (para proteger la fila de la tabla) y con ello dejaba sordo a su propio
    // listener de `window`. Con el foco en un botón, ni Escape ni las flechas
    // hacían nada.
    const { onClose, onTeclaFila } = abrir();
    const cerrar = screen.getByRole("button", { name: "Cerrar foto" });
    cerrar.focus();

    fireEvent.keyDown(cerrar, { key: "ArrowRight" });
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("2/3");
    fireEvent.keyDown(screen.getByRole("button", { name: "Foto siguiente" }), { key: "ArrowLeft" });
    expect(screen.getByTestId("photo-lightbox-counter")).toHaveTextContent("1/3");

    fireEvent.keyDown(cerrar, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTeclaFila).not.toHaveBeenCalled();
  });

  it("el click fuera cierra; el click en la foto no", () => {
    const { onClose } = abrir();
    fireEvent.click(foto());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("photo-lightbox-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el botón de cerrar cierra", () => {
    const { onClose } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar foto" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("nada de lo que pasa dentro llega a la fila de la tabla", () => {
    const { onFila, onTeclaFila } = abrir();
    fireEvent.click(foto());
    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    fireEvent.click(screen.getByTestId("photo-lightbox-backdrop"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Cerrar foto" }), { key: "Enter" });
    expect(onFila).not.toHaveBeenCalled();
    expect(onTeclaFila).not.toHaveBeenCalled();
  });

  it("focus trap: el foco entra al abrir y Tab / Shift+Tab no salen del diálogo", () => {
    abrir();
    const cerrar = screen.getByRole("button", { name: "Cerrar foto" });
    const anterior = screen.getByRole("button", { name: "Foto anterior" });
    const siguiente = screen.getByRole("button", { name: "Foto siguiente" });
    expect(document.activeElement).toBe(cerrar);

    // Shift+Tab desde el primero → al último.
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(siguiente);

    // Tab desde el último → al primero.
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(cerrar);

    // En medio, el navegador hace lo suyo: no se interviene.
    anterior.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("si el foco se ha escapado del diálogo, Tab lo devuelve dentro", () => {
    abrir();
    const fuera = document.createElement("button");
    document.body.appendChild(fuera);
    fuera.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cerrar foto" }));
    fuera.remove();
  });

  it("al cerrar devuelve el foco a donde estaba", () => {
    const origen = document.createElement("button");
    document.body.appendChild(origen);
    origen.focus();
    const { unmount } = abrir();
    expect(document.activeElement).not.toBe(origen);
    unmount();
    expect(document.activeElement).toBe(origen);
    origen.remove();
  });

  it("esqueleto mientras carga; mensaje si la foto falla (sin superficie de error)", () => {
    abrir();
    expect(screen.getByTestId("photo-lightbox-skeleton")).toBeInTheDocument();
    fireEvent.load(foto());
    expect(screen.queryByTestId("photo-lightbox-skeleton")).toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("photo-lightbox-skeleton")).toBeInTheDocument();
    fireEvent.error(foto());
    expect(screen.getByText("No se pudo cargar la foto.")).toBeInTheDocument();
    // Y se puede seguir navegando.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(foto()).toHaveAttribute("src", "/api/fotos/144750/3?w=1024");
  });

  it("sin referencia el pie enseña el código", () => {
    abrir({ referencia: undefined, descripcion: undefined });
    expect(screen.getByRole("dialog")).toHaveTextContent("144750");
    expect(foto()).toHaveAttribute("alt", "Foto 1 de 3 del artículo 144750");
  });
});
