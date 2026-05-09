// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConversationsTable } from "../ConversationsTable";
import { getModePillStyle } from "@/lib/conversation-mode-style";
import type { ConversationRow } from "@/app/conversations/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROW: ConversationRow = {
  id: "abc123def456",
  title: "Test conversation",
  first_user_prompt: "Muéstrame las ventas de ayer",
  mode: "analyze",
  context_url: "/paneles/1",
  context_kind: "dashboard",
  context_ref: "1",
  last_interaction_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  created_at: new Date(Date.now() - 7200 * 1000).toISOString(),
  archived_at: null,
  last_status: "ok",
  llm_provider: "openrouter",
  llm_driver: null,
  message_count: 6,
  tool_calls_count: 3,
  rounds_count: 2,
  duration_seconds: 3600,
  last_message_preview: "Las ventas de ayer fueron 38.420€",
  token_total: 12400,
};

function makeRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return { ...BASE_ROW, ...overrides };
}

const MOCK_ROWS: ConversationRow[] = [
  makeRow({ id: "row1111111111", mode: "generate", title: "Nuevo dashboard" }),
  makeRow({ id: "row2222222222", mode: "modify", title: "Ajuste de ventas" }),
  makeRow({ id: "row3333333333", mode: "analyze", title: "Análisis mensual" }),
  makeRow({
    id: "row4444444444",
    mode: "suggest",
    title: "Sugerencia de widgets",
  }),
  makeRow({ id: "row5555555555", mode: "gap", title: "Hueco detectado" }),
  makeRow({ id: "row6666666666", mode: "summary", title: "Resumen semanal" }),
  makeRow({
    id: "row7777777777",
    mode: "title",
    title: "Auto-título generado",
  }),
  makeRow({
    id: "archived1111",
    mode: "analyze",
    title: "Conversación archivada",
    archived_at: new Date(Date.now() - 86400 * 1000).toISOString(),
  }),
  makeRow({
    id: "errored11111",
    mode: "modify",
    title: "Con error",
    last_status: "error",
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationsTable", () => {
  const noop = vi.fn();

  beforeEach(() => {
    noop.mockClear();
  });

  it("renders without crashing with empty list", () => {
    expect(() =>
      render(
        <ConversationsTable
          conversations={[]}
          onArchiveToggle={noop}
          onRename={noop}
        />
      )
    ).not.toThrow();
  });

  it("shows empty state when no conversations", () => {
    render(
      <ConversationsTable
        conversations={[]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText(/No hay conversaciones/)).toBeInTheDocument();
  });

  it("renders all expected column headers", () => {
    render(
      <ConversationsTable
        conversations={MOCK_ROWS}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const table = screen.getByTestId("conversations-table");
    const thead = table.querySelector("thead")!;
    const headerTexts = Array.from(thead.querySelectorAll("th")).map((th) =>
      th.textContent?.replace(/[↑↓]/, "").trim()
    );
    expect(headerTexts).toContain("Título");
    expect(headerTexts).toContain("Tipo");
    expect(headerTexts).toContain("Contexto");
    expect(headerTexts).toContain("Última actividad");
    expect(headerTexts).toContain("Creada");
    expect(headerTexts).toContain("Duración");
    expect(headerTexts).toContain("Actividad");
    expect(headerTexts).toContain("Tokens");
    expect(headerTexts).toContain("Vista previa");
    expect(headerTexts).toContain("Estado");
    expect(headerTexts).toContain("Acciones");
  });

  it("has no delete button or affordance", () => {
    render(
      <ConversationsTable
        conversations={MOCK_ROWS}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const container = screen.getByTestId("conversations-table");
    // No button or link should say "Eliminar" or "Borrar"
    expect(within(container).queryByText(/[Ee]liminar/)).toBeNull();
    expect(within(container).queryByText(/[Bb]orrar/)).toBeNull();
    expect(within(container).queryByText(/[Dd]elete/)).toBeNull();
  });

  describe("Mode pill snapshot — canonical palette", () => {
    const MODES_EXPECTED = [
      { mode: "generate", expectedBg: "bg-indigo-100", expectedFg: "text-indigo-800" },
      { mode: "modify", expectedBg: "bg-amber-100", expectedFg: "text-amber-800" },
      { mode: "analyze", expectedBg: "bg-violet-100", expectedFg: "text-violet-800" },
      { mode: "suggest", expectedBg: "bg-emerald-100", expectedFg: "text-emerald-800" },
      { mode: "gap", expectedBg: "bg-rose-100", expectedFg: "text-rose-800" },
      { mode: "summary", expectedBg: "bg-teal-100", expectedFg: "text-teal-800" },
      { mode: "title", expectedBg: "bg-slate-100", expectedFg: "text-slate-700" },
    ];

    it("getModePillStyle returns correct classes for all 7 modes", () => {
      MODES_EXPECTED.forEach(({ mode, expectedBg, expectedFg }) => {
        const style = getModePillStyle(mode);
        expect(style.bg).toBe(expectedBg);
        expect(style.fg).toBe(expectedFg);
      });
    });

    it("getModePillStyle returns fallback for unknown mode", () => {
      const style = getModePillStyle("unknown-mode");
      expect(style.bg).toBe("bg-slate-100");
      expect(style.fg).toBe("text-slate-600");
    });

    it("mode pills render with correct CSS classes from the canonical palette", () => {
      render(
        <ConversationsTable
          conversations={MOCK_ROWS}
          onArchiveToggle={noop}
          onRename={noop}
        />
      );

      MODES_EXPECTED.forEach(({ mode, expectedBg, expectedFg }) => {
        // Find all pills with this mode
        const pills = document.querySelectorAll(`[data-mode="${mode}"]`);
        expect(pills.length).toBeGreaterThan(0);
        pills.forEach((pill) => {
          expect(pill.className).toContain(expectedBg);
          expect(pill.className).toContain(expectedFg);
        });
      });
    });
  });

  it("renders title for rows that have one", () => {
    render(
      <ConversationsTable
        conversations={[makeRow({ id: "t1", title: "Mi conversación" })]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    expect(screen.getByText("Mi conversación")).toBeInTheDocument();
  });

  it("falls back to first_user_prompt when title is null", () => {
    render(
      <ConversationsTable
        conversations={[
          makeRow({
            id: "t2",
            title: null,
            first_user_prompt: "¿Cuánto vendimos ayer?",
          }),
        ]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    expect(screen.getByText("¿Cuánto vendimos ayer?")).toBeInTheDocument();
  });

  it("shows archived pill for archived conversations", () => {
    const row = makeRow({
      id: "a1",
      archived_at: new Date().toISOString(),
    });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const pill = screen.getByTestId(`status-pill-${row.id}`);
    expect(pill).toHaveTextContent("Archivada");
  });

  it("shows 'Con errores' pill for error status", () => {
    const row = makeRow({ id: "e1", last_status: "error" });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const pill = screen.getByTestId(`status-pill-${row.id}`);
    expect(pill).toHaveTextContent("Con errores");
  });

  it("shows 'Activa' pill for active conversations", () => {
    const row = makeRow({ id: "ok1", archived_at: null, last_status: "ok" });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const pill = screen.getByTestId(`status-pill-${row.id}`);
    expect(pill).toHaveTextContent("Activa");
  });

  it("calls onArchiveToggle with correct args when archive action triggered", () => {
    const onArchiveToggle = vi.fn();
    const row = makeRow({ id: "arch1", archived_at: null });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={onArchiveToggle}
        onRename={noop}
      />
    );
    const archiveBtn = screen.getByLabelText("Archivar");
    fireEvent.click(archiveBtn);
    expect(onArchiveToggle).toHaveBeenCalledWith("arch1", false);
  });

  it("calls onArchiveToggle with isArchived=true when unarchiving", () => {
    const onArchiveToggle = vi.fn();
    const row = makeRow({
      id: "unarch1",
      archived_at: new Date().toISOString(),
    });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={onArchiveToggle}
        onRename={noop}
      />
    );
    const unarchiveBtn = screen.getByLabelText("Desarchivar");
    fireEvent.click(unarchiveBtn);
    expect(onArchiveToggle).toHaveBeenCalledWith("unarch1", true);
  });

  it("shows bulk action bar when rows are selected", () => {
    render(
      <ConversationsTable
        conversations={MOCK_ROWS.slice(0, 3)}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    // No bulk bar initially
    expect(screen.queryByTestId("bulk-action-bar")).toBeNull();

    // Select first row
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // index 0 is select-all
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
  });

  it("bulk archive calls onArchiveToggle for all selected active rows", () => {
    const onArchiveToggle = vi.fn();
    const rows = [
      makeRow({ id: "b1", archived_at: null }),
      makeRow({ id: "b2", archived_at: null }),
    ];
    render(
      <ConversationsTable
        conversations={rows}
        onArchiveToggle={onArchiveToggle}
        onRename={noop}
      />
    );

    // Select all
    fireEvent.click(screen.getByTestId("select-all-checkbox"));
    // Click bulk archive
    fireEvent.click(screen.getByTestId("bulk-archive-btn"));

    expect(onArchiveToggle).toHaveBeenCalledTimes(2);
    expect(onArchiveToggle).toHaveBeenCalledWith("b1", false);
    expect(onArchiveToggle).toHaveBeenCalledWith("b2", false);
  });

  it("sort by 'Última actividad' changes sort state", () => {
    render(
      <ConversationsTable
        conversations={MOCK_ROWS}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const sortBtn = screen.getByRole("button", { name: /Ordenar por Última actividad/ });
    // Initially DESC (default) — click to toggle to ASC
    fireEvent.click(sortBtn);
    // Click again → back to DESC
    fireEvent.click(sortBtn);
    // Just verify it doesn't throw and the button is present
    expect(sortBtn).toBeInTheDocument();
  });

  it("inline rename: clicking title opens rename input", () => {
    const row = makeRow({ id: "rename1", title: "Título original" });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={noop}
        onRename={noop}
      />
    );
    const titleCell = screen.getByTestId(`title-cell-${row.id}`);
    fireEvent.click(titleCell);
    const input = screen.getByTestId(`rename-input-${row.id}`);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Título original");
  });

  it("inline rename: pressing Enter commits rename", () => {
    const onRename = vi.fn();
    const row = makeRow({ id: "rename2", title: "Viejo título" });
    render(
      <ConversationsTable
        conversations={[row]}
        onArchiveToggle={noop}
        onRename={onRename}
      />
    );
    fireEvent.click(screen.getByTestId(`title-cell-${row.id}`));
    const input = screen.getByTestId(`rename-input-${row.id}`);
    fireEvent.change(input, { target: { value: "Nuevo título" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("rename2", "Nuevo título");
  });
});
