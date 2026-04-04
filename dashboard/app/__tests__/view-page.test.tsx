// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ViewDashboard from "../dashboard/[id]/page";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockId = "1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: mockId }),
}));

// ---------------------------------------------------------------------------
// Mock DashboardRenderer and ChatSidebar to avoid complex rendering
// ---------------------------------------------------------------------------

vi.mock("@/components/DashboardRenderer", () => ({
  DashboardRenderer: ({ spec }: { spec: DashboardSpec }) => (
    <div data-testid="dashboard-renderer">{spec.title}</div>
  ),
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
    mockPush.mockReset();
  });

  afterEach(() => {
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
});
