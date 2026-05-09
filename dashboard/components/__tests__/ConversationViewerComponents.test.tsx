// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// RoundDivider
// ---------------------------------------------------------------------------

import { RoundDivider } from "../RoundDivider";

describe("RoundDivider", () => {
  it("renders the round number", () => {
    render(<RoundDivider round={2} />);
    expect(screen.getByText("Ronda 2")).toBeInTheDocument();
  });

  it("has aria-label with round number", () => {
    render(<RoundDivider round={3} />);
    expect(screen.getByLabelText("Inicio de ronda 3")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InlineToolCall
// ---------------------------------------------------------------------------

import { InlineToolCall } from "../InlineToolCall";
import type { ToolCallRecord } from "@/lib/conversation-types";

describe("InlineToolCall", () => {
  const call: ToolCallRecord = {
    id: "tc1",
    name: "validate_query",
    arguments: { sql: "SELECT 1" },
    result: { valid: true },
    duration_ms: 45,
    success: true,
  };

  it("renders tool name in header", () => {
    render(<InlineToolCall call={call} />);
    expect(screen.getByText("validate_query")).toBeInTheDocument();
  });

  it("renders duration", () => {
    render(<InlineToolCall call={call} />);
    expect(screen.getByText("45 ms")).toBeInTheDocument();
  });

  it("renders OK status pill when success=true", () => {
    render(<InlineToolCall call={call} />);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("renders Error status pill when success=false", () => {
    const errCall: ToolCallRecord = { ...call, success: false };
    render(<InlineToolCall call={errCall} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("expands to show arguments on click", () => {
    render(<InlineToolCall call={call} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(screen.getByText(/Argumentos/i)).toBeInTheDocument();
  });

  it("shows result section when expanded", () => {
    render(<InlineToolCall call={call} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Resultado/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InitialContextPanel
// ---------------------------------------------------------------------------

import { InitialContextPanel } from "../InitialContextPanel";
import type { InitialContext } from "@/lib/conversation-types";

describe("InitialContextPanel", () => {
  const ctx: InitialContext = {
    model: "claude-sonnet-4",
    provider: "openrouter",
    seed_prompt: "Analiza las ventas del mes",
    system_prompt_stable: "You are a helpful assistant.",
    system_prompt_volatile: "Current dashboard: Ventas",
    tools: [
      { name: "validate_query", schema: { type: "object", properties: {} } },
      { name: "execute_query", schema: { type: "object", properties: {} } },
    ],
    config: { flow: "analyze", maxOutputTokens: 4096 },
  };

  it("renders collapsed by default", () => {
    render(<InitialContextPanel context={ctx} />);
    expect(screen.getByText("Contexto original")).toBeInTheDocument();
    // Content should not be visible when collapsed
    expect(screen.queryByText("Modelo y proveedor")).not.toBeInTheDocument();
  });

  it("expands to show model/provider on click", () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText(/Modelo y proveedor/i)).toBeInTheDocument();
    expect(screen.getByText(/claude-sonnet-4/i)).toBeInTheDocument();
  });

  it("shows seed prompt verbatim when expanded", () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText("Analiza las ventas del mes")).toBeInTheDocument();
  });

  it("shows system prompt stable section when expanded", () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText(/Estable \(cacheado\)/i)).toBeInTheDocument();
  });

  it("shows system prompt volatile section when expanded", async () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText(/Volátil/i)).toBeInTheDocument();
  });

  it("shows tool list when expanded", () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText(/Herramientas disponibles/i)).toBeInTheDocument();
    expect(screen.getByText("validate_query")).toBeInTheDocument();
    expect(screen.getByText("execute_query")).toBeInTheDocument();
  });

  it("shows config when expanded", () => {
    render(<InitialContextPanel context={ctx} />);
    fireEvent.click(screen.getByTestId("initial-context-toggle"));
    expect(screen.getByText(/Configuración/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// conversation-mode-style
// ---------------------------------------------------------------------------

import { getModeStyle, getModeLabel } from "@/lib/conversation-mode-style";

describe("getModeStyle", () => {
  it("returns known style for generate", () => {
    const s = getModeStyle("generate");
    expect(s.label).toBe("Generar");
    expect(s.bg).toBeTruthy();
    expect(s.fg).toBeTruthy();
  });

  it("returns known style for analyze", () => {
    const s = getModeStyle("analyze");
    expect(s.label).toBe("Analizar");
  });

  it("returns a fallback style for unknown mode", () => {
    const s = getModeStyle("unknown_mode_xyz");
    expect(s.label).toBe("unknown_mode_xyz");
    expect(s.bg).toBeTruthy();
    expect(s.fg).toBeTruthy();
  });

  it("fallback is stable for the same mode string", () => {
    const a = getModeStyle("custom_mode");
    const b = getModeStyle("custom_mode");
    expect(a).toEqual(b);
  });
});

describe("getModeLabel", () => {
  it("returns Spanish label for modify", () => {
    expect(getModeLabel("modify")).toBe("Modificar");
  });

  it("returns mode string as label for unknown mode", () => {
    expect(getModeLabel("my_mode")).toBe("my_mode");
  });
});

// ---------------------------------------------------------------------------
// conversation-types helpers
// ---------------------------------------------------------------------------

import {
  getConversationDisplayTitle,
  isAssistantContent,
  isToolResultContent,
  getMessageText,
} from "@/lib/conversation-types";

describe("conversation-types helpers", () => {
  describe("getConversationDisplayTitle", () => {
    it("returns title when present", () => {
      expect(getConversationDisplayTitle({ title: "Mi título", first_user_prompt: "..." })).toBe("Mi título");
    });

    it("falls back to first_user_prompt when title is null", () => {
      expect(
        getConversationDisplayTitle({ title: null, first_user_prompt: "A".repeat(100) }),
      ).toHaveLength(60);
    });

    it("returns 'Sin título' when both are null", () => {
      expect(getConversationDisplayTitle({ title: null, first_user_prompt: null })).toBe("Sin título");
    });
  });

  describe("isAssistantContent", () => {
    it("returns true for object with text field", () => {
      expect(isAssistantContent({ text: "hello" })).toBe(true);
    });

    it("returns true for tool-only assistant message (no text field)", () => {
      expect(isAssistantContent({ tool_calls: [{ id: "t1", name: "x", arguments: {} }] })).toBe(true);
    });

    it("returns true for error assistant message", () => {
      expect(isAssistantContent({ is_error: true })).toBe(true);
    });

    it("returns false for string", () => {
      expect(isAssistantContent("hello")).toBe(false);
    });

    it("returns false for tool result object", () => {
      expect(isAssistantContent({ tool_call_id: "x", tool_name: "foo", content: {} })).toBe(false);
    });
  });

  describe("isToolResultContent", () => {
    it("returns true for object with tool_call_id field", () => {
      expect(isToolResultContent({ tool_call_id: "abc", tool_name: "foo", content: {} })).toBe(true);
    });

    it("returns false for assistant content", () => {
      expect(isToolResultContent({ text: "hi" })).toBe(false);
    });
  });

  describe("getMessageText", () => {
    it("returns string directly", () => {
      expect(getMessageText("hello world")).toBe("hello world");
    });

    it("returns text from assistant content", () => {
      expect(getMessageText({ text: "result text" })).toBe("result text");
    });

    it("returns empty string for tool result content", () => {
      expect(getMessageText({ tool_call_id: "x", tool_name: "foo", content: {} })).toBe("");
    });

    it("returns empty string when text is undefined in assistant content", () => {
      expect(getMessageText({ tool_calls: [] })).toBe("");
    });
  });
});
