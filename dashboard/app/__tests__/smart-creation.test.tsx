// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import NewDashboard from "../dashboard/new/page";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({}),
}));

// Mock DataFreshnessBanner to avoid uncontrolled fetch calls during tests
vi.mock("@/components/DataFreshnessBanner", () => ({
  DataFreshnessBanner: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockDashboardList = [
  { id: 1, name: "Panel de Ventas", description: "Ventas mensuales", updated_at: "2026-04-01T10:00:00Z" },
  { id: 2, name: "Panel de Stock", description: null, updated_at: "2026-04-02T15:30:00Z" },
];

const mockSuggestions = [
  { name: "Panel de Márgenes", description: "Márgenes por familia", prompt: "Crea un dashboard de márgenes..." },
  { name: "Panel de KPIs Diarios", description: "KPIs del día", prompt: "Crea un dashboard de KPIs diarios..." },
];

const mockGaps = [
  { area: "Análisis de Compras", description: "No tienes un panel de compras.", suggestedPrompt: "Crea un dashboard de compras..." },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewDashboard page — smart creation sections", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPush.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Tabs & task cards section ───────────────────────────────────────────

  it("renders creation mode tabs", () => {
    render(<NewDashboard />);
    expect(screen.getByTestId("creation-tab-templates")).toBeInTheDocument();
    expect(screen.getByTestId("creation-tab-assistant")).toBeInTheDocument();
    expect(screen.getByTestId("creation-tab-free")).toBeInTheDocument();
  });

  it("moves tab selection with Arrow keys (roving tabindex)", async () => {
    render(<NewDashboard />);
    const assistantBtn = screen.getByTestId("creation-tab-assistant");
    assistantBtn.focus();
    await act(async () => {
      fireEvent.keyDown(assistantBtn, { key: "ArrowRight" });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("creation-tab-free"));
    });

    const freeBtn = screen.getByTestId("creation-tab-free");
    await act(async () => {
      fireEvent.keyDown(freeBtn, { key: "ArrowLeft" });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(assistantBtn);
    });
  });

  it("renders the task cards section heading", () => {
    render(<NewDashboard />);
    expect(screen.getByText("¿Qué necesitas hacer?")).toBeInTheDocument();
  });

  it("renders all 6 task cards", () => {
    render(<NewDashboard />);
    expect(screen.getAllByText("Crear panel").length).toBeGreaterThanOrEqual(6);
  });

  it("renders the weekly sales meeting task card", () => {
    render(<NewDashboard />);
    expect(
      screen.getByText("Preparar la reunión semanal de ventas")
    ).toBeInTheDocument();
  });

  it("renders the replenishment task card", () => {
    render(<NewDashboard />);
    expect(
      screen.getByText("Decidir qué reponer esta semana")
    ).toBeInTheDocument();
  });

  it("renders the wholesale analysis task card", () => {
    render(<NewDashboard />);
    expect(
      screen.getByText("Analizar el canal mayorista")
    ).toBeInTheDocument();
  });

  it("clicking a task card generates a dashboard and redirects", async () => {
    const generatedSpec = {
      title: "Reunión Semanal de Ventas",
      description: "Panel para la reunión semanal",
      widgets: [{ type: "number", title: "Ventas", sql: "SELECT 1", format: "number" }],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(generatedSpec),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 99, ...generatedSpec }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    const taskCard = screen.getByTestId("task-card-weekly-sales-meeting");

    await act(async () => {
      fireEvent.click(taskCard);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/99");
    });

    // Verify it called generate (not free-form with textarea content)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ── Role suggestions section ────────────────────────────────────────────

  it("renders the role suggestions section heading", () => {
    render(<NewDashboard />);
    expect(screen.getByText("Recomendado para ti")).toBeInTheDocument();
  });

  it("renders all role pills", () => {
    render(<NewDashboard />);
    expect(screen.getByTestId("role-pill-Director de ventas")).toBeInTheDocument();
    expect(screen.getByTestId("role-pill-Responsable de tienda")).toBeInTheDocument();
    expect(screen.getByTestId("role-pill-Comprador")).toBeInTheDocument();
    expect(screen.getByTestId("role-pill-Director general")).toBeInTheDocument();
    expect(screen.getByTestId("role-pill-Responsable de stock")).toBeInTheDocument();
    expect(screen.getByTestId("role-pill-Controller financiero")).toBeInTheDocument();
  });

  it("clicking a role pill fetches suggestions and shows results", async () => {
    const fetchMock = vi.fn()
      // GET /api/dashboards
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDashboardList),
      })
      // POST /api/dashboard/suggest
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ suggestions: mockSuggestions }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("role-pill-Director de ventas"));
    });

    // Should show suggestions after loading
    await waitFor(() => {
      expect(screen.getByText("Panel de Márgenes")).toBeInTheDocument();
    });
    expect(screen.getByText("Panel de KPIs Diarios")).toBeInTheDocument();
  });

  it("shows loading spinner while fetching suggestions", async () => {
    // Return a never-resolving promise to hold the loading state
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("role-pill-Comprador"));
    });

    // Should show loading spinner
    expect(screen.getByLabelText("Cargando sugerencias")).toBeInTheDocument();
    expect(screen.getByText("Analizando tu perfil...")).toBeInTheDocument();
  });

  it("clicking Crear on a suggestion triggers generation", async () => {
    const generatedSpec = {
      title: "Panel de Márgenes",
      description: "Márgenes por familia",
      widgets: [{ type: "number", title: "Margen", sql: "SELECT 1", format: "number" }],
    };

    const fetchMock = vi.fn()
      // GET /api/dashboards
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDashboardList),
      })
      // POST /api/dashboard/suggest
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ suggestions: mockSuggestions }),
      })
      // POST /api/dashboard/generate
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(generatedSpec),
      })
      // POST /api/dashboards (save)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 55, ...generatedSpec }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("role-pill-Comprador"));
    });

    await waitFor(() => {
      expect(screen.getByText("Panel de Márgenes")).toBeInTheDocument();
    });

    // Find and click the "Crear" button for the first suggestion
    const crearButtons = screen.getAllByRole("button", { name: "Crear" });
    await act(async () => {
      fireEvent.click(crearButtons[0]);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/55");
    });
  });

  // ── Gap analysis section ────────────────────────────────────────────────

  it("renders the gap analysis section heading", () => {
    render(<NewDashboard />);
    expect(screen.getByText("¿Qué me falta?")).toBeInTheDocument();
  });

  it("renders the Analizar cobertura button", () => {
    render(<NewDashboard />);
    expect(screen.getByTestId("analyze-gaps-button")).toBeInTheDocument();
    expect(screen.getByText("Analizar cobertura")).toBeInTheDocument();
  });

  it("clicking Analizar cobertura fetches gaps and shows results", async () => {
    const fetchMock = vi.fn()
      // GET /api/dashboards
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDashboardList),
      })
      // GET /api/dashboard/1
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 1,
            name: "Panel de Ventas",
            description: "Ventas mensuales",
            spec: {
              title: "Panel de Ventas",
              widgets: [
                { type: "number", title: "Ventas Netas", sql: "SELECT 1", format: "number" },
              ],
            },
          }),
      })
      // GET /api/dashboard/2
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 2,
            name: "Panel de Stock",
            spec: {
              title: "Panel de Stock",
              widgets: [
                { type: "number", title: "Stock Total", sql: "SELECT 1", format: "number" },
              ],
            },
          }),
      })
      // POST /api/dashboard/gaps
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ gaps: mockGaps }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-gaps-button"));
    });

    // Should show gaps after loading
    await waitFor(() => {
      expect(screen.getByText("Análisis de Compras")).toBeInTheDocument();
    });
    expect(screen.getByText("No tienes un panel de compras.")).toBeInTheDocument();
  });

  it("shows loading spinner while analyzing gaps", async () => {
    // Return a never-resolving promise to hold the loading state
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-gaps-button"));
    });

    // Should show loading spinner
    expect(screen.getByLabelText("Analizando cobertura")).toBeInTheDocument();
    expect(screen.getByText("Analizando...")).toBeInTheDocument();
  });

  it("clicking Crear panel on a gap triggers generation", async () => {
    const generatedSpec = {
      title: "Panel de Compras",
      description: "Gestión de compras",
      widgets: [{ type: "number", title: "Compras", sql: "SELECT 1", format: "number" }],
    };

    const fetchMock = vi.fn()
      // GET /api/dashboards
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      // POST /api/dashboard/gaps
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ gaps: mockGaps }),
      })
      // POST /api/dashboard/generate
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(generatedSpec),
      })
      // POST /api/dashboards (save)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 77, ...generatedSpec }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("analyze-gaps-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("Análisis de Compras")).toBeInTheDocument();
    });

    const crearPanelButtons = screen.getAllByRole("button", { name: "Crear panel" });

    await act(async () => {
      fireEvent.click(crearPanelButtons[crearPanelButtons.length - 1]);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/77");
    });
  });

  // ── Existing sections still work ────────────────────────────────────────

  it("still renders free-form prompt textarea", () => {
    render(<NewDashboard />);
    fireEvent.click(screen.getByTestId("creation-tab-free"));
    expect(
      screen.getByPlaceholderText("Describe el dashboard que necesitas...")
    ).toBeInTheDocument();
    expect(screen.getByText("Generar Dashboard")).toBeInTheDocument();
  });

  it("still renders template cards section", () => {
    render(<NewDashboard />);
    fireEvent.click(screen.getByTestId("creation-tab-templates"));
    expect(screen.getByText("Plantillas predefinidas")).toBeInTheDocument();
  });

  it("disables interactive elements while generation is in progress", async () => {
    // Hang the fetch so loading state is captured
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<NewDashboard />);

    const taskCard = screen.getByTestId("task-card-replenishment");

    await act(async () => {
      fireEvent.click(taskCard);
    });

    // While loading, task cards should be disabled
    expect(screen.getByTestId("task-card-replenishment")).toBeDisabled();
    expect(screen.getByTestId("analyze-gaps-button")).toBeDisabled();
  });
});
