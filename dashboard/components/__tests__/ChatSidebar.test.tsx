// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock heavy sub-components so tests don't need SSE/fetch/DB.
vi.mock("@/components/ConversationPane", () => ({
  ConversationPane: vi.fn(() => <div data-testid="mock-conversation-pane" />),
}));

vi.mock("@/components/PreviousConversations", () => ({
  default: vi.fn(() => <div data-testid="mock-prev-conversations" />),
}));

vi.mock("@/lib/useConfiguredModel", () => ({
  useConfiguredModel: vi.fn(() => "anthropic/claude-sonnet"),
  displayModelName: (raw: string) => raw.split("/").pop() ?? raw,
  _resetCacheForTesting: vi.fn(),
}));

import ChatSidebar, { type ChatSidebarProps } from "../ChatSidebar";

// Minimal spec satisfying the TypeScript type (cast to avoid zod runtime cost).
const minimalSpec = { title: "Test", widgets: [] } as unknown as ChatSidebarProps["spec"];

const baseProps: ChatSidebarProps = {
  spec: minimalSpec,
  onSpecUpdate: vi.fn(),
  isOpen: true,
  onToggle: vi.fn(),
};

describe("ChatSidebar", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Open state ─────────────────────────────────────────────────────────────

  it("renders the sidebar aside when open", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();
  });

  it("shows 'Asistente IA' heading in the header", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByText("Asistente IA")).toBeInTheDocument();
  });

  it("renders tab buttons for Modificar and Analizar", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByTestId("tab-modificar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-analizar")).toBeInTheDocument();
  });

  it("shows Modificar tab selected by default", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByTestId("tab-modificar")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("tab-analizar")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switches active tab to Analizar when clicked", () => {
    render(<ChatSidebar {...baseProps} />);
    fireEvent.click(screen.getByTestId("tab-analizar"));
    expect(screen.getByTestId("tab-analizar")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("tab-modificar")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("starts on Analizar tab when initialMode='analizar'", () => {
    render(<ChatSidebar {...baseProps} initialMode="analizar" />);
    expect(screen.getByTestId("tab-analizar")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders close button in open state", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Cerrar chat" }),
    ).toBeInTheDocument();
  });

  it("calls onToggle when close button is clicked", () => {
    render(<ChatSidebar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar chat" }));
    expect(baseProps.onToggle).toHaveBeenCalledOnce();
  });

  it("renders ConversationPane inside the open sidebar", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.getByTestId("mock-conversation-pane")).toBeInTheDocument();
  });

  it("shows new-conversation button when dashboardId is provided", () => {
    render(<ChatSidebar {...baseProps} dashboardId={42} />);
    expect(screen.getByTestId("new-conversation-btn")).toBeInTheDocument();
  });

  it("hides new-conversation button when dashboardId is undefined", () => {
    render(<ChatSidebar {...baseProps} />);
    expect(screen.queryByTestId("new-conversation-btn")).not.toBeInTheDocument();
  });

  it("hides new-conversation button when initialConversationId is provided", () => {
    render(
      <ChatSidebar
        {...baseProps}
        dashboardId={42}
        initialConversationId="conv-abc"
      />,
    );
    expect(screen.queryByTestId("new-conversation-btn")).not.toBeInTheDocument();
  });

  it("shows model name in header status line", () => {
    render(<ChatSidebar {...baseProps} />);
    // displayModelName strips the "anthropic/" prefix
    expect(screen.getByText(/claude-sonnet/)).toBeInTheDocument();
  });

  // ── Closed state ────────────────────────────────────────────────────────────

  it("shows toggle button when closed (hideWhenClosed=false)", () => {
    render(<ChatSidebar {...baseProps} isOpen={false} />);
    expect(screen.getByRole("button", { name: "Abrir chat" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();
  });

  it("returns null when closed and hideWhenClosed=true", () => {
    const { container } = render(
      <ChatSidebar {...baseProps} isOpen={false} hideWhenClosed />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onToggle when the 'Abrir chat' button is clicked", () => {
    render(<ChatSidebar {...baseProps} isOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir chat" }));
    expect(baseProps.onToggle).toHaveBeenCalledOnce();
  });
});
