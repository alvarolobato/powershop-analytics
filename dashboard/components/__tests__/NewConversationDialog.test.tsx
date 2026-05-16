// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { NewConversationDialog } from "../NewConversationDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(open = true, onClose = vi.fn()) {
  return render(<NewConversationDialog open={open} onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewConversationDialog", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockPush.mockReset();
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  it("renders nothing when closed", () => {
    renderDialog(false);
    expect(screen.queryByTestId("new-conversation-dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with textarea and buttons when open", () => {
    renderDialog();
    expect(screen.getByTestId("new-conversation-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("new-conversation-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("new-conversation-submit")).toBeInTheDocument();
    expect(screen.getByTestId("new-conversation-cancel")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    fireEvent.click(screen.getByTestId("new-conversation-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    fireEvent.click(screen.getByTestId("new-conversation-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Submit with prompt ─────────────────────────────────────────────────────

  it("with prompt: calls POST /api/conversations then POST /api/conversations/:id/messages, then navigates to /c/:id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "abc123def456", c_url: "/c/abc123def456" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    fireEvent.change(screen.getByTestId("new-conversation-prompt"), {
      target: { value: "¿Cuánto vendimos ayer?" },
    });
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/abc123def456"));

    // First call: POST /api/conversations
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/conversations",
      expect.objectContaining({ method: "POST" })
    );
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.mode).toBe("chat");
    expect(firstBody.context_kind).toBe("global");
    expect(firstBody.first_user_prompt).toBe("¿Cuánto vendimos ayer?");

    // Second call: POST /api/conversations/:id/messages
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/conversations/abc123def456/messages",
      expect.objectContaining({ method: "POST" })
    );
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.content).toBe("¿Cuánto vendimos ayer?");
    expect(secondBody.callLlm).toBe(true);
  });

  // ── Submit without prompt ──────────────────────────────────────────────────

  it("without prompt: calls POST /api/conversations but NOT messages, then navigates to /c/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "abc123def456", c_url: "/c/abc123def456" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    // Leave textarea empty
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/abc123def456"));

    // Only one fetch call (no messages POST)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.first_user_prompt).toBeUndefined();
  });

  it("whitespace-only prompt is treated as empty (no messages POST)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "abc123def456", c_url: "/c/abc123def456" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    fireEvent.change(screen.getByTestId("new-conversation-prompt"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/abc123def456"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it("shows inline error when POST /api/conversations fails; does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "DB_ERROR" }),
    }));

    renderDialog();
    fireEvent.change(screen.getByTestId("new-conversation-prompt"), {
      target: { value: "Pregunta" },
    });
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("new-conversation-error")).toBeInTheDocument()
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows error when messages POST fails; does not navigate", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "abc123def456", c_url: "/c/abc123def456" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({ error: "VALIDATION_ERROR" }),
        })
    );

    renderDialog();
    fireEvent.change(screen.getByTestId("new-conversation-prompt"), {
      target: { value: "Pregunta" },
    });
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("new-conversation-error")).toBeInTheDocument()
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("disables buttons while loading", async () => {
    let resolveCreate!: (v: unknown) => void;
    const pendingPromise = new Promise((res) => { resolveCreate = res; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pendingPromise));

    renderDialog();
    fireEvent.click(screen.getByTestId("new-conversation-submit"));

    // While pending, both buttons are disabled
    expect(screen.getByTestId("new-conversation-submit")).toBeDisabled();
    expect(screen.getByTestId("new-conversation-cancel")).toBeDisabled();

    // Resolve to avoid hanging
    resolveCreate({
      ok: true,
      json: async () => ({ id: "abc123def456", c_url: "/c/abc123def456" }),
    });
  });
});
