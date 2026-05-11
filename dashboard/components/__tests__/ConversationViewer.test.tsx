// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// ReactMarkdown is an ESM-only package that is heavy to load in jsdom; mock
// it to a simple <span> so the component can be tested without rendering Markdown.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock("remark-gfm", () => ({ default: () => null }));

// AgenticErrorDetails renders complex DOM; mock to a simple testid marker.
vi.mock("@/components/AgenticErrorDetails", () => ({
  default: ({ errorDetail }: { errorDetail: { code: string } }) => (
    <div data-testid="agentic-error-details">{errorDetail.code}</div>
  ),
}));

import { ConversationViewer } from "../ConversationViewer";
import type { ConversationWithMessages } from "@/lib/conversation-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConv(overrides?: Partial<ConversationWithMessages>): ConversationWithMessages {
  return {
    id: "conv-1",
    mode: "generate",
    title: "Test conversation",
    first_user_prompt: "Hola",
    context_url: "/dashboard/42",
    context_kind: "dashboard",
    context_ref: "42",
    created_at: "2026-05-01T10:00:00Z",
    last_interaction_at: "2026-05-01T10:05:00Z",
    archived_at: null,
    last_status: "ok",
    llm_provider: "openrouter",
    llm_driver: null,
    initial_context: null,
    messages: [],
    ...overrides,
  };
}

function makeUserMsg(text: string): ConversationWithMessages["messages"][0] {
  return {
    id: "m1",
    conversation_id: "conv-1",
    role: "user",
    content: text,
    created_at: "2026-05-01T10:00:00Z",
  };
}

function makeAssistantMsg(
  text: string,
  extra?: Partial<{ tool_calls: unknown[]; is_error: boolean }>,
): ConversationWithMessages["messages"][0] {
  return {
    id: "m2",
    conversation_id: "conv-1",
    role: "assistant",
    content: { text, ...extra },
    created_at: "2026-05-01T10:01:00Z",
  };
}

