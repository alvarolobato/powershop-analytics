// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConversationRowActions } from "../ConversationRowActions";
import type { ConversationRow } from "@/app/conversations/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: ConversationRow = {
  id: "conv-abc123",
  title: "Test conversation",
  first_user_prompt: "¿Cuánto vendimos?",
  mode: "analyze",
  context_url: "/paneles/5",
  context_kind: "dashboard",
  context_ref: "5",
  last_interaction_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  archived_at: null,
  last_status: "ok",
  llm_provider: "openrouter",
  llm_driver: null,
  message_count: 4,
  tool_calls_count: 2,
  rounds_count: 1,
  duration_seconds: 90,
  last_message_preview: "Las ventas fueron 12.000€",
  token_total: 5000,
};

function makeConv(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return { ...BASE, ...overrides };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withClipboard(fn: (writeText: ReturnType<typeof vi.fn>) => void) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  try {
    Object.assign(navigator, { clipboard: { writeText } });
    fn(writeText);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalDescriptor);
    } else {
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationRowActions", () => {
  const noop = vi.fn();

  beforeEach(() => {
    mockPush.mockClear();
    noop.mockClear();
  });

  it("renders all action buttons for a non-archived, non-global conversation", () => {
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    expect(screen.getByLabelText("Continuar")).toBeInTheDocument();
    expect(screen.getByLabelText("Abrir en contexto")).toBeInTheDocument();
    expect(screen.getByLabelText("Archivar")).toBeInTheDocument();
    expect(screen.getByLabelText("Renombrar")).toBeInTheDocument();
    expect(screen.getByLabelText("Copiar enlace")).toBeInTheDocument();
    expect(screen.getByLabelText("Copiar enlace en contexto")).toBeInTheDocument();
  });

  it("clicking Continuar navigates to /c/<id>", () => {
    render(
      <ConversationRowActions
        conversation={makeConv({ id: "nav-id-001" })}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Continuar"));
    expect(mockPush).toHaveBeenCalledWith("/c/nav-id-001");
  });

  it("clicking Abrir en contexto navigates to /k/<id> for non-global context", () => {
    render(
      <ConversationRowActions
        conversation={makeConv({ id: "ctx-id-002", context_kind: "dashboard" })}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Abrir en contexto"));
    expect(mockPush).toHaveBeenCalledWith("/k/ctx-id-002");
  });

  it("renders disabled context button for global conversations", () => {
    render(
      <ConversationRowActions
        conversation={makeConv({ context_kind: "global" })}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Abrir en contexto (no disponible)");
    expect(btn).toBeDisabled();
  });

  it("clicking Archivar calls onArchiveToggle with (id, false) for active conversation", () => {
    const onArchiveToggle = vi.fn();
    render(
      <ConversationRowActions
        conversation={makeConv({ id: "arch-001", archived_at: null })}
        onArchiveToggle={onArchiveToggle}
        onRenameStart={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Archivar"));
    expect(onArchiveToggle).toHaveBeenCalledWith("arch-001", false);
  });

  it("clicking Desarchivar calls onArchiveToggle with (id, true) for archived conversation", () => {
    const onArchiveToggle = vi.fn();
    render(
      <ConversationRowActions
        conversation={makeConv({ id: "arch-002", archived_at: new Date().toISOString() })}
        onArchiveToggle={onArchiveToggle}
        onRenameStart={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("Desarchivar"));
    expect(onArchiveToggle).toHaveBeenCalledWith("arch-002", true);
  });

  it("clicking Renombrar calls onRenameStart", () => {
    const onRenameStart = vi.fn();
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={onRenameStart}
      />
    );
    fireEvent.click(screen.getByLabelText("Renombrar"));
    expect(onRenameStart).toHaveBeenCalledTimes(1);
  });

  it("clicking Copiar enlace calls navigator.clipboard.writeText with /c/<id> URL", () => {
    withClipboard((writeText) => {
      render(
        <ConversationRowActions
          conversation={makeConv({ id: "copy-id-003" })}
          onArchiveToggle={noop}
          onRenameStart={noop}
        />
      );
      fireEvent.click(screen.getByLabelText("Copiar enlace"));
      expect(writeText).toHaveBeenCalledOnce();
      const calledWith: string = writeText.mock.calls[0][0];
      expect(calledWith).toMatch(/\/c\/copy-id-003$/);
    });
  });

  it("clicking Copiar enlace en contexto calls clipboard with /k/<id> URL", () => {
    withClipboard((writeText) => {
      render(
        <ConversationRowActions
          conversation={makeConv({ id: "copy-id-004" })}
          onArchiveToggle={noop}
          onRenameStart={noop}
        />
      );
      fireEvent.click(screen.getByLabelText("Copiar enlace en contexto"));
      expect(writeText).toHaveBeenCalledOnce();
      const calledWith: string = writeText.mock.calls[0][0];
      expect(calledWith).toMatch(/\/k\/copy-id-004$/);
    });
  });

  it("mouseenter/mouseleave on Continuar button changes color style without error", () => {
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Continuar");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("mouseenter/mouseleave on Abrir en contexto button does not throw", () => {
    render(
      <ConversationRowActions
        conversation={makeConv({ context_kind: "dashboard" })}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Abrir en contexto");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("mouseenter/mouseleave on Archivar button does not throw", () => {
    render(
      <ConversationRowActions
        conversation={makeConv({ archived_at: null })}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Archivar");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("mouseenter/mouseleave on Renombrar button does not throw", () => {
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Renombrar");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("mouseenter/mouseleave on Copiar enlace button does not throw", () => {
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Copiar enlace");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("mouseenter/mouseleave on Copiar enlace en contexto button does not throw", () => {
    render(
      <ConversationRowActions
        conversation={makeConv()}
        onArchiveToggle={noop}
        onRenameStart={noop}
      />
    );
    const btn = screen.getByLabelText("Copiar enlace en contexto");
    expect(() => {
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
    }).not.toThrow();
  });

  it("clicks inside the actions container do not bubble to a parent click handler", () => {
    const parentClick = vi.fn();
    render(
      <div role="row" onClick={parentClick}>
        <ConversationRowActions
          conversation={makeConv()}
          onArchiveToggle={noop}
          onRenameStart={noop}
        />
      </div>
    );
    fireEvent.click(screen.getByLabelText("Renombrar"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("copyToClipboard is skipped when navigator.clipboard is undefined", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    try {
      Object.assign(navigator, { clipboard: undefined });
      render(
        <ConversationRowActions
          conversation={makeConv({ id: "no-clip" })}
          onArchiveToggle={noop}
          onRenameStart={noop}
        />
      );
      // Should not throw even when clipboard API is unavailable
      expect(() => fireEvent.click(screen.getByLabelText("Copiar enlace"))).not.toThrow();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "clipboard", originalDescriptor);
      } else {
        delete (navigator as unknown as Record<string, unknown>).clipboard;
      }
    }
  });
});
