// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ViewDashboard from "../dashboard/[id]/page";
import type { DashboardSpec } from "@/lib/schema";

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
  }: {
    spec: DashboardSpec;
    refreshKey?: number;
  }) => {
    rendererProps.push({ refreshKey });
    return (
      <div data-testid="dashboard-renderer" data-refresh-key={refreshKey}>
        {spec.title}
      </div>
    );
  },
}));

vi.mock("@/components/ChatSidebar", () => ({
  default: ({
    isOpen,
    onToggle,
  }: {
    spec: DashboardSpec;
    onSpecUpdate: (s: DashboardSpec, prompt: string) => void;
    isOpen: boolean;
    onToggle: () => void;
  }) =>
    isOpen ? (
      <div data-testid="chat-sidebar">
        <button onClick={onToggle}>Cerrar</button>
      </div>
    ) : null,
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

    // Back button
    expect(screen.getByLabelText("Volver")).toBeInTheDocument();

    // Save and Modify buttons
    expect(screen.getByText("Guardar")).toBeInTheDocument();
    expect(screen.getByText("Modificar")).toBeInTheDocument();

    // Refresh controls
    expect(screen.getByText("Actualizar")).toBeInTheDocument();
    expect(screen.getByTestId("auto-refresh-toggle")).toBeInTheDocument();

    // Export button
    expect(screen.getByText("Exportar")).toBeInTheDocument();

    // Last refreshed timestamp
    expect(screen.getByTestId("last-refreshed")).toBeInTheDocument();
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

  it("navigates back on Volver button click", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Volver"));
    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("toggles chat sidebar on Modificar button click", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardRecord),
    });

    render(<ViewDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Mi Dashboard")).toBeInTheDocument();
    });

    // Chat should not be visible initially
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();

    // Click Modificar to open
    fireEvent.click(screen.getByText("Modificar"));
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();

    // Button text changes
    expect(screen.getByText("Cerrar chat")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Actualizar"));

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
