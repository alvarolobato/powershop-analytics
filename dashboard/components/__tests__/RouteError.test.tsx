// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RouteError from "../RouteError";

describe("RouteError", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("shows the error message and the Next.js digest as the reportable id", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc123" });
    render(
      <RouteError
        error={err}
        reset={() => {}}
        scope="/paneles"
        title="Error al cargar los paneles"
        fallbackMessage="fallback"
      />,
    );
    expect(screen.getByText("Error al cargar los paneles")).toBeTruthy();
    expect(document.body.textContent).toContain("boom");
    // The reportable id lives behind the "Detalles técnicos" toggle, same as
    // it does for a failed API call — the user expands to read it out.
    fireEvent.click(screen.getByTestId("toggle-details"));
    expect(screen.getByTestId("technical-details").textContent).toContain("abc123");
  });

  it("falls back to the supplied message when the throw carried none", () => {
    render(
      <RouteError
        error={new Error("")}
        reset={() => {}}
        scope="/x"
        title="T"
        fallbackMessage="No se ha podido cargar."
      />,
    );
    expect(document.body.textContent).toContain("No se ha podido cargar.");
  });

  it("marks a digest-less error as client-render rather than implying a server trace", () => {
    render(
      <RouteError
        error={new Error("kaboom")}
        reset={() => {}}
        scope="/x"
        title="T"
        fallbackMessage="f"
      />,
    );
    // A client-side render throw never reached the server; saying so is more
    // honest than printing an id nobody can look up.
    fireEvent.click(screen.getByTestId("toggle-details"));
    expect(screen.getByTestId("technical-details").textContent).toContain("client-render");
  });

  it("logs the error to the console with its route scope", () => {
    render(
      <RouteError
        error={new Error("boom")}
        reset={() => {}}
        scope="/conversations"
        title="T"
        fallbackMessage="f"
      />,
    );
    expect(spy).toHaveBeenCalledWith("[/conversations] Page error:", expect.any(Error));
  });
});
