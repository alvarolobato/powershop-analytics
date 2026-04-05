// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ReviewPage from "../review/page";
import type { ReviewContent } from "@/lib/review-prompts";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const mockReview: ReviewContent & { id: number; week_start: string } = {
  id: 1,
  week_start: "2026-03-31",
  executive_summary:
    "• Ventas semanales 45.230€, +12% vs semana anterior\n• Tienda 03 lidera con 8.200€\n• Stock crítico en 8 referencias",
  sections: [
    {
      title: "Ventas Retail",
      content: "Las ventas retail alcanzaron 45.230€ esta semana.",
    },
    {
      title: "Canal Mayorista",
      content: "La facturación mayorista asciende a 23.500€.",
    },
    {
      title: "Stock y Logística",
      content: "Stock total de 12.450 unidades.",
    },
    {
      title: "Compras",
      content: "3 pedidos de compra esta semana.",
    },
  ],
  action_items: [
    "Revisar stock crítico de 8 referencias",
    "Planificar traspasos entre tiendas",
  ],
  generated_at: "2026-04-05T10:00:00.000Z",
};

const mockPastReviews = [
  {
    id: 1,
    week_start: "2026-03-31",
    executive_summary:
      "• Ventas semanales 45.230€\n• Stock crítico en 8 referencias",
    created_at: "2026-04-05T10:00:00.000Z",
  },
  {
    id: 2,
    week_start: "2026-03-24",
    executive_summary: "• Ventas 40.000€\n• Sin alertas de stock",
    created_at: "2026-03-29T09:00:00.000Z",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ ok: boolean; data: unknown }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: response.ok,
      status: response.ok ? 200 : 500,
      json: () => Promise.resolve(response.data),
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the page title", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ReviewPage />);
    expect(screen.getByText("Revisión Semanal")).toBeInTheDocument();
  });

  it("renders the 'Generar revisión semanal' button", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ReviewPage />);
    expect(screen.getByTestId("generate-button")).toBeInTheDocument();
    expect(screen.getByText("Generar revisión semanal")).toBeInTheDocument();
  });

  it("shows loading spinner while fetching past reviews", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ReviewPage />);
    // The spinner has aria-label "Cargando revisiones"
    expect(screen.getByLabelText("Cargando revisiones")).toBeInTheDocument();
  });

  it("renders past reviews list after loading", async () => {
    globalThis.fetch = mockFetch([{ ok: true, data: mockPastReviews }]);
    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Semana del/).length).toBeGreaterThanOrEqual(1);
    });
    // Both reviews should be rendered as buttons
    expect(screen.getByTestId("past-review-1")).toBeInTheDocument();
    expect(screen.getByTestId("past-review-2")).toBeInTheDocument();
  });

  it("shows empty state when no past reviews", async () => {
    globalThis.fetch = mockFetch([{ ok: true, data: [] }]);
    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });
  });

  it("shows error state when list fetch fails", async () => {
    globalThis.fetch = mockFetch([
      { ok: false, data: { error: "Server error" } },
    ]);
    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows loading skeleton when generate is clicked", async () => {
    globalThis.fetch = vi.fn()
      // First call: list reviews
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      // Second call: generate — never resolves (keeps loading)
      .mockReturnValueOnce(new Promise(() => {}));

    render(<ReviewPage />);

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-button"));
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByText(/Generando revisión/)
    ).toBeInTheDocument();
  });

  it("renders the review after successful generation", async () => {
    globalThis.fetch = vi.fn()
      // First call: list reviews
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      // Second call: generate
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ review: mockReview }),
      })
      // Third call: refresh list after generation
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockPastReviews[0]]),
      });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("Resumen Ejecutivo")).toBeInTheDocument();
    });
    expect(screen.getByText("Ventas Retail")).toBeInTheDocument();
    expect(screen.getByText("Canal Mayorista")).toBeInTheDocument();
  });

  it("shows error when generation fails", async () => {
    globalThis.fetch = vi.fn()
      // First call: list reviews
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      // Second call: generate fails
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({
            error: "No se pudo conectar a la base de datos.",
            code: "DB_CONNECTION",
            timestamp: new Date().toISOString(),
            requestId: "req_test123",
          }),
      });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-button"));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/No se pudo conectar/)).toBeInTheDocument();
  });

  it("loads a past review when clicking on it", async () => {
    const fullReviewData = {
      id: 1,
      week_start: "2026-03-31",
      content: mockReview,
      created_at: "2026-04-05T10:00:00.000Z",
    };

    globalThis.fetch = vi.fn()
      // First call: list reviews
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPastReviews),
      })
      // Second call: load review by id
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fullReviewData),
      });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByTestId("past-review-1")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("past-review-1"));
    });

    await waitFor(() => {
      expect(screen.getByText("Resumen Ejecutivo")).toBeInTheDocument();
    });
  });

  it("shows 'Volver a la lista' button when viewing a review", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ review: mockReview }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-button"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Volver a la lista/)).toBeInTheDocument();
    });
  });

  it("returns to list when 'Volver a la lista' is clicked", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ review: mockReview }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    render(<ReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("No hay revisiones anteriores")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("generate-button"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Volver a la lista/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Volver a la lista/));
    });

    expect(screen.getByTestId("generate-button")).toBeInTheDocument();
  });
});
