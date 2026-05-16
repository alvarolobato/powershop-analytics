"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { ConversationWithMessages, ConversationMessage } from "@/lib/conversation-types";
import { isApiErrorResponse } from "@/lib/errors";
import { getModeStyle } from "@/lib/conversation-mode-style";
import { ConversationThread } from "./conversation/ConversationThread";
import { useConfiguredModel } from "@/lib/useConfiguredModel";

// ---------------------------------------------------------------------------
// Footer input
// ---------------------------------------------------------------------------

interface FooterProps {
  conversationId: string;
  archived: boolean;
  onMessageSent: (msg: ConversationMessage) => void;
  initialInput?: string;
}

function ConversationFooter({ conversationId, archived, onMessageSent, initialInput }: FooterProps) {
  const [input, setInput] = useState(initialInput ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // Optimistically render the user's message — the server saved it but the
    // POST response only returns the assistant reply, so the UI would otherwise
    // skip the user's turn until the next page load.
    onMessageSent({
      id: `local-user-${Date.now()}`,
      conversation_id: conversationId,
      role: "user",
      content: { text },
      created_at: new Date().toISOString(),
    });
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, callLlm: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(isApiErrorResponse(body) ? body.error : "Error al enviar el mensaje");
        return;
      }
      const data = await res.json();
      setInput("");
      // POST /messages returns { message: MessageRow } where MessageRow is the
      // assistant row when callLlm=true. Older code returned a bare string;
      // tolerate both shapes so a partial deploy doesn't break the UI.
      const raw = data?.message;
      if (raw && typeof raw === "object" && "id" in raw) {
        onMessageSent(raw as ConversationMessage);
      } else if (typeof raw === "string" && raw.length > 0) {
        onMessageSent({
          id: `local-${Date.now()}`,
          conversation_id: conversationId,
          role: "assistant",
          content: { text: raw },
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      setError("Error al enviar el mensaje");
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, onMessageSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  if (archived) {
    return (
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-1)",
        }}
        title="Desarchiva para continuar"
      >
        <input
          disabled
          placeholder="Desarchiva para continuar"
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 13,
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--fg-subtle)",
            fontFamily: "inherit",
            cursor: "not-allowed",
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "10px 14px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-1)",
      }}
    >
      {error && (
        <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--down)" }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje…"
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            padding: "8px 12px",
            fontSize: 13,
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            color: "var(--fg)",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || !input.trim()}
          style={{
            padding: "8px 16px",
            background: "var(--accent)",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: sending || !input.trim() ? "not-allowed" : "pointer",
            opacity: sending || !input.trim() ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HeaderProps {
  conv: ConversationWithMessages;
  onTitleChange: (newTitle: string) => void;
  onArchiveToggle: () => void;
  fallbackModel: string | null;
}

function ConversationHeader({ conv, onTitleChange, onArchiveToggle, fallbackModel }: HeaderProps) {
  const [editing, setEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(conv.title ?? conv.first_user_prompt ?? "");
  const [shareOpen, setShareOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [shareOpen]);

  const modeStyle = getModeStyle(conv.mode);
  const displayTitle = conv.title || conv.first_user_prompt || "Sin título";

  const saveTitle = useCallback(async () => {
    const trimmed = titleValue.trim();
    setEditing(false);
    if (!trimmed || trimmed === (conv.title ?? "")) return;
    try {
      const res = await fetch(`/api/conversations/${conv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        onTitleChange(trimmed);
      }
    } catch {
      /* silent */
    }
  }, [titleValue, conv.id, conv.title, onTitleChange]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      /* clipboard not available */
    }
    setShareOpen(false);
  }, []);

  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-1)",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {/* Title */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") {
                setEditing(false);
                setTitleValue(conv.title ?? conv.first_user_prompt ?? "");
              }
            }}
            autoFocus
            style={{
              fontSize: 16,
              fontWeight: 600,
              background: "transparent",
              border: "none",
              borderBottom: "2px solid var(--accent)",
              outline: "none",
              color: "var(--fg)",
              fontFamily: "inherit",
              width: "100%",
            }}
          />
        ) : (
          <h1
            onClick={() => {
              setTitleValue(conv.title ?? conv.first_user_prompt ?? "");
              setEditing(true);
            }}
            title="Haz clic para renombrar"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--fg)",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayTitle}
          </h1>
        )}
      </div>

      {/* Mode pill */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 12,
          background: modeStyle.bg,
          color: modeStyle.fg,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {modeStyle.label}
      </span>

      {/* Model indicator */}
      {(() => {
        const rawModel = conv.initial_context?.model ?? fallbackModel;
        if (!rawModel) return null;
        const displayModel = rawModel.split("/").pop() ?? rawModel;
        return (
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-subtle)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            title={rawModel}
          >
            {displayModel}
          </span>
        );
      })()}

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <a
          href={`/k/${conv.id}`}
          style={{
            fontSize: 12,
            color: "var(--accent)",
            textDecoration: "none",
            padding: "4px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
          }}
        >
          Abrir en contexto
        </a>
        <button
          onClick={onArchiveToggle}
          style={{
            fontSize: 12,
            color: "var(--fg-muted)",
            background: "none",
            border: "1px solid var(--border-strong)",
            borderRadius: 5,
            padding: "4px 8px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {conv.archived_at ? "Desarchivar" : "Archivar"}
        </button>

        {/* Share dropdown */}
        <div ref={shareRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShareOpen((o) => !o)}
            title="Compartir"
            aria-label="Compartir"
            style={{
              fontSize: 14,
              color: copyFeedback ? "var(--up)" : "var(--fg-muted)",
              background: "none",
              border: "1px solid var(--border-strong)",
              borderRadius: 5,
              padding: "4px 8px",
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            {copyFeedback ?? "⋯"}
          </button>
          {shareOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: "var(--bg-2)",
                border: "1px solid var(--border-strong)",
                borderRadius: 6,
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                zIndex: 20,
                minWidth: 200,
                overflow: "hidden",
              }}
              data-testid="share-dropdown"
            >
              <button
                type="button"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 14px",
                  fontSize: 13,
                  color: "var(--fg)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  borderBottom: "1px solid var(--border)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-3)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "none")
                }
                onClick={() =>
                  void copyToClipboard(
                    `${window.location.origin}/c/${conv.id}`,
                    "Copiado"
                  )
                }
                data-testid="share-copy-direct"
              >
                Copiar enlace directo
              </button>
              <button
                type="button"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 14px",
                  fontSize: 13,
                  color: "var(--fg)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "var(--bg-3)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background =
                    "none")
                }
                onClick={() =>
                  void copyToClipboard(
                    `${window.location.origin}/k/${conv.id}`,
                    "Copiado"
                  )
                }
                data-testid="share-copy-context"
              >
                Copiar enlace en contexto
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ConversationViewer
// ---------------------------------------------------------------------------

interface ConversationViewerProps {
  initial: ConversationWithMessages;
}

export function ConversationViewer({ initial }: ConversationViewerProps) {
  const [conv, setConv] = useState<ConversationWithMessages>(initial);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fallbackModel = useConfiguredModel();

  // Scroll to bottom when messages change
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [conv.messages.length]);

  const handleTitleChange = useCallback((newTitle: string) => {
    setConv((c) => ({ ...c, title: newTitle }));
  }, []);

  const handleArchiveToggle = useCallback(async () => {
    const archived = !conv.archived_at;
    try {
      const res = await fetch(`/api/conversations/${conv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        setConv((c) => ({
          ...c,
          archived_at: archived ? new Date().toISOString() : null,
        }));
      }
    } catch {
      /* silent */
    }
  }, [conv.id, conv.archived_at]);

  const handleMessageSent = useCallback((msg: ConversationMessage) => {
    setConv((c) => ({ ...c, messages: [...c.messages, msg] }));
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <ConversationHeader
        conv={conv}
        onTitleChange={handleTitleChange}
        onArchiveToggle={() => void handleArchiveToggle()}
        fallbackModel={fallbackModel}
      />

      {/* Body */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 14px",
        }}
      >
        <ConversationThread conversation={conv} />
      </div>

      {/* Footer */}
      <ConversationFooter
        conversationId={conv.id}
        archived={!!conv.archived_at}
        onMessageSent={handleMessageSent}
        initialInput={initial.messages.length === 0 ? (initial.first_user_prompt ?? undefined) : undefined}
      />
    </div>
  );
}
