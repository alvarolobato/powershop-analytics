"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ConversationWithMessages,
  ConversationMessage,
  AssistantMessageContent,
} from "@/lib/conversation-types";
import {
  isAssistantContent,
  isToolResultContent,
  getMessageText,
} from "@/lib/conversation-types";
import { InitialContextPanel } from "@/components/InitialContextPanel";
import { InlineToolCall } from "@/components/InlineToolCall";
import { RoundDivider } from "@/components/RoundDivider";
import AgenticErrorDetails from "@/components/AgenticErrorDetails";
import type { AgenticErrorDiagnostic } from "@/lib/errors";
import { isApiErrorResponse } from "@/lib/errors";
import { generateRequestId } from "@/lib/errors";
import { getModeStyle } from "@/lib/conversation-mode-style";

// ---------------------------------------------------------------------------
// Round detection
//
// Each assistant message that contains tool_calls belongs to a round.
// A "round" ends when the assistant emits a final message without tool_calls.
// We assign round numbers by scanning the message list sequentially.
// ---------------------------------------------------------------------------

interface RoundedMessage {
  msg: ConversationMessage;
  roundStart?: number; // insert divider before this message with this round number
}

function annotateRounds(messages: ConversationMessage[]): RoundedMessage[] {
  const result: RoundedMessage[] = [];
  let round = 1;
  let hasToolCallsInRound = false;

  for (const msg of messages) {
    let insertDivider: number | undefined;

    if (msg.role === "assistant") {
      const ac = isAssistantContent(msg.content) ? msg.content : null;
      const hasTools = ac?.tool_calls && ac.tool_calls.length > 0;

      if (hasTools) {
        // Starting a new agentic round — show divider (from round 2 onwards)
        if (round > 1 || hasToolCallsInRound) {
          insertDivider = round;
        }
        hasToolCallsInRound = true;
        round++;
      } else if (hasToolCallsInRound) {
        // Final message after tool rounds — no divider
        hasToolCallsInRound = false;
      }
    }

    result.push({ msg, roundStart: insertDivider });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

interface UserBubbleProps {
  text: string;
}

function UserBubble({ text }: UserBubbleProps) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <div
        style={{
          maxWidth: "85%",
          background: "var(--accent-soft)",
          border: "1px solid var(--accent)",
          borderRadius: "12px 12px 2px 12px",
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--fg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        data-testid="user-bubble"
      >
        {text}
      </div>
    </div>
  );
}

interface AssistantBubbleProps {
  content: AssistantMessageContent;
}

function AssistantBubble({ content }: AssistantBubbleProps) {
  const text = content.text ?? "";
  const hasError = content.is_error || !!content.error_detail;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const errorStyle: React.CSSProperties = hasError
    ? { borderLeft: "3px solid var(--down)", borderRadius: "2px 12px 12px 2px" }
    : { borderRadius: "12px 12px 12px 2px" };

  // Build a minimal ApiErrorResponse shell for AgenticErrorDetails
  const errorResponse = hasError
    ? {
        error: text || "Error en la respuesta del asistente",
        code: "AGENTIC_RUNNER" as const,
        details: undefined,
        timestamp: new Date().toISOString(),
        requestId: generateRequestId(),
        diagnostic: content.error_detail as AgenticErrorDiagnostic | undefined,
      }
    : null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          maxWidth: "85%",
          background: hasError ? "color-mix(in srgb, var(--down) 8%, var(--bg-1))" : "var(--bg-1)",
          border: `1px solid ${hasError ? "var(--down)" : "var(--border)"}`,
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--fg)",
          ...errorStyle,
        }}
        data-testid="assistant-bubble"
      >
        {hasError && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: text ? 6 : 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--down)",
                fontFamily: "var(--font-jetbrains, monospace)",
              }}
            >
              {content.error_detail
                ? `Error: ${(content.error_detail as AgenticErrorDiagnostic & { subError?: string }).subError?.split(":")[0] ?? "AGENTIC_RUNNER"}`
                : "Error"}
            </span>
            <button
              onClick={() => setDetailsOpen((o) => !o)}
              style={{
                fontSize: 11,
                color: "var(--down)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
                textDecoration: "underline",
              }}
            >
              {detailsOpen ? "Ocultar detalles" : "Ver detalles"}
            </button>
          </div>
        )}
        {text && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}
        {hasError && detailsOpen && errorResponse && (
          <div style={{ marginTop: 8 }}>
            <AgenticErrorDetails errorDetail={errorResponse} skipHeader />
          </div>
        )}
      </div>

      {/* Inline tool call cards */}
      {content.tool_calls && content.tool_calls.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 8 }}>
          {content.tool_calls.map((call) => (
            <InlineToolCall key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ name, content }: { name: string; content: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        marginBottom: 6,
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 12,
        overflow: "hidden",
      }}
      data-testid="tool-result-card"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 10px",
          background: "var(--bg-1)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--font-jetbrains, monospace)",
          fontSize: 11,
          color: "var(--fg-muted)",
        }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 10 }}>{open ? "▾" : "▸"}</span>
        Resultado: {name}
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: "6px 10px",
            fontSize: 11,
            fontFamily: "var(--font-jetbrains, monospace)",
            color: "var(--fg)",
            background: "var(--bg-0, var(--bg))",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflowY: "auto",
            borderTop: "1px solid var(--border)",
          }}
        >
          {JSON.stringify(content, null, 2)}
        </pre>
      )}
    </div>
  );
}

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
      // data should be the newly created assistant message
      setInput("");
      if (data?.message) {
        onMessageSent(data.message as ConversationMessage);
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
}

function ConversationHeader({ conv, onTitleChange, onArchiveToggle }: HeaderProps) {
  const [editing, setEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(conv.title ?? conv.first_user_prompt ?? "");
  const [copied, setCopied] = useState(false);

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

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/c/${conv.id}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  }, [conv.id]);

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
        <button
          onClick={() => void copyLink()}
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
          {copied ? "Copiado" : "Copiar enlace"}
        </button>
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

  const annotated = annotateRounds(conv.messages);

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
        {/* Initial context panel */}
        {conv.initial_context && (
          <InitialContextPanel context={conv.initial_context} />
        )}

        {/* Messages */}
        {annotated.map(({ msg, roundStart }) => (
          <div key={msg.id}>
            {roundStart !== undefined && <RoundDivider round={roundStart} />}

            {msg.role === "user" && (
              <UserBubble text={getMessageText(msg.content)} />
            )}

            {msg.role === "assistant" && (() => {
              const ac = isAssistantContent(msg.content) ? msg.content : { text: getMessageText(msg.content) };
              return <AssistantBubble content={ac} />;
            })()}

            {msg.role === "tool" && isToolResultContent(msg.content) && (
              <ToolResultCard
                name={msg.content.tool_name}
                content={msg.content.content}
              />
            )}
          </div>
        ))}

        {conv.messages.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--fg-muted)", textAlign: "center", marginTop: 40 }}>
            No hay mensajes en esta conversación.
          </p>
        )}
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
