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
    fireEvent.click(screen.getByTestId("creation-tab-free"));

    expect(
      screen.getByPlaceholderText("Describe el dashboard que necesitas..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Generar Dashboard")).toBeInTheDocument();
  });

  it("disables generate button when prompt is empty", () => {
    render(<NewDashboard />);
    fireEvent.click(screen.getByTestId("creation-tab-free"));

    const btn = screen.getByText("Generar Dashboard");
    expect(btn).toBeDisabled();
  });

  it("enables generate button when prompt has text", async () => {
    render(<NewDashboard />);
    fireEvent.click(screen.getByTestId("creation-tab-free"));

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
      // data-health call from DataFreshnessBanner (no specific order guaranteed)
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tables: [], overallStale: false, stalestTable: null }),
      });

    // Override specific calls for generate and save
    fetchMock
      .mockResolvedValueOnce({
        // data-health
        ok: true,
        json: () => Promise.resolve({ tables: [], overallStale: false, stalestTable: null }),
      })
      .mockResolvedValueOnce({
        // generate
        ok: true,
        json: () => Promise.resolve(generatedSpec),
      })
      .mockResolvedValueOnce({
        // save
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 42, ...generatedSpec }),
      });
    globalThis.fetch = fetchMock;

    render(<NewDashboard />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("creation-tab-free"));
    });

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

    // Verify generate and save API calls were made
    const generateCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/dashboard/generate"
    );
    expect(generateCall).toBeDefined();
    expect(generateCall![1]).toEqual(
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
      fireEvent.click(screen.getByTestId("creation-tab-free"));
    });

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
      fireEvent.click(screen.getByTestId("creation-tab-free"));
    });

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
