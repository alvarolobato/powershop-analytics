// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ChatSidebar from "@/components/ChatSidebar";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseSpec: DashboardSpec = {
  title: "Test Dashboard",
  widgets: [
    {
      type: "number",
      title: "Total Ventas",
      sql: "SELECT SUM(total_si) AS value FROM ps_ventas",
      format: "currency",
    },
  ],
};

const onSpecUpdate = vi.fn() as unknown as (newSpec: DashboardSpec, prompt: string) => void;
const onToggle = vi.fn() as unknown as () => void;

function mockAnalyzeSuccess(response: string, suggestions: string[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ response, suggestions }),
  });
}

function mockAnalyzeError(status: number, body: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatSidebar — Analizar tab", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Tab rendering
  // -----------------------------------------------------------------------

  it("renders both tabs by default", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByTestId("tab-modificar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-analizar")).toBeInTheDocument();
  });

  it("Modificar tab is active by default", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByTestId("tab-modificar")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tab-analizar")).toHaveAttribute("aria-selected", "false");
  });

  it("switches to Analizar tab on click", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    expect(screen.getByTestId("tab-analizar")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tab-modificar")).toHaveAttribute("aria-selected", "false");
  });

  // -----------------------------------------------------------------------
  // Action buttons
  // -----------------------------------------------------------------------

  it("shows action buttons in Analizar tab", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    expect(screen.getByTestId("action-buttons-row")).toBeInTheDocument();
    expect(screen.getByText("Explícame los datos")).toBeInTheDocument();
    expect(screen.getByText("Plan de acción")).toBeInTheDocument();
    expect(screen.getByText("Detectar anomalías")).toBeInTheDocument();
    expect(screen.getByText("Comparar períodos")).toBeInTheDocument();
    expect(screen.getByText("Resumen ejecutivo")).toBeInTheDocument();
    expect(screen.getByText("Buenas prácticas")).toBeInTheDocument();
  });

  it("clicking an action button sends request with correct action", async () => {
    globalThis.fetch = mockAnalyzeSuccess("# Resumen\n\nVentas bien.", ["Pregunta 1"]);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    await act(async () => {
      fireEvent.click(screen.getByText("Explícame los datos"));
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/dashboard/analyze",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    // Verify the action was sent
    const callArg = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const body = JSON.parse(callArg.body);
    expect(body.action).toBe("explicar");
    expect(body.prompt).toBe("Explícame los datos del dashboard");
  });

  // -----------------------------------------------------------------------
  // Free-form question
  // -----------------------------------------------------------------------

  it("sends free-form question from text input", async () => {
    globalThis.fetch = mockAnalyzeSuccess("Respuesta al análisis.", ["Sugerencia 1"]);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    const textarea = screen.getByPlaceholderText(/Pregunta sobre los datos/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "¿Qué tienda vende más?" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    await waitFor(() => {
      expect(screen.getByText("¿Qué tienda vende más?")).toBeInTheDocument();
    });

    await waitFor(() => {
      // Markdown response rendered
      expect(screen.getByText(/Respuesta al análisis/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Suggestion chips
  // -----------------------------------------------------------------------

  it("shows suggestion chips after successful response", async () => {
    globalThis.fetch = mockAnalyzeSuccess("Respuesta", [
      "¿Cuál es la tienda líder?",
      "¿Qué producto tiene más margen?",
    ]);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explícame los datos"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("suggestion-chips")).toBeInTheDocument();
    });

    expect(screen.getByText("¿Cuál es la tienda líder?")).toBeInTheDocument();
    expect(screen.getByText("¿Qué producto tiene más margen?")).toBeInTheDocument();
  });

  it("clicking a suggestion chip auto-sends the question", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "Primera respuesta.",
            suggestions: ["¿Pregunta de seguimiento?"],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "Segunda respuesta.",
            suggestions: [],
          }),
      });
    globalThis.fetch = fetchMock;

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    // Trigger first response to get a suggestion chip
    await act(async () => {
      fireEvent.click(screen.getByText("Explícame los datos"));
    });

    await waitFor(() => {
      expect(screen.getByText("¿Pregunta de seguimiento?")).toBeInTheDocument();
    });

    // Click the chip
    await act(async () => {
      fireEvent.click(screen.getByText("¿Pregunta de seguimiento?"));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Second user message shown
    await waitFor(() => {
      expect(screen.getByText("¿Pregunta de seguimiento?")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Error states
  // -----------------------------------------------------------------------

  it("shows error message on API failure in Analizar tab", async () => {
    globalThis.fetch = mockAnalyzeError(500, {
      error: "No se pudo analizar el dashboard",
      code: "LLM_ERROR",
      requestId: "req_test",
      timestamp: "2026-04-05T10:00:00Z",
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    await act(async () => {
      fireEvent.click(screen.getByText("Explícame los datos"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo analizar el dashboard"),
      ).toBeInTheDocument();
    });
  });

  it("shows rate limit message for 429 errors", async () => {
    globalThis.fetch = mockAnalyzeError(429, {
      error: "Rate limit exceeded",
      code: "LLM_RATE_LIMIT",
      requestId: "req_rl",
      timestamp: "2026-04-05T10:00:00Z",
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    const textarea = screen.getByPlaceholderText(/Pregunta sobre los datos/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Test" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Límite de uso del modelo de IA alcanzado/),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Tab isolation — Modificar unchanged
  // -----------------------------------------------------------------------

  it("Modificar tab behavior is unchanged after switching to Analizar and back", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Switch to Analizar
    fireEvent.click(screen.getByTestId("tab-analizar"));
    expect(screen.queryByPlaceholderText(/ticket medio/i)).not.toBeInTheDocument();

    // Switch back to Modificar
    fireEvent.click(screen.getByTestId("tab-modificar"));
    expect(screen.getByPlaceholderText(/ticket medio/i)).toBeInTheDocument();
    expect(screen.queryByTestId("action-buttons-row")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Initial analyze messages
  // -----------------------------------------------------------------------

  it("loads initial analyze messages from prop", () => {
    const initialMessages = [
      {
        role: "user" as const,
        content: "¿Cómo van las ventas?",
        timestamp: new Date("2026-04-05T10:00:00Z"),
      },
      {
        role: "assistant" as const,
        content: "Las ventas van bien.",
        timestamp: new Date("2026-04-05T10:00:05Z"),
      },
    ];

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        initialAnalyzeMessages={initialMessages}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-analizar"));

    expect(screen.getByText("¿Cómo van las ventas?")).toBeInTheDocument();
    expect(screen.getByText(/Las ventas van bien/)).toBeInTheDocument();
  });
});
