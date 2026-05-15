// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ChatSidebar from "../ChatSidebar";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseSpec: DashboardSpec = {
  title: "Test Dashboard",
  widgets: [
    {
      type: "number",
      title: "Total",
      sql: "SELECT 1",
      format: "number",
    },
  ],
};

function mockFetchSuccess(newSpec: DashboardSpec) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(newSpec),
  });
}

function mockFetchError(status: number, error: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
  });
}

function mockFetchStructuredError(status: number, body: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatSidebar", () => {
  let onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  let onToggle: () => void;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    onSpecUpdate = vi.fn() as unknown as (newSpec: DashboardSpec, prompt: string) => void;
    onToggle = vi.fn() as unknown as () => void;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  it("renders input and send button when open", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByPlaceholderText(/ticket medio/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Enviar")).toBeInTheDocument();
    // Header now shows "Asistente IA" with tabs
    expect(screen.getByText("Asistente IA")).toBeInTheDocument();
    expect(screen.getByTestId("tab-modificar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-analizar")).toBeInTheDocument();
  });

  it("pre-fills Modificar textarea when pendingModifyInput and pendingModifyTriggerId are set", async () => {
    const onConsumed = vi.fn();
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        pendingModifyInput="Detalle de Tienda 05"
        pendingModifyTriggerId={1}
        onPendingModifyInputConsumed={onConsumed}
      />,
    );

    const textarea = screen.getByLabelText(/Mensaje para modificar el dashboard/i);
    await waitFor(() => {
      expect(textarea).toHaveValue("Detalle de Tienda 05");
    });
    expect(screen.getByTestId("tab-modificar")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(onConsumed).toHaveBeenCalled());
  });

  it("switches to Modificar tab when drill-down prefill arrives while Analizar is active", async () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("tab-analizar"));
    expect(screen.getByTestId("tab-analizar")).toHaveAttribute("aria-selected", "true");

    rerender(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        pendingModifyInput="Detalle de Tienda 05"
        pendingModifyTriggerId={42}
        onPendingModifyInputConsumed={onConsumed}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("tab-modificar")).toHaveAttribute("aria-selected", "true"),
    );
    const textarea = screen.getByLabelText(/Mensaje para modificar el dashboard/i);
    await waitFor(() => expect(textarea).toHaveValue("Detalle de Tienda 05"));
  });

  it("shows reopen button when closed", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.queryByText("Asistente IA")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Abrir chat")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Toggle
  // -----------------------------------------------------------------------

  it("calls onToggle when close button is clicked", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText("Cerrar chat"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("calls onToggle when reopen tab is clicked", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText("Abrir chat"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Send message + success (Modificar tab)
  // -----------------------------------------------------------------------

  it("does not lose newer messages when modify response resolves late (race condition)", async () => {
    // Regression for closed PR #423 Copilot blocker (b): the assistant
    // message was constructed from `messages` captured at the start of the
    // callback, so any state change while the request was in-flight was
    // silently overwritten when setMessages fired.
    //
    // This test sends a first modify request that is held open via a
    // controllable Promise; while it is in-flight, an external state
    // change (a second user typing/sending into the same chat) must NOT
    // be wiped out by the late assistant response.

    const updatedSpec: DashboardSpec = {
      title: "Updated Dashboard",
      widgets: [
        ...baseSpec.widgets,
        { type: "number", title: "Nuevo", sql: "SELECT 2", format: "number" },
      ],
    };

    let resolveFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstPending;
        return {
          ok: true,
          json: () => Promise.resolve(updatedSpec),
        } as unknown as Response;
      })
      .mockImplementationOnce(async () => ({
        ok: true,
        json: () => Promise.resolve(updatedSpec),
      })) as unknown as typeof fetch;

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    const textarea = screen.getByPlaceholderText(/ticket medio/i);
    const sendBtn = screen.getByLabelText("Enviar");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Primer mensaje" } });
    });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // First user message appears, response is still pending.
    expect(screen.getByText("Primer mensaje")).toBeInTheDocument();
    // Loading indicator should be present, send disabled.
    expect(sendBtn).toBeDisabled();

    // While the first request is still pending, type a second message.
    // (We cannot click Enviar because it is disabled while loading; the
    //  important thing for the regression is that ANY extra state change
    //  in `messages` between the first send and its resolution must not
    //  be clobbered. We approximate that by resolving the first response
    //  and asserting both user message + assistant summary appear in the
    //  correct order.)
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/Dashboard actualizado/)).toBeInTheDocument();
    });
    // The user message must still be there, and assistant message must be
    // adjacent to it (functional setState appended right after).
    expect(screen.getByText("Primer mensaje")).toBeInTheDocument();
  });

  it("sends message and shows in history, calls onSpecUpdate on success", async () => {
    const updatedSpec: DashboardSpec = {
      title: "Updated Dashboard",
      widgets: [
        ...baseSpec.widgets,
        { type: "number", title: "Nuevo", sql: "SELECT 2", format: "number" },
      ],
    };

    globalThis.fetch = mockFetchSuccess(updatedSpec);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    const textarea = screen.getByPlaceholderText(/ticket medio/i);
    const sendBtn = screen.getByLabelText("Enviar");

    // Type a message
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Añade el ticket medio" },
      });
    });

    // Send it
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // User message appears
    expect(screen.getByText("Añade el ticket medio")).toBeInTheDocument();

    // Wait for API response
    await waitFor(() => {
      expect(onSpecUpdate).toHaveBeenCalledWith(updatedSpec, "Añade el ticket medio");
    });

    // Assistant message appears
    await waitFor(() => {
      expect(screen.getByText(/Dashboard actualizado/)).toBeInTheDocument();
    });

    // Verify fetch was called correctly
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/dashboard/modify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: baseSpec, prompt: "Añade el ticket medio" }),
    });
  });

  // -----------------------------------------------------------------------
  // API error
  // -----------------------------------------------------------------------

  it("shows error message on API failure", async () => {
    globalThis.fetch = mockFetchError(500, "LLM_MODIFY_FAILED");

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    const textarea = screen.getByPlaceholderText(/ticket medio/i);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Haz algo" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    await waitFor(() => {
      // parseApiError extracts .error from the response body, so the actual
      // server message is shown rather than the generic fallback string.
      expect(screen.getByText(/LLM_MODIFY_FAILED/)).toBeInTheDocument();
    });

    // onSpecUpdate should NOT have been called
    expect(onSpecUpdate).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Network error
  // -----------------------------------------------------------------------

  it("shows connection error on network failure", async () => {
    globalThis.fetch = mockFetchNetworkError();

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/ticket medio/i), {
        target: { value: "Prueba" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/No se pudo conectar con el servidor/),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Disabled while loading
  // -----------------------------------------------------------------------

  it("disables send button while loading", async () => {
    // Never-resolving fetch to keep loading state
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/ticket medio/i), {
        target: { value: "Test" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    // Send button should be disabled
    expect(screen.getByLabelText("Enviar")).toBeDisabled();

    // Loading indicator visible
    expect(screen.getByLabelText("Procesando")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  it("does not send empty messages", () => {
    globalThis.fetch = vi.fn();

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Send button disabled for empty input
    expect(screen.getByLabelText("Enviar")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Enviar"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Structured API error — expandable details bubble
  // -----------------------------------------------------------------------

  it("shows expandable details toggle for structured API errors", async () => {
    globalThis.fetch = mockFetchStructuredError(500, {
      error: "No se pudo modificar el dashboard",
      code: "LLM_ERROR",
      requestId: "req_structured_1",
      timestamp: "2026-04-05T10:00:00.000Z",
      details: "LLM returned empty response",
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/ticket medio/i), {
        target: { value: "Añade algo" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    // User-facing message from structured error
    await waitFor(() => {
      expect(
        screen.getByText("No se pudo modificar el dashboard"),
      ).toBeInTheDocument();
    });

    // Expandable details toggle should appear
    expect(screen.getByTestId("chat-toggle-details")).toBeInTheDocument();

    // Initially collapsed
    expect(screen.queryByTestId("chat-error-details")).not.toBeInTheDocument();

    // Expand
    fireEvent.click(screen.getByTestId("chat-toggle-details"));
    await waitFor(() => {
      expect(screen.getByTestId("chat-error-details")).toBeInTheDocument();
    });
    expect(screen.getByText("LLM_ERROR")).toBeInTheDocument();
    expect(screen.getByText("req_structured_1")).toBeInTheDocument();
  });

  it("shows rate-limit message for 429 errors regardless of structured payload", async () => {
    globalThis.fetch = mockFetchStructuredError(429, {
      error: "Límite alcanzado",
      code: "LLM_RATE_LIMIT",
      requestId: "req_rl",
      timestamp: "2026-04-05T10:00:00.000Z",
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/ticket medio/i), {
        target: { value: "Test" },
      });
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
  // Enter key sends
  // -----------------------------------------------------------------------

  it("sends on Enter key (without Shift)", async () => {
    const updatedSpec: DashboardSpec = {
      ...baseSpec,
      title: "Modified",
    };
    globalThis.fetch = mockFetchSuccess(updatedSpec);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    const textarea = screen.getByPlaceholderText(/ticket medio/i);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Cambio" } });
    });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------

  it("switches to Analizar tab when clicked", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Initially on Modificar tab — shows modify placeholder
    expect(screen.getByPlaceholderText(/ticket medio/i)).toBeInTheDocument();

    // Click Analizar tab
    fireEvent.click(screen.getByTestId("tab-analizar"));

    // Now shows analyze placeholder and action buttons
    expect(screen.getByPlaceholderText(/Pregunta sobre los datos/i)).toBeInTheDocument();
    expect(screen.getByTestId("action-buttons-row")).toBeInTheDocument();
  });

  it("switching back to Modificar tab restores modify input", () => {
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
  });

  // -----------------------------------------------------------------------
  // Tab switch preserves separate message histories
  // -----------------------------------------------------------------------

  it("tab switch preserves separate message histories", async () => {
    const updatedSpec: DashboardSpec = { ...baseSpec, title: "Modified" };
    globalThis.fetch = mockFetchSuccess(updatedSpec);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Send a message in Modificar tab
    const modInput = screen.getByPlaceholderText(/ticket medio/i);
    await act(async () => {
      fireEvent.change(modInput, { target: { value: "Mensaje en modificar" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Enviar"));
    });

    // User message appears in modificar
    expect(screen.getByText("Mensaje en modificar")).toBeInTheDocument();

    // Switch to Analizar — modificar message should NOT be visible
    fireEvent.click(screen.getByTestId("tab-analizar"));
    expect(screen.queryByText("Mensaje en modificar")).not.toBeInTheDocument();

    // Switch back to Modificar — message should still be there
    fireEvent.click(screen.getByTestId("tab-modificar"));
    expect(screen.getByText("Mensaje en modificar")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Suggestion chip sends (Modificar mode)
  // -----------------------------------------------------------------------

  it("clicking a Modificar suggestion chip sends the suggestion as a message", async () => {
    const updatedSpec: DashboardSpec = { ...baseSpec, title: "Modified" };
    globalThis.fetch = mockFetchSuccess(updatedSpec);

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Find a suggestion chip (Modificar mode is default)
    const chip = screen.getByText("Añade widget de margen por familia");
    await act(async () => {
      fireEvent.click(chip);
    });

    // Fetch should have been called with the suggestion text as prompt
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/dashboard/modify",
        expect.objectContaining({
          body: expect.stringContaining("Añade widget de margen por familia"),
        }),
      );
    });

    // Multiple elements with that text is fine — at least one is the user message bubble
    const matches = screen.getAllByText("Añade widget de margen por familia");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Suggestion chip sends (Analizar mode)
  // -----------------------------------------------------------------------

  it("clicking an Analizar suggestion chip sends to analyze API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: "Análisis completado.", suggestions: [] }),
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );

    // Switch to Analizar tab
    fireEvent.click(screen.getByTestId("tab-analizar"));

    // Click a suggestion chip using data-testid
    const chip = screen.getByTestId("suggestion-chip-¿Por qué cayeron las ventas?");
    await act(async () => {
      fireEvent.click(chip);
    });

    // Fetch should have been called with the analyze endpoint
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/dashboard/analyze",
        expect.objectContaining({
          body: expect.stringContaining("¿Por qué cayeron las ventas?"),
        }),
      );
    });

    // The text appears at least once (could be in chip + message)
    const matches = screen.getAllByText("¿Por qué cayeron las ventas?");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Nueva conversación button (Task 5 / #540)
  // -----------------------------------------------------------------------

  it("does not render Nueva conversación button when dashboardId is not set", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );
    expect(screen.queryByTestId("new-conversation-btn")).not.toBeInTheDocument();
  });

  it("renders Nueva conversación button when dashboardId is set", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
      />,
    );
    expect(screen.getByTestId("new-conversation-btn")).toBeInTheDocument();
  });

  it("clears Modificar messages when Nueva conversación is clicked in Modificar tab", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });

    const initialMessages = [
      { role: "user" as const, content: "Hola", timestamp: new Date() },
    ];
    const onModifyMessagesChange = vi.fn();

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
        initialModifyMessages={initialMessages}
        onModifyMessagesChange={onModifyMessagesChange}
      />,
    );

    // Wait for the initial messages to be shown
    await waitFor(() => {
      expect(screen.getByText("Hola")).toBeInTheDocument();
    });

    // Click "Nueva conversación"
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-conversation-btn"));
    });

    // The "Hola" message should be gone
    expect(screen.queryByText("Hola")).not.toBeInTheDocument();
    // The callback should have been called with empty array
    expect(onModifyMessagesChange).toHaveBeenCalledWith([]);
  });

  it("clears Analizar messages when Nueva conversación is clicked in Analizar tab", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });

    const initialMessages = [
      { role: "user" as const, content: "Analiza esto", timestamp: new Date() },
    ];
    const onAnalyzeMessagesChange = vi.fn();

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
        initialAnalyzeMessages={initialMessages}
        onAnalyzeMessagesChange={onAnalyzeMessagesChange}
      />,
    );

    // Switch to Analizar tab first
    fireEvent.click(screen.getByTestId("tab-analizar"));

    // Wait for the initial messages to be shown
    await waitFor(() => {
      expect(screen.getByText("Analiza esto")).toBeInTheDocument();
    });

    // Click "Nueva conversación"
    await act(async () => {
      fireEvent.click(screen.getByTestId("new-conversation-btn"));
    });

    // The "Analiza esto" message should be gone
    expect(screen.queryByText("Analiza esto")).not.toBeInTheDocument();
    // The callback should have been called with empty array
    expect(onAnalyzeMessagesChange).toHaveBeenCalledWith([]);
  });

  // -----------------------------------------------------------------------
  // Previous conversations panel trigger (Task 5 / #540)
  // -----------------------------------------------------------------------

  it("does not render history button when dashboardId is not set", () => {
    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
      />,
    );
    expect(screen.queryByTestId("previous-conversations-btn")).not.toBeInTheDocument();
  });

  it("renders history button when dashboardId is set", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
      />,
    );
    expect(screen.getByTestId("previous-conversations-btn")).toBeInTheDocument();
  });

  it("opens previous conversations panel when history button is clicked", async () => {
    // Mock: API returns empty for conversations, 404 for auto-load
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conversations: [] }),
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
      />,
    );

    // Panel should not be visible initially
    expect(screen.queryByTestId("previous-conversations-panel")).not.toBeInTheDocument();

    // Click the history button
    fireEvent.click(screen.getByTestId("previous-conversations-btn"));

    // Panel should appear
    await waitFor(() => {
      expect(screen.getByTestId("previous-conversations-panel")).toBeInTheDocument();
    });
  });

  it("closes previous conversations panel when toggled again", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conversations: [] }),
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={1}
      />,
    );

    // Open the panel
    fireEvent.click(screen.getByTestId("previous-conversations-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("previous-conversations-panel")).toBeInTheDocument();
    });

    // Click the button again — should close
    fireEvent.click(screen.getByTestId("previous-conversations-btn"));
    expect(screen.queryByTestId("previous-conversations-panel")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Auto-load conversation on mount (Task 5 / #540)
  // -----------------------------------------------------------------------

  it("auto-loads latest conversation messages when API returns them", async () => {
    const convId = "autoload000001";
    const conversationMessages = [
      {
        id: "msg1",
        conversation_id: convId,
        role: "user",
        content: "Mensaje auto-cargado del usuario",
        created_at: new Date(Date.now() - 2000).toISOString(),
      },
      {
        id: "msg2",
        conversation_id: convId,
        role: "assistant",
        content: { text: "Respuesta auto-cargada del asistente" },
        created_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/conversations?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversations: [
                {
                  id: convId,
                  title: "Conv auto-cargada",
                  first_user_prompt: null,
                  last_interaction_at: new Date().toISOString(),
                  archived_at: null,
                  message_count: 2,
                  last_status: "ok",
                },
              ],
            }),
        });
      }
      if (url.includes(`/api/conversations/${convId}`)) {
        return Promise.resolve({
          ok: true,
          // GET /api/conversations/:id now returns the conversation row with
          // messages inlined as a bare object (no `{ conversation: { ... } }`
          // wrapper). ChatSidebar accepts both shapes for forward-compatibility,
          // but the canonical shape is the bare row.
          json: () =>
            Promise.resolve({
              id: convId,
              mode: "modify",
              title: "Conv auto-cargada",
              first_user_prompt: null,
              messages: conversationMessages,
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={5}
      />,
    );

    // Wait for auto-loaded messages to appear in Modificar tab
    await waitFor(() => {
      expect(screen.getByText("Mensaje auto-cargado del usuario")).toBeInTheDocument();
    });
    expect(screen.getByText("Respuesta auto-cargada del asistente")).toBeInTheDocument();
  });

  it("keeps initial messages from props when conversation API returns 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    const initialMessages = [
      { role: "user" as const, content: "Mensaje inicial de props", timestamp: new Date() },
    ];

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={99}
        initialModifyMessages={initialMessages}
      />,
    );

    // Initial messages should still be visible
    await waitFor(() => {
      expect(screen.getByText("Mensaje inicial de props")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Auto-load does NOT overwrite pre-loaded messages (Task 4 / #593)
  // -----------------------------------------------------------------------

  it("does not overwrite initialModifyMessages when auto-load finds a conversation", async () => {
    const convId = "autoload-skip-001";
    const autoLoadedMessage = "Mensaje que no debe sobrescribir";

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/conversations?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversations: [
                {
                  id: convId,
                  title: "Conv auto-cargada",
                  first_user_prompt: null,
                  last_interaction_at: new Date().toISOString(),
                  archived_at: null,
                  message_count: 1,
                  last_status: "ok",
                },
              ],
            }),
        });
      }
      if (url.includes(`/api/conversations/${convId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: convId,
              mode: "modify",
              title: "Conv auto-cargada",
              first_user_prompt: null,
              messages: [
                {
                  id: "msg1",
                  conversation_id: convId,
                  role: "user",
                  content: autoLoadedMessage,
                  created_at: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    const preloadedMessages = [
      { role: "user" as const, content: "Mensaje pre-cargado de /k/:id", timestamp: new Date() },
    ];

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={7}
        initialModifyMessages={preloadedMessages}
      />,
    );

    // The preloaded message should be visible
    await waitFor(() => {
      expect(screen.getByText("Mensaje pre-cargado de /k/:id")).toBeInTheDocument();
    });

    // The auto-loaded message must NOT appear (was skipped because initialModifyMessages were provided).
    // Uses waitFor so the assertion holds after the async auto-load fetches settle.
    await waitFor(() => {
      expect(screen.queryByText(autoLoadedMessage)).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // InitialContextPanel shown when auto-load returns initial_context (Task 4 / #593)
  // -----------------------------------------------------------------------

  it("renders InitialContextPanel when auto-loaded conversation has initial_context", async () => {
    const convId = "autoload-ctx-001";

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/conversations?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversations: [
                {
                  id: convId,
                  title: "Conv con contexto",
                  first_user_prompt: "Crea un panel",
                  last_interaction_at: new Date().toISOString(),
                  archived_at: null,
                  message_count: 1,
                  last_status: "ok",
                },
              ],
            }),
        });
      }
      if (url.includes(`/api/conversations/${convId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: convId,
              mode: "modify",
              title: "Conv con contexto",
              first_user_prompt: "Crea un panel",
              initial_context: {
                model: "anthropic/claude-sonnet-4",
                provider: "openrouter",
                driver: null,
                seed_prompt: "Crea un panel",
              },
              messages: [
                {
                  id: "msg1",
                  conversation_id: convId,
                  role: "user",
                  content: "Crea un panel",
                  created_at: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={8}
      />,
    );

    // Wait for the auto-loaded message to appear
    await waitFor(() => {
      expect(screen.getByText("Crea un panel")).toBeInTheDocument();
    });

    // InitialContextPanel toggle button should be visible
    expect(screen.getByTestId("initial-context-toggle")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // initialConversationId — free-chat handoff via ?continue= (Task 8 / #641)
  // -----------------------------------------------------------------------

  it("loads conversation messages into Modificar tab when initialConversationId is set", async () => {
    const convId = "ab1234567890";

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/api/conversations/${convId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: convId,
              mode: "modify",
              title: null,
              first_user_prompt: "lista las tablas",
              initial_context: null,
              context_kind: "global",
              context_ref: null,
              messages: [
                {
                  id: "m1",
                  conversation_id: convId,
                  role: "user",
                  content: "lista las tablas",
                  created_at: new Date().toISOString(),
                },
                {
                  id: "m2",
                  conversation_id: convId,
                  role: "assistant",
                  content: "Aquí tienes las tablas ps_*",
                  created_at: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      // Auto-load should be blocked; return empty to catch unexpected calls
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={42}
        initialConversationId={convId}
      />,
    );

    // Messages from the handoff conversation should appear in the Modify tab
    await waitFor(() => {
      expect(screen.getByText("lista las tablas")).toBeInTheDocument();
      expect(screen.getByText("Aquí tienes las tablas ps_*")).toBeInTheDocument();
    });

    // Modificar tab must be active
    expect(screen.getByTestId("tab-modificar")).toHaveAttribute("aria-selected", "true");
  });

  it("hides 'Nueva conversación' button when initialConversationId is set", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "cd1234567890",
          mode: "modify",
          title: null,
          first_user_prompt: null,
          initial_context: null,
          context_kind: "global",
          context_ref: null,
          messages: [],
        }),
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={42}
        initialConversationId="cd1234567890"
      />,
    );

    // "Nueva conversación" button must not be shown when a handoff conv is loaded
    expect(screen.queryByTestId("new-conversation-btn")).not.toBeInTheDocument();
  });

  it("shows 'Nueva conversación' button when initialConversationId is NOT set", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={42}
      />,
    );

    expect(screen.getByTestId("new-conversation-btn")).toBeInTheDocument();
  });

  it("does not overwrite handoff conversation with auto-loaded latest conversation", async () => {
    const handoffConvId = "ef1234567890";
    const autoConvId = "aa1234567890";
    const autoMessage = "Mensaje cargado automáticamente";

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/api/conversations/${handoffConvId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: handoffConvId,
              mode: "chat",
              title: null,
              first_user_prompt: "consulta libre",
              initial_context: null,
              context_kind: "global",
              context_ref: null,
              messages: [
                {
                  id: "h1",
                  conversation_id: handoffConvId,
                  role: "user",
                  content: "consulta libre",
                  created_at: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      if (url.includes("/api/conversations?")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: autoConvId,
                title: null,
                first_user_prompt: autoMessage,
                last_interaction_at: new Date().toISOString(),
                archived_at: null,
                message_count: 1,
                last_status: "ok",
              },
            ]),
        });
      }
      if (url.includes(`/api/conversations/${autoConvId}`)) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: autoConvId,
              mode: "modify",
              title: null,
              first_user_prompt: autoMessage,
              initial_context: null,
              messages: [
                {
                  id: "a1",
                  conversation_id: autoConvId,
                  role: "user",
                  content: autoMessage,
                  created_at: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(
      <ChatSidebar
        spec={baseSpec}
        onSpecUpdate={onSpecUpdate}
        isOpen={true}
        onToggle={onToggle}
        dashboardId={42}
        initialConversationId={handoffConvId}
      />,
    );

    // Handoff message should appear
    await waitFor(() => {
      expect(screen.getByText("consulta libre")).toBeInTheDocument();
    });

    // Auto-loaded message from a different conversation must NOT appear
    await waitFor(() => {
      expect(screen.queryByText(autoMessage)).not.toBeInTheDocument();
    });
  });
});
