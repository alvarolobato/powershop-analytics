// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import InicioPage from "../inicio/page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/inicio",
}));

vi.mock("@/components/DashboardRenderer", () => ({
  DashboardRenderer: ({ spec }: { spec: { title: string } }) => (
    <div data-testid="dashboard-renderer">{spec.title}</div>
  ),
}));

vi.mock("@/components/DataFreshnessBanner", () => ({
  DataFreshnessBanner: () => (
    <div data-testid="data-freshness-banner" />
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InicioPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders without error", () => {
    expect(() => render(<InicioPage />)).not.toThrow();
  });

  it("renders the DashboardRenderer with the inicio spec title", () => {
    render(<InicioPage />);
    expect(screen.getByTestId("dashboard-renderer")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-renderer")).toHaveTextContent(
      "Pantalla de Inicio — Estado del Negocio",
    );
  });

  it("renders the DataFreshnessBanner", () => {
    render(<InicioPage />);
    expect(screen.getByTestId("data-freshness-banner")).toBeInTheDocument();
  });

  it("shows the page heading 'Estado del Negocio'", () => {
    render(<InicioPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Estado del Negocio",
    );
  });

  it("shows the refresh button", () => {
    render(<InicioPage />);
    expect(screen.getByTestId("inicio-refresh-btn")).toBeInTheDocument();
  });

  it("does not render a chat sidebar or save button", () => {
    render(<InicioPage />);
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /guardar/i }),
    ).not.toBeInTheDocument();
  });
});
