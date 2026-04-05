// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ReviewDisplay from "@/components/ReviewDisplay";
import type { ReviewContent } from "@/lib/review-prompts";

// ─── Test data ────────────────────────────────────────────────────────────────

const sampleReview: ReviewContent & { id: number; week_start: string } = {
  id: 1,
  week_start: "2026-04-01",
  executive_summary:
    "• Las ventas netas han aumentado un 12% respecto a la semana anterior\n• La tienda 03 lidera en ventas con 8.200€\n• El canal mayorista registra 15 nuevas facturas\n• Stock crítico en 8 referencias",
  sections: [
    {
      title: "Ventas Retail",
      content:
        "Esta semana las ventas retail alcanzaron 45.230€, un incremento del 12% respecto a la semana anterior.\n\nLa tienda 03 continúa liderando con 8.200€, seguida por las tiendas 01 y 05.",
    },
    {
      title: "Canal Mayorista",
      content:
        "La facturación mayorista esta semana asciende a 23.500€ en 15 facturas.\n\nEl cliente MODAS SL sigue siendo el principal cliente con 8.000€.",
    },
    {
      title: "Stock y Logística",
      content:
        "El stock total asciende a 12.450 unidades en 380 referencias.\n\nSe han identificado 8 artículos con stock crítico (menos de 5 unidades).",
    },
    {
      title: "Compras",
      content:
        "Esta semana se han realizado 3 pedidos de compra por un importe total de 15.000€.\n\nEsto supone un incremento del 20% respecto a la semana anterior.",
    },
  ],
  action_items: [
    "Prioridad alta: Revisar stock crítico de 8 referencias con menos de 5 unidades",
    "Prioridad media: Contactar con los 3 clientes mayoristas pendientes de factura",
    "Prioridad baja: Planificar traspasos entre tiendas para optimizar el stock",
  ],
  generated_at: "2026-04-05T10:00:00.000Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewDisplay", () => {
  const originalClipboard = globalThis.navigator.clipboard;
  const originalPrint = globalThis.window?.print;

  beforeEach(() => {
    // Mock clipboard
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
    // Mock window.print
    if (typeof window !== "undefined") {
      window.print = vi.fn();
    }
  });

  afterEach(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    if (typeof window !== "undefined" && originalPrint) {
      window.print = originalPrint;
    }
  });

  it("renders the executive summary section", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByTestId("executive-summary")).toBeInTheDocument();
    expect(screen.getByText("Resumen Ejecutivo")).toBeInTheDocument();
  });

  it("renders all executive summary bullet points", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(
      screen.getByText(/Las ventas netas han aumentado/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/La tienda 03 lidera en ventas/)
    ).toBeInTheDocument();
  });

  it("renders all 4 domain sections", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByText("Ventas Retail")).toBeInTheDocument();
    expect(screen.getByText("Canal Mayorista")).toBeInTheDocument();
    expect(screen.getByText("Stock y Logística")).toBeInTheDocument();
    expect(screen.getByText("Compras")).toBeInTheDocument();
  });

  it("renders section content", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByText(/ventas retail alcanzaron 45\.230€/)).toBeInTheDocument();
  });

  it("renders action items section", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByTestId("action-items")).toBeInTheDocument();
    expect(screen.getByText("Acciones Recomendadas")).toBeInTheDocument();
  });

  it("renders all action items", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByText(/Revisar stock crítico/)).toBeInTheDocument();
    expect(screen.getByText(/Contactar con los 3 clientes/)).toBeInTheDocument();
    expect(screen.getByText(/Planificar traspasos/)).toBeInTheDocument();
  });

  it("renders priority badges for action items with priority markers", () => {
    render(<ReviewDisplay review={sampleReview} />);
    // "Prioridad alta" should become a badge with text "alta"
    const altaBadges = screen.getAllByText("alta");
    expect(altaBadges.length).toBeGreaterThan(0);
  });

  it("renders the generated_at timestamp", () => {
    render(<ReviewDisplay review={sampleReview} />);
    // Should show "Generado el" text
    const generatedTexts = screen.getAllByText(/Generado el/);
    expect(generatedTexts.length).toBeGreaterThan(0);
  });

  it("renders week_start in the toolbar", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByText(/Semana del/)).toBeInTheDocument();
  });

  it("renders the print button", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByTestId("print-button")).toBeInTheDocument();
    expect(screen.getByText("Imprimir")).toBeInTheDocument();
  });

  it("clicking print button calls window.print", () => {
    render(<ReviewDisplay review={sampleReview} />);
    fireEvent.click(screen.getByTestId("print-button"));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("renders the copy button", () => {
    render(<ReviewDisplay review={sampleReview} />);
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
    expect(screen.getByText("Copiar")).toBeInTheDocument();
  });

  it("clicking copy button copies text to clipboard", async () => {
    render(<ReviewDisplay review={sampleReview} />);
    fireEvent.click(screen.getByTestId("copy-button"));
    await waitFor(() => {
      expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const callArg = (globalThis.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(callArg).toContain("REVISIÓN SEMANAL");
    expect(callArg).toContain("VENTAS RETAIL");
  });

  it("shows 'Copiado' feedback after copy", async () => {
    render(<ReviewDisplay review={sampleReview} />);
    fireEvent.click(screen.getByTestId("copy-button"));
    await waitFor(() => {
      expect(screen.getByText("Copiado")).toBeInTheDocument();
    });
  });
});
