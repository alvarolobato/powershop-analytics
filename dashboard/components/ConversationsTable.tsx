"use client";

import { useState } from "react";
import { getModePillStyle } from "@/lib/conversation-mode-style";
import { ConversationRowActions } from "@/components/ConversationRowActions";
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
  if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} semanas`;
  return `hace ${Math.floor(diffDays / 30)} meses`;
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

function contextLabel(row: ConversationRow): string {
  const kindLabels: Record<string, string> = {
    dashboard: "Dashboard",
    home: "Inicio",
    admin: "Admin",
    global: "Global",
  };
  const kindStr = kindLabels[row.context_kind ?? ""] ?? row.context_kind ?? "";
  if (row.context_ref) return `${kindStr} · ${row.context_ref}`;
  return kindStr;
}

function statusPill(row: ConversationRow) {
  if (row.archived_at) {
    return { label: "Archivada", bg: "var(--bg-3)", fg: "var(--fg-muted)" };
  }
  if (row.last_status === "error") {
    return { label: "Con errores", bg: "var(--down-bg)", fg: "var(--down)" };
  }
  return { label: "Activa", bg: "var(--up-bg)", fg: "var(--up)" };
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
  const [sort, setSort] = useState<SortState>({
    col: "last_interaction_at",
    dir: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Sort
  const sorted = [...conversations].sort((a, b) => {
    const aVal = a[sort.col];
    const bVal = b[sort.col];
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sort.dir === "desc" ? -cmp : cmp;
  });

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
    setRenameValue(row.title ?? "");
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) {
      onRename(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  // Styles
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

  const tdStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 12,
    color: "var(--fg)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
    maxWidth: 200,
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
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            fontSize: 13,
          }}
          data-testid="bulk-action-bar"
        >
          <span style={{ color: "var(--fg-muted)" }}>
            {selected.size} seleccionada{selected.size !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
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
          <button
            type="button"
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
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 180 }} />
          </colgroup>
          <thead>
            <tr>
              {/* Checkbox header */}
              <th style={{ ...thStyle, width: 32 }}>
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
              <th style={thStyle}>Tipo</th>
              <th style={thStyle}>Contexto</th>
              <th style={thStyle}>{sortBtn("last_interaction_at", "Última actividad")}</th>
              <th style={thStyle}>{sortBtn("created_at", "Creada")}</th>
              <th style={thStyle}>Duración</th>
              <th style={thStyle}>Actividad</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Vista previa</th>
              <th style={thStyle}>Estado</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const pill = statusPill(row);
              const modeStyle = getModePillStyle(row.mode);
              const displayTitle =
                row.title ??
                (row.first_user_prompt
                  ? row.first_user_prompt.slice(0, 60) +
                    (row.first_user_prompt.length > 60 ? "…" : "")
                  : "(sin título)");

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
                  <td style={{ ...tdStyle, width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      aria-label={`Seleccionar ${displayTitle}`}
                      style={{ cursor: "pointer" }}
                    />
                  </td>

                  {/* Título */}
                  <td style={{ ...tdStyle }}>
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
                      <span
                        title={displayTitle}
                        style={{ cursor: "pointer" }}
                        onClick={() => startRename(row)}
                        data-testid={`title-cell-${row.id}`}
                      >
                        {displayTitle}
                      </span>
                    )}
                  </td>

                  {/* Tipo — mode pill */}
                  <td style={{ ...tdStyle }}>
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
                  <td style={{ ...tdStyle }}>
                    <span
                      title={contextLabel(row)}
                      style={{ cursor: "pointer", textDecoration: "none" }}
                      onClick={() =>
                        row.context_kind !== "global" &&
                        typeof window !== "undefined" &&
                        (window.location.href = `/k/${row.id}`)
                      }
                    >
                      {contextLabel(row)}
                    </span>
                  </td>

                  {/* Última actividad */}
                  <td style={{ ...tdStyle, fontWeight: 500 }}>
                    {relativeTime(row.last_interaction_at)}
                  </td>

                  {/* Creada */}
                  <td
                    style={{
                      ...tdStyle,
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-jetbrains, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {absoluteDate(row.created_at)}
                  </td>

                  {/* Duración */}
                  <td style={{ ...tdStyle, color: "var(--fg-muted)" }}>
                    {formatDuration(row.duration_seconds)}
                  </td>

                  {/* Actividad */}
                  <td style={{ ...tdStyle, color: "var(--fg-muted)" }}>
                    {row.message_count} msg
                    {row.tool_calls_count > 0 &&
                      ` · ${row.tool_calls_count} herr`}
                    {row.rounds_count > 0 && ` · ${row.rounds_count} rondas`}
                  </td>

                  {/* Tokens */}
                  <td
                    style={{
                      ...tdStyle,
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-jetbrains, monospace)",
                      fontSize: 11,
                    }}
                  >
                    {formatTokens(row.token_total)}
                  </td>

                  {/* Vista previa */}
                  <td
                    style={{
                      ...tdStyle,
                      color: "var(--fg-muted)",
                      maxWidth: 220,
                    }}
                    title={row.last_message_preview ?? undefined}
                  >
                    {row.last_message_preview
                      ? row.last_message_preview.slice(0, 80) +
                        (row.last_message_preview.length > 80 ? "…" : "")
                      : "—"}
                  </td>

                  {/* Estado */}
                  <td style={{ ...tdStyle }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 7px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                        background: pill.bg,
                        color: pill.fg,
                        whiteSpace: "nowrap",
                      }}
                      data-testid={`status-pill-${row.id}`}
                    >
                      {pill.label}
                    </span>
                  </td>

                  {/* Acciones */}
                  <td style={{ ...tdStyle, textAlign: "right", overflow: "visible" }}>
                    <ConversationRowActions
                      conversation={row}
                      onArchiveToggle={onArchiveToggle}
                      onRenameStart={() => startRename(row)}
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
