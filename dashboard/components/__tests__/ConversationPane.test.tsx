// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConversationPane } from "../ConversationPane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStreamFetch(): Promise<Response> {
  // An immediately-closed stream so the SSE reader exits cleanly.
  const stream = new ReadableStream({ start(ctrl) { ctrl.close(); } });
  return Promise.resolve({ ok: true, body: stream } as unknown as Response);
}

function makeConvFetch(id: string, messages: unknown[] = []): Promise<Response> {
  const conv = { id, mode: "chat", title: null, messages };
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(conv),
  } as unknown as Response);
}

function stubFetch(convId: string, messages: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = url as string;
      if (u.includes("/stream")) return makeStreamFetch();
      if (u.includes("/api/conversations") && !opts?.method) {
        return makeConvFetch(convId, messages);
      }
      return Promise.resolve({ ok: false, body: null } as unknown as Response);
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationPane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the conversation-pane container", () => {
    render(<ConversationPane conversationId={null} mode="standalone" />);
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument();
  });

  it("shows empty-state prompt when no conversationId", () => {
    render(<ConversationPane conversationId={null} mode="standalone" />);
    expect(screen.getByText("Escribe tu primer mensaje.")).toBeInTheDocument();
  });

  it("renders the message textarea with placeholder", () => {
    render(<ConversationPane conversationId={null} mode="standalone" />);
    expect(screen.getByPlaceholderText("Escribe un mensaje…")).toBeInTheDocument();
  });

  it("renders in panel mode without crashing", () => {
    render(<ConversationPane conversationId={null} mode="panel" />);
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument();
  });

  it("shows continue-prompt after loading an empty conversation", async () => {
    stubFetch("conv-1");
    render(<ConversationPane conversationId="conv-1" mode="standalone" />);
    await waitFor(() =>
      expect(
        screen.getByText("Escribe un mensaje para continuar."),
      ).toBeInTheDocument(),
    );
  });

  it("renders user bubble from loaded messages", async () => {
    stubFetch("conv-1", [
      {
        id: "m1",
        conversation_id: "conv-1",
        role: "user",
        content: "Hola",
        created_at: new Date().toISOString(),
      },
    ]);
    render(<ConversationPane conversationId="conv-1" mode="standalone" />);
    await waitFor(() => {
      expect(screen.getByTestId("user-bubble")).toBeInTheDocument();
      expect(screen.getByText("Hola")).toBeInTheDocument();
    });
  });

  it("renders assistant bubble from loaded messages", async () => {
    stubFetch("conv-1", [
      {
        id: "m1",
        conversation_id: "conv-1",
        role: "assistant",
        content: { text: "¡Claro que sí!" },
        created_at: new Date().toISOString(),
      },
    ]);
    render(<ConversationPane conversationId="conv-1" mode="standalone" />);
    await waitFor(() => {
      expect(screen.getByTestId("assistant-bubble")).toBeInTheDocument();
      expect(screen.getByText("¡Claro que sí!")).toBeInTheDocument();
    });
  });

  it("skips tool-role messages in rendered output", async () => {
    stubFetch("conv-1", [
      {
        id: "t1",
        conversation_id: "conv-1",
        role: "tool",
        content: { tool_call_id: "tc1", tool_name: "search", content: "hidden" },
        created_at: new Date().toISOString(),
      },
      {
        id: "m2",
        conversation_id: "conv-1",
        role: "user",
        content: "Visible",
        created_at: new Date().toISOString(),
      },
    ]);
    render(<ConversationPane conversationId="conv-1" mode="standalone" />);
    await waitFor(() => {
      expect(screen.getByText("Visible")).toBeInTheDocument();
      expect(screen.queryByText("hidden")).not.toBeInTheDocument();
    });
  });

  it("prefills textarea from prefillText prop", () => {
    render(
      <ConversationPane
        conversationId={null}
        mode="standalone"
        prefillText="Hola mundo"
        prefillId={1}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Escribe un mensaje…",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hola mundo");
  });

  it("calls onConversationCreated when a new conversation is created", async () => {
    const onCreated = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = url as string;
        if (u.includes("/stream")) return makeStreamFetch();
        if (opts?.method === "POST" && u === "/api/conversations") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "new-conv" }),
          } as unknown as Response);
        }
        if (opts?.method === "POST" && u.includes("/turns")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ turnId: "turn-1" }),
          } as unknown as Response);
        }
        return makeConvFetch("new-conv");
      }),
    );

    render(
      <ConversationPane
        conversationId={null}
        mode="standalone"
        newConversationConfig={{ conversationMode: "chat", contextKind: "global" }}
        onConversationCreated={onCreated}
      />,
    );

    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith("new-conv");
    });
  });

  it("shows send error message when turn POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = url as string;
        if (u.includes("/stream")) return makeStreamFetch();
        if (opts?.method === "POST" && u.includes("/turns")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: "Error de red" }),
          } as unknown as Response);
        }
        return makeConvFetch("conv-x");
      }),
    );

    render(<ConversationPane conversationId="conv-x" mode="standalone" />);
    await waitFor(() =>
      expect(
        screen.getByText("Escribe un mensaje para continuar."),
      ).toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Test" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Error de red")).toBeInTheDocument();
    });
  });

  it("shows network error when fetch throws during send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = url as string;
        if (u.includes("/stream")) return makeStreamFetch();
        if (opts?.method === "POST" && u.includes("/turns")) {
          return Promise.reject(new Error("network failure"));
        }
        return makeConvFetch("conv-x");
      }),
    );

    render(<ConversationPane conversationId="conv-x" mode="standalone" />);
    await waitFor(() =>
      expect(
        screen.getByText("Escribe un mensaje para continuar."),
      ).toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Test" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo conectar con el servidor."),
      ).toBeInTheDocument();
    });
  });

  it("shows no-active-conversation error when sending without newConversationConfig", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes("/stream")) return makeStreamFetch();
        return makeConvFetch("conv-x");
      }),
    );

    render(
      <ConversationPane
        conversationId={null}
        mode="standalone"
        // No newConversationConfig — send should surface an error
      />,
    );

    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Test" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByText("No se puede enviar sin una conversación activa."),
      ).toBeInTheDocument();
    });
  });

  it("calls onProcessingChange(true) when a turn starts", async () => {
    const onProcessingChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = url as string;
        if (u.includes("/stream")) return makeStreamFetch();
        if (opts?.method === "POST" && u.includes("/turns")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ turnId: "turn-1" }),
          } as unknown as Response);
        }
        return makeConvFetch("conv-y");
      }),
    );

    render(
      <ConversationPane
        conversationId="conv-y"
        mode="standalone"
        onProcessingChange={onProcessingChange}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Escribe un mensaje para continuar."),
      ).toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText("Escribe un mensaje…");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(onProcessingChange).toHaveBeenCalledWith(true);
    });
  });
});
