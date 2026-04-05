"use client";

import type { KeyboardEvent } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { DashboardSpec } from "@/lib/schema";
import type { ApiErrorResponse } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Structured error detail attached to an assistant error message. */
  errorDetail?: ApiErrorResponse;
}

export interface ChatSidebarProps {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

// ---------------------------------------------------------------------------
// ErrorBubble — expandable error detail inside a chat message
// ---------------------------------------------------------------------------

function ErrorBubble({ message, errorDetail }: { message: string; errorDetail?: ApiErrorResponse }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(errorDetail, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="text-sm text-red-700">
      <p>{message}</p>
      {errorDetail && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
            aria-expanded={expanded}
            data-testid="chat-toggle-details"
          >
            <span
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
              className="inline-block transition-transform"
              aria-hidden="true"
            >
              &#9656;
            </span>
            Detalles técnicos
          </button>
          {expanded && (
            <div
              className="mt-1 rounded bg-red-100 p-2 text-xs font-mono space-y-0.5"
              data-testid="chat-error-details"
            >
              <div>
                <span className="font-semibold">Código:</span> {errorDetail.code}
              </div>
              <div>
                <span className="font-semibold">ID:</span> {errorDetail.requestId}
              </div>
              {errorDetail.details && (
                <div>
                  <span className="font-semibold">Detalle:</span>{" "}
                  <span className="whitespace-pre-wrap">{errorDetail.details}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
              >
                {copied ? "Copiado!" : "Copiar detalles"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatSidebar({
  spec,
  onSpecUpdate,
  isOpen,
  onToggle,
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Focus textarea when sidebar opens
  useEffect(() => {
    if (isOpen) {
      textareaRef.current?.focus();
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/dashboard/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, prompt: trimmed }),
      });

      if (!res.ok) {
        let errorDetail: ApiErrorResponse | undefined;
        let userMsg: string;

        try {
          const errBody = await res.json();
          // Check if this is our structured error format
          if (errBody && typeof errBody === "object" && "code" in errBody && "requestId" in errBody) {
            errorDetail = errBody as ApiErrorResponse;
            userMsg = errBody.error as string;
          } else {
            // Non-structured error — use generic message by HTTP status
            userMsg =
              res.status >= 500
                ? "Error interno del servidor. Inténtalo de nuevo."
                : "No se pudo aplicar la modificación. Revisa tu petición.";
          }
        } catch {
          userMsg =
            res.status >= 500
              ? "Error interno del servidor. Inténtalo de nuevo."
              : "No se pudo aplicar la modificación. Revisa tu petición.";
        }

        // Override with rate-limit specific message
        if (res.status === 429) {
          userMsg =
            "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.";
        }

        console.error("Modify API error:", errorDetail ?? userMsg);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: userMsg,
            timestamp: new Date(),
            errorDetail,
          },
        ]);
        return;
      }

      const newSpec: DashboardSpec = await res.json();
      onSpecUpdate(newSpec, trimmed);

      // Build a summary of what changed
      const widgetDelta = newSpec.widgets.length - spec.widgets.length;
      let summary = "Dashboard actualizado.";
      if (widgetDelta > 0) {
        summary += ` Se ${widgetDelta === 1 ? "ha añadido 1 widget" : `han añadido ${widgetDelta} widgets`}.`;
      } else if (widgetDelta < 0) {
        summary += ` Se ${widgetDelta === -1 ? "ha eliminado 1 widget" : `han eliminado ${Math.abs(widgetDelta)} widgets`}.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: summary,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      console.error("Error al procesar la solicitud del chat:", err);

      const errorMessage =
        err instanceof TypeError
          ? "No se pudo conectar con el servidor."
          : "Ocurrió un problema al procesar la respuesta.";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, spec, onSpecUpdate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // -------------------------------------------------------------------------
  // Collapsed state: show a small tab to reopen
  // -------------------------------------------------------------------------

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        aria-label="Abrir chat"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-blue-600 text-white px-2 py-4 rounded-l-lg shadow-lg hover:bg-blue-700 transition-colors"
      >
        <span className="writing-mode-vertical text-sm font-medium [writing-mode:vertical-rl]">
          Chat
        </span>
      </button>
    );
  }

  // -------------------------------------------------------------------------
  // Open state
  // -------------------------------------------------------------------------

  return (
    <aside
      data-testid="chat-sidebar"
      className="fixed right-0 top-0 h-full w-[350px] bg-white border-l border-gray-200 shadow-xl flex flex-col z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-800">
          Modificar Dashboard
        </h2>
        <button
          onClick={onToggle}
          aria-label="Cerrar chat"
          className="text-gray-500 hover:text-gray-700 text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 text-center mt-8">
            Escribe un mensaje para modificar el dashboard.
          </p>
        )}

        {messages.map((msg, idx) => {
          const isError = msg.role === "assistant" && msg.errorDetail !== undefined;
          return (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {isError ? (
                <div className="max-w-[85%] rounded-lg px-3 py-2 bg-red-50 border border-red-200">
                  <ErrorBubble
                    message={msg.content}
                    errorDetail={msg.errorDetail}
                  />
                </div>
              ) : (
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {msg.content}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-lg px-3 py-2 text-sm">
              <span className="inline-flex gap-1" aria-label="Procesando">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce [animation-delay:0.15s]">.</span>
                <span className="animate-bounce [animation-delay:0.3s]">.</span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Mensaje para modificar el dashboard"
            placeholder="Ej: Añade el ticket medio..."
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || input.trim() === ""}
            aria-label="Enviar"
            className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>
    </aside>
  );
}
