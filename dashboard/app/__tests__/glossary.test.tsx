// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { applyGlossary } from "@/lib/glossary";
import { GlossaryTooltip } from "@/components/GlossaryTooltip";
import { GlossaryPanel } from "@/components/GlossaryPanel";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// applyGlossary() unit tests
// ---------------------------------------------------------------------------

describe("applyGlossary()", () => {
  const glossary = [
    { term: "Ventas Netas", definition: "Importe de ventas sin IVA, sin devoluciones." },
    { term: "Ticket Medio", definition: "Importe medio por transacción." },
    { term: "Entrada", definition: "Indica si es una venta real (true) o devolución (false)." },
  ];

  it("returns plain string when glossary is empty", () => {
    const result = applyGlossary("Ventas Netas este mes", []);
    expect(result).toBe("Ventas Netas este mes");
  });

  it("returns plain string when glossary is undefined", () => {
    const result = applyGlossary("Ventas Netas este mes", undefined);
    expect(result).toBe("Ventas Netas este mes");
  });

  it("returns plain string when no terms match", () => {
    const result = applyGlossary("No hay coincidencias aquí", glossary);
    expect(result).toBe("No hay coincidencias aquí");
  });

  it("returns React node when a term matches", () => {
    const result = applyGlossary("Ventas Netas este mes", glossary);
    expect(typeof result).not.toBe("string");
    // Render the node and check for the tooltip element
    const { container } = render(result as React.ReactNode);
    expect(container.textContent).toContain("Ventas Netas");
    expect(container.textContent).toContain("este mes");
  });

  it("is case-insensitive — 'ventas netas' matches term 'Ventas Netas'", () => {
    const result = applyGlossary("ventas netas del trimestre", glossary);
    expect(typeof result).not.toBe("string");
    const { container } = render(result as React.ReactNode);
    expect(container.textContent).toContain("ventas netas");
  });

  it("only wraps the first occurrence of each term", () => {
    const result = applyGlossary("Ventas Netas y más Ventas Netas aquí", glossary);
    // Should still return a React node (at least one match)
    expect(typeof result).not.toBe("string");
    const { container } = render(result as React.ReactNode);
    // The full text should still be present
    expect(container.textContent).toContain("Ventas Netas");
  });

  it("does not match partial words — 'venta' should not match inside a longer word", () => {
    const partialGlossary = [{ term: "venta", definition: "Transacción comercial." }];
    // "inventario" contains "inventar" not "venta" — this should not match
    const result = applyGlossary("Gestión de inventario", partialGlossary);
    expect(result).toBe("Gestión de inventario");
  });

  it("matches term at word boundary — 'Entrada' matches standalone", () => {
    const result = applyGlossary("Filtro de Entrada activo", glossary);
    expect(typeof result).not.toBe("string");
  });

  it("handles text with no glossary terms gracefully", () => {
    const emptyGlossary = [{ term: "xyz_nonexistent", definition: "unused" }];
    const result = applyGlossary("Plain text with no matches", emptyGlossary);
    expect(result).toBe("Plain text with no matches");
  });

  it("handles multiple different terms matching in same text", () => {
    const result = applyGlossary("Ventas Netas y Ticket Medio del mes", glossary);
    expect(typeof result).not.toBe("string");
    const { container } = render(result as React.ReactNode);
    expect(container.textContent).toContain("Ventas Netas");
    expect(container.textContent).toContain("Ticket Medio");
  });
});

// ---------------------------------------------------------------------------
// GlossaryTooltip component tests
// ---------------------------------------------------------------------------

describe("GlossaryTooltip", () => {
  it("renders the term text", () => {
    render(<GlossaryTooltip term="Ventas Netas" definition="Importe sin IVA." />);
    expect(screen.getByText("Ventas Netas")).toBeInTheDocument();
  });

  it("renders with dotted underline styling", () => {
    render(<GlossaryTooltip term="Ventas Netas" definition="Importe sin IVA." />);
    const term = screen.getByText("Ventas Netas");
    expect(term.className).toContain("decoration-dotted");
    expect(term.className).toContain("underline");
  });

  it("renders the tooltip with the definition", () => {
    render(<GlossaryTooltip term="Ventas Netas" definition="Importe sin IVA." />);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toContain("Importe sin IVA.");
  });

  it("tooltip is initially not visible (opacity-0 class)", () => {
    render(<GlossaryTooltip term="Ventas Netas" definition="Importe sin IVA." />);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("opacity-0");
  });

  it("has keyboard-accessible tabIndex on the term span", () => {
    render(<GlossaryTooltip term="Ventas Netas" definition="Importe sin IVA." />);
    const termSpan = screen.getByText("Ventas Netas");
    expect(termSpan).toHaveAttribute("tabindex", "0");
  });
});

// ---------------------------------------------------------------------------
// GlossaryPanel component tests
// ---------------------------------------------------------------------------

describe("GlossaryPanel", () => {
  const glossary = [
    { term: "Ticket Medio", definition: "Importe medio por transacción." },
    { term: "Ventas Netas", definition: "Importe de ventas sin IVA." },
    { term: "Entrada", definition: "Indica si es venta o devolución." },
  ];
  // onClose is reset before each test to avoid cross-test state leakage
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <GlossaryPanel glossary={glossary} isOpen={false} onClose={onClose} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when isOpen is true", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    expect(screen.getByTestId("glossary-panel")).toBeInTheDocument();
  });

  it("shows the panel title in Spanish", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    expect(screen.getByText("Glosario de Métricas")).toBeInTheDocument();
  });

  it("lists all glossary terms", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    expect(screen.getByText("Ventas Netas")).toBeInTheDocument();
    expect(screen.getByText("Ticket Medio")).toBeInTheDocument();
    expect(screen.getByText("Entrada")).toBeInTheDocument();
  });

  it("displays terms in alphabetical order", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    const entries = screen.getAllByTestId("glossary-entry");
    // Sorted: Entrada, Ticket Medio, Ventas Netas
    expect(entries[0].textContent).toContain("Entrada");
    expect(entries[1].textContent).toContain("Ticket Medio");
    expect(entries[2].textContent).toContain("Ventas Netas");
  });

  it("shows each term's definition", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    expect(screen.getByText("Importe de ventas sin IVA.")).toBeInTheDocument();
    expect(screen.getByText("Importe medio por transacción.")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText("Cerrar glosario");
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", () => {
    render(<GlossaryPanel glossary={glossary} isOpen={true} onClose={onClose} />);
    const backdrop = screen.getByTestId("glossary-backdrop");
    backdrop.click();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows empty state message when glossary is empty", () => {
    render(<GlossaryPanel glossary={[]} isOpen={true} onClose={onClose} />);
    expect(screen.getByText("No hay términos en el glosario.")).toBeInTheDocument();
  });
});
