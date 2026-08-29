"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getModePillStyle } from "@/lib/conversation-mode-style";
import { ConversationRowActions } from "@/components/ConversationRowActions";
import { getConversationDisplayTitle } from "@/lib/conversation-types";
import type { ConversationRow } from "@/app/conversations/types";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffH = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffH / 24);

  if (diffSec < 60) return "hace un momento";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffH < 24) return `hace ${diffH} hora${diffH !== 1 ? "s" : ""}`;
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays} días`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return `hace ${weeks} semana${weeks !== 1 ? "s" : ""}`;
  const months = Math.floor(diffDays / 30);
  return `hace ${months} mes${months !== 1 ? "es" : ""}`;
}

function absoluteDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} días`;
}

function formatTokens(n: number): string {
  if (n <= 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Same wording the (desktop-only) Contexto column uses, collapsed to a
 *  single string for the phone meta line under the title. */
function contextLabel(row: ConversationRow): string {
  if (row.context_kind === "dashboard") {
    return row.context_dashboard_name ?? `Dashboard #${row.context_ref} (eliminado)`;
  }
  if (row.context_kind === "home") return "Inicio";
  if (row.context_kind === "admin") return "Admin";
  return "Libre";
}

function modeLabel(mode: string): string {
  const labels: Record<string, string> = {
    generate: "Generar",
    modify: "Modificar",
    analyze: "Analizar",
    suggest: "Sugerir",
    gap: "Hueco",
    summary: "Resumen",
    title: "Título",
  };
  return labels[mode] ?? mode;
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortCol = "last_interaction_at" | "created_at";

interface SortState {
  col: SortCol;
  dir: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConversationsTableProps {
  conversations: ConversationRow[];
  onArchiveToggle: (id: string, currentlyArchived: boolean) => void;
  onRename: (id: string, title: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationsTable({
  conversations,
  onArchiveToggle,
  onRename,
}: ConversationsTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<SortState>({
    col: "last_interaction_at",
    dir: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Sort
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const aVal = a[sort.col];
        const bVal = b[sort.col];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sort.dir === "desc" ? -cmp : cmp;
      }),
    [conversations, sort.col, sort.dir]
  );

  const toggleSort = (col: SortCol) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" }
    );
  };

  // Selection
  const allSelected =
    sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((r) => r.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Bulk archive
  const handleBulkArchive = (archive: boolean) => {
    selected.forEach((id) => {
      const row = conversations.find((r) => r.id === id);
      if (!row) return;
      const isCurrentlyArchived = row.archived_at !== null;
      if (archive !== isCurrentlyArchived) {
        onArchiveToggle(id, isCurrentlyArchived);
      }
    });
    setSelected(new Set());
  };

  // Inline rename
  const startRename = (row: ConversationRow) => {
    setRenamingId(row.id);
    setRenameValue(getConversationDisplayTitle(row));
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) {
      onRename(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  // Styles — headers always sticky at top: 0; bulk bar placed outside the
  // scrollable div with zIndex: 11 so it never covers column headers.
  const thStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "left",
    color: "var(--fg-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    background: "var(--bg-1)",
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
  };

  // Base cell style — NO overflow/truncation here so the checkbox and
  // action columns don't get clipped. Apply truncation per-column below.
  const tdStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 12,
    color: "var(--fg)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };

  // Título's cell: same as tdStyle but with NO padding, because padding is
  // one of the properties that differs per breakpoint and therefore lives in
  // `.conv-td-title` (globals.css) instead — an inline value would win over
  // the media query. Every other column keeps tdStyle's padding.
  const tdStyleNoPad: React.CSSProperties = {
    fontSize: 12,
    color: "var(--fg)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };

  // Truncating cell style for fixed-width columns (mode, duration, tokens, activity).
  const tdTrunc: React.CSSProperties = {
    ...tdStyle,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const sortBtn = (col: SortCol, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(col)}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: sort.col === col ? "var(--fg)" : "var(--fg-muted)",
        fontWeight: sort.col === col ? 700 : 600,
        fontSize: 11,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        padding: 0,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 3,
      }}
      aria-label={`Ordenar por ${label}`}
    >
      {label}
      {sort.col === col && (
        <span aria-hidden="true">{sort.dir === "desc" ? "↓" : "↑"}</span>
      )}
    </button>
  );

  if (conversations.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "var(--fg-muted)",
          fontSize: 14,
        }}
        data-testid="empty-state"
      >
        No hay conversaciones aún. Empieza una desde un panel o desde una acción
        del Inicio.
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Bulk action bar — placed outside the scrollable div so it never
          overlaps the sticky column headers (which are at top: 0 inside the
          scroll container). zIndex 11 keeps it above headers (zIndex 1). */}
      {selected.size > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 11,
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            // Mobile item 3: this row was nowrap (default) with "Cancelar"
            // pushed fully right by marginLeft: "auto" — on a phone, with
            // the two bulk-action buttons' full labels, that pushed
            // Cancelar off the viewport with no way to reach it. wrap lets
            // it drop to its own line instead; no flex:1 child here so
            // this doesn't hit D-124's "flex:1 basis-0 never wraps" trap.
            flexWrap: "wrap",
            marginBottom: 8,
            fontSize: 13,
          }}
          data-testid="bulk-action-bar"
        >
          <span style={{ color: "var(--fg-muted)" }}>
            {selected.size} seleccionada{selected.size !== 1 ? "s" : ""}
          </span>
          {/* Mobile item 3: `.conv-bulk-btn` gives these the 44px
              tap-target floor below `md` only (D-121 rung 1 — the values
              are static literals, so globals.css owns them and this inline
              object never declares them); they measured 28px tall at
              390px. Desktop keeps the compact 4px/10px padding below. */}
          <button
            type="button"
            className="conv-bulk-btn"
            style={{
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              color: "var(--fg)",
              fontFamily: "inherit",
            }}
            onClick={() => handleBulkArchive(true)}
            data-testid="bulk-archive-btn"
          >
            Archivar seleccionadas
          </button>
          <button
            type="button"
            className="conv-bulk-btn"
            style={{
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              color: "var(--fg)",
              fontFamily: "inherit",
            }}
            onClick={() => handleBulkArchive(false)}
            data-testid="bulk-unarchive-btn"
          >
            Desarchivar seleccionadas
          </button>
          {/* Measured 18px tall at 390px — the smallest target in the bar,
              and the one you reach for to get OUT of a bulk selection.
              `.conv-bulk-cancel` lifts it to 44px below `md`. */}
          <button
            type="button"
            className="conv-bulk-cancel"
            data-testid="bulk-cancel-btn"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--fg-muted)",
              fontSize: 12,
              fontFamily: "inherit",
            }}
            onClick={() => setSelected(new Set())}
          >
            Cancelar
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
          data-testid="conversations-table"
        >
          {/* Mobile item 3: `tableLayout: fixed` sizes columns purely from
              these <col> widths, summing to ~976px — far past a 390px
              viewport, which collapsed Título (the only column that
              matters) to near-zero before you scrolled. Below `md` the six
              secondary columns are dropped from layout entirely (`hidden
              md:table-column` on the <col> — a fixed-layout table's <col>
              honors `display: none` and stops claiming width, distinct
              from hiding just the <td>), so Título gets the freed space;
              at `md:` and up every <col> renders exactly as before. */}
          <colgroup>
            {/* Phone: the checkbox column goes with the bulk-select flow,
                which is desktop-only now — see the Acciones note below. */}
            <col className="hidden md:table-column" style={{ width: 36 }} />  {/* checkbox */}
            <col />                                  {/* title — takes all remaining space */}
            <col className="hidden md:table-column" style={{ width: 90 }} />            {/* tipo/mode */}
            <col className="hidden md:table-column" style={{ width: 160 }} />           {/* contexto */}
            <col className="hidden md:table-column" style={{ width: 150 }} />           {/* última actividad */}
            <col className="hidden md:table-column" style={{ width: 155 }} />           {/* creada — needs room for "14/05/2026, 06:40" */}
            <col className="hidden md:table-column" style={{ width: 75 }} />            {/* duración */}
            <col className="hidden md:table-column" style={{ width: 145 }} />           {/* actividad */}
            <col className="hidden md:table-column" style={{ width: 75 }} />            {/* tokens */}
            {/* 90px at desktop, where these buttons still live. Below `md`
                the column is dropped from layout entirely: two icon
                buttons at their 44px tap target ate ~116px of a 390px
                viewport for actions you can reach from inside the
                conversation instead (ConversationDetailActions). The
                width lives on `.conv-col-acciones` in globals.css per
                D-121 rung 1. */}
            <col className="conv-col-acciones hidden md:table-column" />    {/* acciones */}
          </colgroup>
          <thead>
            <tr>
              {/* Checkbox header — width matches the colgroup col (36px) */}
              <th className="hidden md:table-cell" style={{ ...thStyle, width: 36 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Seleccionar todas"
                  data-testid="select-all-checkbox"
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={thStyle}>Título</th>
              <th className="hidden md:table-cell" style={thStyle}>Tipo</th>
              <th className="hidden md:table-cell" style={thStyle}>Contexto</th>
              <th className="hidden md:table-cell" style={thStyle}>{sortBtn("last_interaction_at", "Última actividad")}</th>
              <th className="hidden md:table-cell" style={thStyle}>{sortBtn("created_at", "Creada")}</th>
              <th className="hidden md:table-cell" style={thStyle}>Duración</th>
              <th className="hidden md:table-cell" style={thStyle}>Actividad</th>
              <th className="hidden md:table-cell" style={thStyle}>Tokens</th>
              <th className="hidden md:table-cell" style={{ ...thStyle, textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const modeStyle = getModePillStyle(row.mode);
              const displayTitle =
                row.title ??
                row.first_user_prompt ??
                "(sin título)";

              return (
                <tr
                  key={row.id}
                  style={{
                    background: selected.has(row.id)
                      ? "var(--accent-soft)"
                      : "transparent",
                    transition: "background 80ms",
                  }}
                  data-testid={`conversation-row-${row.id}`}
                >
                  {/* Checkbox */}
                  <td className="hidden md:table-cell" style={{ ...tdStyle, width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      aria-label={`Seleccionar ${displayTitle}`}
                      style={{ cursor: "pointer" }}
                    />
                  </td>

                  {/* Título — clicking it opens the conversation. `padding` is
                      absent from the inline style on purpose: it is a static
                      literal per breakpoint, so `.conv-td-title` in globals.css
                      owns it at both sizes (D-121 rung 1). */}
                  <td className="conv-td-title" style={{ ...tdStyleNoPad, maxWidth: 0 }}>
                    {renamingId === row.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(row.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(row.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        style={{
                          background: "var(--bg-2)",
                          border: "1px solid var(--accent)",
                          borderRadius: 3,
                          color: "var(--fg)",
                          fontSize: 12,
                          padding: "2px 6px",
                          width: "100%",
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                        data-testid={`rename-input-${row.id}`}
                      />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          overflow: "hidden",
                          minWidth: 0,
                        }}
                      >
                        {/* Truncation lives in `.conv-title-link` /
                            `.conv-title-text`, not here — one ellipsised line at
                            desktop, a two-line clamp at 15px on a phone. An
                            inline `whiteSpace: "nowrap"` could not be undone by
                            a media query. */}
                        <a
                          href={`/conversations/${row.id}`}
                          title={displayTitle}
                          className="conv-title-link"
                          style={{ color: "inherit", textDecoration: "none" }}
                          onClick={(e) => {
                            e.preventDefault();
                            router.push(`/conversations/${row.id}`);
                          }}
                          data-testid={`title-cell-${row.id}`}
                        >
                          <span className="conv-title-text">{displayTitle}</span>
                          {/* Phone only. The columns carrying this information
                              (Contexto, Última actividad) are hidden below `md`,
                              so it comes back here as one muted line — the space
                              the dropped columns freed is what pays for it. */}
                          <span
                            className="conv-title-meta md:hidden"
                            data-testid={`title-meta-${row.id}`}
                          >
                            {relativeTime(row.last_interaction_at)}
                            {" · "}
                            {contextLabel(row)}
                          </span>
                        </a>
                        {/* Rename is a hover-sized 12px glyph — unusable as a
                            touch target and not worth 44px of row width. Below
                            `md` it moves into the conversation
                            (ConversationDetailActions). No `display` in the
                            inline style, so Tailwind owns it (D-044). */}
                        <button
                          type="button"
                          title="Renombrar"
                          aria-label="Renombrar"
                          className="hidden md:inline"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(row);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--fg-subtle, var(--fg-muted))",
                            fontSize: 12,
                            padding: "0 2px",
                            flexShrink: 0,
                            lineHeight: 1,
                            fontFamily: "inherit",
                          }}
                          data-testid={`rename-btn-${row.id}`}
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Tipo — mode pill */}
                  <td className="hidden md:table-cell" style={{ ...tdTrunc }}>
                    <span
                      className={`${modeStyle.bg} ${modeStyle.fg}`}
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                      data-mode={row.mode}
                      data-testid={`mode-pill-${row.id}`}
                    >
                      {modeLabel(row.mode)}
                    </span>
                  </td>

                  {/* Contexto */}
                  <td className="hidden md:table-cell" style={{ ...tdTrunc }} data-testid={`context-cell-${row.id}`}>
                    {row.context_kind === "dashboard" ? (
                      row.context_dashboard_name != null ? (
                        <a
                          href={`/dashboard/${row.context_ref}`}
                          style={{
                            color: "var(--accent)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                          data-testid={`context-link-${row.id}`}
                        >
                          {row.context_dashboard_name}
                        </a>
                      ) : (
                        <span
                          style={{ color: "var(--fg-muted)" }}
                          data-testid={`context-deleted-${row.id}`}
                        >
                          {`Dashboard #${row.context_ref} (eliminado)`}
                        </span>
                      )
                    ) : row.context_kind === "home" ? (
                      <span style={{ color: "var(--fg-muted)" }}>Inicio</span>
                    ) : row.context_kind === "admin" ? (
                      <span style={{ color: "var(--fg-muted)" }}>Admin</span>
                    ) : (
                      <span style={{ color: "var(--fg-muted)" }}>Libre</span>
                    )}
                  </td>

                  {/* Última actividad */}
                  <td className="hidden md:table-cell" style={{ ...tdTrunc, fontWeight: 500 }}>
                    {relativeTime(row.last_interaction_at)}
                  </td>

                  {/* Creada */}
                  <td
                    className="hidden md:table-cell"
                    style={{
                      ...tdTrunc,
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-jetbrains, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {absoluteDate(row.created_at)}
                  </td>

                  {/* Duración */}
                  <td className="hidden md:table-cell" style={{ ...tdTrunc, color: "var(--fg-muted)" }}>
                    {formatDuration(row.duration_seconds)}
                  </td>

                  {/* Actividad */}
                  <td className="hidden md:table-cell" style={{ ...tdTrunc, color: "var(--fg-muted)" }}>
                    {row.message_count} msg
                    {row.tool_calls_count > 0 &&
                      ` · ${row.tool_calls_count} herr`}
                    {row.rounds_count > 0 && ` · ${row.rounds_count} rondas`}
                  </td>

                  {/* Tokens */}
                  <td
                    className="hidden md:table-cell"
                    style={{
                      ...tdTrunc,
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-jetbrains, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {formatTokens(row.token_total)}
                  </td>

                  {/* Acciones */}
                  <td
                    className="hidden md:table-cell"
                    style={{ ...tdStyle, textAlign: "right", overflow: "visible" }}
                  >
                    <ConversationRowActions
                      conversation={row}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
