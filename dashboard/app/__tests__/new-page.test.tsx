// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import NewDashboard from "../dashboard/new/page";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generatedSpec: DashboardSpec = {
  title: "Ventas Marzo 2026",
  description: "Panel de ventas",
  widgets: [
    {
      type: "number",
      title: "Total",
      sql: "SELECT 1",
      format: "number",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewDashboard page", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPush.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders prompt textarea and generate button", () => {
    render(<NewDashboard />);

    expect(
      screen.getByPlaceholderText("Describe el dashboard que necesitas..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Generar Dashboard")).toBeInTheDocument();
  });

  it("disables generate button when prompt is empty", () => {
    render(<NewDashboard />);

    const btn = screen.getByText("Generar Dashboard");
    expect(btn).toBeDisabled();
  });

  it("enables generate button when prompt has text", async () => {
    render(<NewDashboard />);

    const textarea = screen.getByPlaceholderText(
      "Describe el dashboard que necesitas...",
    );
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Dashboard de ventas" },
      });
    });

    expect(screen.getByText("Generar Dashboard")).not.toBeDisabled();
  });

  it("generates and saves dashboard, then redirects", async () => {
    const fetchMock = vi.fn()
      // First call: generate
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(generatedSpec),
      })
      // Second call: save
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 42, ...generatedSpec }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);

    const textarea = screen.getByPlaceholderText(
      "Describe el dashboard que necesitas...",
    );

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Ventas del mes" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Generar Dashboard"));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/42");
    });

    // Verify both API calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/dashboard/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: "Ventas del mes" }),
      }),
    );
  });

  it("shows loading spinner while generating", async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText("Describe el dashboard que necesitas..."),
        { target: { value: "Test" } },
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Generar Dashboard"));
    });

    expect(screen.getByText("Generando...")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error message on generation failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "LLM error: timeout" }),
    });

    render(<NewDashboard />);

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText("Describe el dashboard que necesitas..."),
        { target: { value: "Test" } },
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Generar Dashboard"));
    });

    await waitFor(() => {
      expect(screen.getByText("LLM error: timeout")).toBeInTheDocument();
    });

    // Button should be re-enabled for retry
    expect(screen.getByText("Generar Dashboard")).not.toBeDisabled();
  });
});
