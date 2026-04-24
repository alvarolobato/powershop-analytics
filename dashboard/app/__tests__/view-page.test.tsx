// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ViewDashboard from "../dashboard/[id]/page";
import type { DashboardSpec } from "@/lib/schema";

const chatSidebarCapture = vi.hoisted(() => ({
  pendingModifyInput: undefined as string | undefined,
  pendingModifyTriggerId: undefined as number | undefined,
}));

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockId = "1";

const mockSearchParamsRef = { current: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: mockId }),
  useSearchParams: () => mockSearchParamsRef.current,
}));

// ---------------------------------------------------------------------------
// Mock DashboardRenderer and ChatSidebar to avoid complex rendering
// ---------------------------------------------------------------------------

const rendererProps: { refreshKey?: number }[] = [];

vi.mock("@/components/DashboardRenderer", () => ({
  DashboardRenderer: ({
    spec,
    refreshKey,
    onDataPointClick,
  }: {
    spec: DashboardSpec;
    refreshKey?: number;
    onDataPointClick?: (ctx: {
      label: string;
      value: string;
      widgetTitle: string;
      widgetType: string;
    }) => void;
  }) => {
    rendererProps.push({ refreshKey });
    return (
      <div data-testid="dashboard-renderer" data-refresh-key={refreshKey}>
        {spec.title}
        <button
          type="button"
          data-testid="sim-chart-click"
          onClick={() =>
            onDataPointClick?.({
              label: "Tienda 05",
              value: "999",
              widgetTitle: "Ventas por tienda",
              widgetType: "bar_chart",
            })
          }
        >
          Sim click
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/ChatSidebar", () => ({
  default: ({
    isOpen,
    onToggle,
    pendingModifyInput,
    pendingModifyTriggerId,
  }: {
    spec: DashboardSpec;
    onSpecUpdate: (s: DashboardSpec, prompt: string) => void;
    isOpen: boolean;
    onToggle: () => void;
    pendingModifyInput?: string;
    pendingModifyTriggerId?: number;
  }) => {
    chatSidebarCapture.pendingModifyInput = pendingModifyInput;
    chatSidebarCapture.pendingModifyTriggerId = pendingModifyTriggerId;
    return isOpen ? (
      <div
        data-testid="chat-sidebar"
        data-pending={pendingModifyInput ?? ""}
        data-trigger-id={pendingModifyTriggerId ?? ""}
      >
        <button type="button" onClick={onToggle}>
          Cerrar
        </button>
      </div>
    ) : null;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleSpec: DashboardSpec = {
  title: "Ventas Marzo",
  description: "Panel de ventas",
  widgets: [
    { type: "number", title: "Total", sql: "SELECT 1", format: "number" },
  ],
};

const dashboardRecord = {
  id: 1,
  name: "Mi Dashboard",
  description: "Descripcion del dashboard",
  spec: sampleSpec,
  created_at: "2026-04-01T10:00:00Z",
  updated_at: "2026-04-01T10:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ViewDashboard page", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockPush.mockReset();
    rendererProps.length = 0;
    mockSearchParamsRef.current = new URLSearchParams();
    chatSidebarCapture.pendingModifyInput = undefined;
    chatSidebarCapture.pendingModifyTriggerId = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("shows loading spinner initially", () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ViewDashboard />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders DashboardRenderer and controls after loading", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Dashboard name displayed
    expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();

    // Save button and AnalyzeLauncher (replaces old Modificar button)
    expect(screen.getByText("Guardar")).toBeInTheDocument();
    expect(screen.getByLabelText("Analizar con IA")).toBeInTheDocument();

    // Refresh controls
    expect(screen.getByLabelText("Actualizar")).toBeInTheDocument();
    expect(screen.getByTestId("auto-refresh-toggle")).toBeInTheDocument();

    // Export button
    expect(screen.getByText("Exportar")).toBeInTheDocument();

    // Last refreshed timestamp
    expect(screen.getByTestId("last-refreshed")).toBeInTheDocument();
  });

  it("chart drill-down opens chat sidebar with Spanish Modificar prefill", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("sim-chart-click"));

    const expected =
      "Detalle de Tienda 05 en Ventas por tienda: desglose por categoría, top artículos y tendencia";

    await waitFor(() => {
      expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("chat-sidebar")).toHaveAttribute("data-pending", expected);
    expect(screen.getByTestId("chat-sidebar")).toHaveAttribute("data-trigger-id", "1");
  });

  it("shows 404 when dashboard not found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText("Dashboard no encontrado"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Volver a la lista"),
    ).toBeInTheDocument();
  });

  it("shows dashboard name and breadcrumbs after loading", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    });

    // Breadcrumbs are rendered (default breadcrumbs from spec or fallback)
    expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    // Dashboard renderer is present
    expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
  });

  it("toggles chat sidebar via AnalyzeLauncher", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    });

    // Chat should not be visible initially (hideWhenClosed=true)
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();

    // AnalyzeLauncher is visible when sidebar is closed
    const launcher = screen.getByLabelText("Analizar con IA");
    expect(launcher).toBeInTheDocument();

    // Click launcher to open
    fireEvent.click(launcher);
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText("Error al cargar el dashboard"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Reintentar")).toBeInTheDocument();
  });

  it("allows inline name editing", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      // First call = GET (load dashboard), subsequent = PUT (save name)
      const record =
        callCount === 1
          ? dashboardRecord
          : { ...dashboardRecord, name: "Nuevo Nombre" };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(record),
      });
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    });

    // Click name to start editing
    fireEvent.click(screen.getByText("Mi Dashboard"));

    // Input should appear with current name
    const input = screen.getByDisplayValue("Mi Dashboard");
    expect(input).toBeInTheDocument();

    // Change name and blur to save
    fireEvent.change(input, { target: { value: "Nuevo Nombre" } });
    fireEvent.blur(input);

    // New name should be shown
    await waitFor(() => {
      expect(screen.getByText("Nuevo Nombre")).toBeInTheDocument();
    });
  });

  it("navigates to list from 404 page", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText("Dashboard no encontrado"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Volver a la lista"));
    expect(mockPush).toHaveBeenCalledWith("/");
  });

  // -----------------------------------------------------------------------
  // Auto-refresh tests
  // -----------------------------------------------------------------------

  it("increments refreshKey when Actualizar button is clicked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Initial refreshKey should be 0
    const renderer = screen.getByTestId("dashboard-renderer");
    expect(renderer.getAttribute("data-refresh-key")).toBe("0");

    // Click Actualizar
    fireEvent.click(screen.getByLabelText("Actualizar"));

    // refreshKey should now be 1
    await waitFor(() => {
      const updated = screen.getByTestId("dashboard-renderer");
      expect(updated.getAttribute("data-refresh-key")).toBe("1");
    });
  });

  it("shows interval selector when auto-refresh is toggled on", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Interval selector not visible initially
    expect(screen.queryByTestId("refresh-interval-select")).not.toBeInTheDocument();

    // Toggle auto-refresh on
    fireEvent.click(screen.getByTestId("auto-refresh-toggle"));

    // Interval selector appears
    expect(screen.getByTestId("refresh-interval-select")).toBeInTheDocument();

    // Countdown appears
    expect(screen.getByTestId("countdown")).toBeInTheDocument();
  });

  it("hides countdown when auto-refresh is toggled off", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Toggle on
    fireEvent.click(screen.getByTestId("auto-refresh-toggle"));
    expect(screen.getByTestId("countdown")).toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByTestId("auto-refresh-toggle"));
    expect(screen.queryByTestId("countdown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refresh-interval-select")).not.toBeInTheDocument();
  });

  it("auto-refreshes on interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    // With shouldAdvanceTime, waitFor works with fake timers
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Initial refreshKey = 0
    expect(
      screen.getByTestId("dashboard-renderer").getAttribute("data-refresh-key"),
    ).toBe("0");

    // Enable auto-refresh at 5 min
    fireEvent.click(screen.getByTestId("auto-refresh-toggle"));
    fireEvent.change(screen.getByTestId("refresh-interval-select"), {
      target: { value: "5" },
    });

    // Advance 5 minutes
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard-renderer").getAttribute("data-refresh-key"),
      ).toBe("1");
    });

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Export tests
  // -----------------------------------------------------------------------

  it("shows export dropdown with two options", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    // Dropdown not visible initially
    expect(screen.queryByText("Copiar datos")).not.toBeInTheDocument();

    // Click Exportar
    fireEvent.click(screen.getByText("Exportar"));

    // Dropdown options appear
    expect(screen.getByText("Copiar datos")).toBeInTheDocument();
    expect(screen.getByText("Imprimir / PDF")).toBeInTheDocument();
  });

  it("calls window.print when Imprimir / PDF is clicked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Exportar"));
    fireEvent.click(screen.getByText("Imprimir / PDF"));

    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("copies data to clipboard when Copiar datos is clicked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Exportar"));
    fireEvent.click(screen.getByText("Copiar datos"));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledOnce();
    });

    // The copied text should contain the spec title
    const copiedText = writeTextMock.mock.calls[0][0] as string;
    expect(copiedText).toContain("Ventas Marzo");
    expect(copiedText).toContain("Total");
  });
});