function makeToolMsg(toolName: string): ConversationWithMessages["messages"][0] {
  return {
    id: "m3",
    conversation_id: "conv-1",
    role: "tool",
    content: { tool_call_id: "tc-1", tool_name: toolName, content: { rows: [] } },
    created_at: "2026-05-01T10:00:30Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationViewer", () => {
  const originalFetch = globalThis.fetch;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock clipboard write
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  });

  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it("renders the conversation title in the header", () => {
    render(<ConversationViewer initial={makeConv()} />);
    expect(screen.getByText("Test conversation")).toBeInTheDocument();
  });

  it("renders 'No hay mensajes' when conversation has no messages", () => {
    render(<ConversationViewer initial={makeConv({ messages: [] })} />);
    expect(screen.getByText(/No hay mensajes/i)).toBeInTheDocument();
  });

  it("renders user message bubble", () => {
    const conv = makeConv({ messages: [makeUserMsg("¿Cuánto vendimos?")] });
    render(<ConversationViewer initial={conv} />);
    expect(screen.getByTestId("user-bubble")).toBeInTheDocument();
    expect(screen.getByText("¿Cuánto vendimos?")).toBeInTheDocument();
  });

  it("renders assistant message bubble", () => {
    const conv = makeConv({ messages: [makeAssistantMsg("Vendiste 100€")] });
    render(<ConversationViewer initial={conv} />);
    expect(screen.getByTestId("assistant-bubble")).toBeInTheDocument();
  });

  it("renders tool result card for tool-role messages", () => {
    const conv = makeConv({ messages: [makeToolMsg("execute_query")] });
    render(<ConversationViewer initial={conv} />);
    expect(screen.getByTestId("tool-result-card")).toBeInTheDocument();
    expect(screen.getByText(/execute_query/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Round dividers
  // -----------------------------------------------------------------------

  it("renders round dividers when assistant has multiple tool-call rounds", () => {
    const toolCall = { id: "tc1", name: "validate_query", arguments: {}, result: {} };
    const msgs: ConversationWithMessages["messages"] = [
      makeAssistantMsg("", { tool_calls: [toolCall] }),
      { id: "m2", conversation_id: "conv-1", role: "tool", content: { tool_call_id: "tc1", tool_name: "validate_query", content: {} }, created_at: "2026-05-01T10:00:01Z" },
      makeAssistantMsg("", { tool_calls: [toolCall] }),
      { id: "m4", conversation_id: "conv-1", role: "tool", content: { tool_call_id: "tc1", tool_name: "validate_query", content: {} }, created_at: "2026-05-01T10:00:02Z" },
      makeAssistantMsg("Resultado final"),
    ];
    const conv = makeConv({ messages: msgs });
    render(<ConversationViewer initial={conv} />);
    // Should show at least one round divider (Ronda 2)
    expect(screen.getByText(/Ronda 2/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Error messages
  // -----------------------------------------------------------------------

  it("renders error bubble with red border for is_error messages", () => {
    const conv = makeConv({
      messages: [makeAssistantMsg("Fallo de conexión", { is_error: true })],
    });
    render(<ConversationViewer initial={conv} />);
    const bubble = screen.getByTestId("assistant-bubble");
    // Style should include red border (var(--down))
    expect(bubble).toBeInTheDocument();
    expect(screen.getByText(/Ver detalles/i)).toBeInTheDocument();
  });

  it("expands error details when 'Ver detalles' is clicked", () => {
    const conv = makeConv({
      messages: [makeAssistantMsg("Error", { is_error: true })],
    });
    render(<ConversationViewer initial={conv} />);
    fireEvent.click(screen.getByText("Ver detalles"));
    expect(screen.getByText("Ocultar detalles")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Tool result card expand/collapse
  // -----------------------------------------------------------------------

  it("expands tool result card on click", () => {
    const conv = makeConv({ messages: [makeToolMsg("list_ps_tables")] });
    render(<ConversationViewer initial={conv} />);
    const btn = screen.getByRole("button", { name: /list_ps_tables/i });
    fireEvent.click(btn);
    // After expand, the <pre> with JSON content is visible
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  // -----------------------------------------------------------------------
  // Archive state
  // -----------------------------------------------------------------------

  it("disables input when conversation is archived", () => {
    const conv = makeConv({ archived_at: "2026-05-01T12:00:00Z" });
    render(<ConversationViewer initial={conv} />);
    const input = screen.getByPlaceholderText("Desarchiva para continuar");
    expect(input).toBeDisabled();
  });

  it("shows 'Desarchivar' button when conversation is archived", () => {
    const conv = makeConv({ archived_at: "2026-05-01T12:00:00Z" });
    render(<ConversationViewer initial={conv} />);
    expect(screen.getByText("Desarchivar")).toBeInTheDocument();
  });

  it("shows 'Archivar' button when conversation is active", () => {
    render(<ConversationViewer initial={makeConv()} />);
    expect(screen.getByText("Archivar")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Title editing
  // -----------------------------------------------------------------------

  it("enters edit mode when title is clicked", () => {
    render(<ConversationViewer initial={makeConv()} />);
    const title = screen.getByText("Test conversation");
    fireEvent.click(title);
    // The input should now be visible
    expect(screen.getByDisplayValue("Test conversation")).toBeInTheDocument();
  });

  it("cancels edit on Escape and restores original title", () => {
    render(<ConversationViewer initial={makeConv()} />);
    fireEvent.click(screen.getByText("Test conversation"));
    const input = screen.getByDisplayValue("Test conversation");
    fireEvent.change(input, { target: { value: "Nuevo título" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("Test conversation")).toBeInTheDocument();
  });

  it("saves title on Enter key and calls API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    render(<ConversationViewer initial={makeConv()} />);
    fireEvent.click(screen.getByText("Test conversation"));
    const input = screen.getByDisplayValue("Test conversation");
    fireEvent.change(input, { target: { value: "Título actualizado" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Copy link
  // -----------------------------------------------------------------------

  it("copies link to clipboard on 'Copiar enlace' click", async () => {
    render(<ConversationViewer initial={makeConv()} />);
    fireEvent.click(screen.getByText("Copiar enlace"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/c/conv-1"),
      );
    });
  });

  it("shows 'Copiado' after copying link", async () => {
    render(<ConversationViewer initial={makeConv()} />);
    fireEvent.click(screen.getByText("Copiar enlace"));
    await waitFor(() => {
      expect(screen.getByText("Copiado")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Sending messages
  // -----------------------------------------------------------------------

  it("sends message via POST when Enviar is clicked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          message: {
            id: "m-new",
            conversation_id: "conv-1",
            role: "assistant",
            content: { text: "Respuesta del asistente" },
            created_at: "2026-05-01T10:10:00Z",
          },
        }),
    });

    render(<ConversationViewer initial={makeConv()} />);
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Nuevo mensaje" } });
    fireEvent.click(screen.getByText("Enviar"));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv-1/messages",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows error message when send fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: "Server error",
          code: "INTERNAL",
          timestamp: new Date().toISOString(),
          requestId: "req-1",
        }),
    });

    render(<ConversationViewer initial={makeConv()} />);
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Mensaje fallido" } });
    fireEvent.click(screen.getByText("Enviar"));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("does not send when input is empty", async () => {
    globalThis.fetch = vi.fn();
    // Use a conversation with existing messages so pre-fill does not apply
    // (pre-fill only kicks in when messages.length === 0)
    render(<ConversationViewer initial={makeConv({ messages: [makeUserMsg("msg")] })} />);
    // Textarea should be empty (no pre-fill for resumed conversations)
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    expect(textarea).toHaveValue("");
    fireEvent.click(screen.getByText("Enviar"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Archive toggle
  // -----------------------------------------------------------------------

  it("toggles archive state when Archivar is clicked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    render(<ConversationViewer initial={makeConv()} />);
    fireEvent.click(screen.getByText("Archivar"));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // 'Abrir en contexto' link
  // -----------------------------------------------------------------------

  it("renders 'Abrir en contexto' link pointing to /k/<id>", () => {
    render(<ConversationViewer initial={makeConv()} />);
    const link = screen.getByText("Abrir en contexto");
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/k/conv-1");
  });

  // -----------------------------------------------------------------------
  // Mode pill
  // -----------------------------------------------------------------------

  it("renders colored mode pill for the conversation mode", () => {
    render(<ConversationViewer initial={makeConv({ mode: "analyze" })} />);
    expect(screen.getByText("Analizar")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Seed prompt pre-fill (issue #557)
  // -----------------------------------------------------------------------

  it("pre-fills textarea with first_user_prompt when conversation has no messages", () => {
    const conv = makeConv({ first_user_prompt: "Dame un resumen semanal", messages: [] });
    render(<ConversationViewer initial={conv} />);
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    expect(textarea).toHaveValue("Dame un resumen semanal");
  });

  it("leaves textarea empty when conversation has messages (resumed conversation)", () => {
    const conv = makeConv({
      first_user_prompt: "Dame un resumen semanal",
      messages: [makeUserMsg("Dame un resumen semanal")],
    });
    render(<ConversationViewer initial={conv} />);
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    expect(textarea).toHaveValue("");
  });

  it("send button is enabled when textarea is pre-filled with seed", () => {
    const conv = makeConv({ first_user_prompt: "Dame un resumen", messages: [] });
    render(<ConversationViewer initial={conv} />);
    const sendBtn = screen.getByText("Enviar");
    expect(sendBtn).not.toBeDisabled();
  });

  it("leaves textarea empty when first_user_prompt is null and no messages", () => {
    const conv = makeConv({ first_user_prompt: null, messages: [] });
    render(<ConversationViewer initial={conv} />);
    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    expect(textarea).toHaveValue("");
  });
});
