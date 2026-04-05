"use client";

import type { KeyboardEvent } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { DashboardSpec } from "@/lib/schema";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import type { WidgetState } from "@/components/DashboardRenderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Structured error detail attached to an assistant error message. */
  errorDetail?: ApiErrorResponse;
  /** True when this assistant message is an error (even without structured details). */
  isError?: boolean;
}

export interface ChatSidebarProps {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Live widget data from DashboardRenderer, used in the Analizar tab. */
  widgetData?: Map<number, WidgetState>;
  /** Initial analyze messages to restore on page load. */
  initialAnalyzeMessages?: ChatMessage[];
  /** Callback fired when analyze messages change (for persistence). */
  onAnalyzeMessagesChange?: (messages: ChatMessage[]) => void;
}

// ---------------------------------------------------------------------------
// Action button definitions
// ---------------------------------------------------------------------------

interface ActionButton {
  label: string;
  action: string;
  prompt: string;
}

const ACTION_BUTTONS: ActionButton[] = [
  {
    label: "Explícame los datos",
    action: "explicar",
    prompt: "Explícame los datos del dashboard",
  },
  {
    label: "Plan de acción",
    action: "plan_accion",
    prompt: "Propón un plan de acción basado en estos datos",
  },
  {
    label: "Detectar anomalías",
    action: "anomalias",
    prompt: "Detecta anomalías en los datos",
  },
  {
    label: "Comparar períodos",
    action: "comparar",
    prompt: "Compara los datos con el período anterior",
  },
  {
    label: "Resumen ejecutivo",
    action: "resumen_ejecutivo",
    prompt: "Genera un resumen ejecutivo",
  },
  {
    label: "Buenas prácticas",
    action: "buenas_practicas",
    prompt: "Sugiere buenas prácticas para estos datos",
  },
];

// ---------------------------------------------------------------------------
// Helpers — serialize widget data for API calls
// ---------------------------------------------------------------------------

function serializeWidgetDataForApi(
  widgetData: Map<number, WidgetState> | undefined
): Record<string, unknown> {
  if (!widgetData) return {};
  const result: Record<string, unknown> = {};
  for (const [idx, state] of widgetData.entries()) {
    result[String(idx)] = {
      data: state.data,
      trendData: state.trendData,
      loading: state.loading,
      error: null, // don't serialize error objects
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// ErrorBubble — expandable error detail inside a chat message
// ---------------------------------------------------------------------------

function ErrorBubble({ message, errorDetail }: { message: string; errorDetail?: ApiErrorResponse }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel pending copy-reset timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(errorDetail, null, 2));
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="text-sm text-red-400">
      <p>{message}</p>
      {errorDetail && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
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
              className="mt-1 rounded bg-red-900/20 p-2 text-xs font-mono space-y-0.5 text-red-300"
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
                className="mt-1 text-xs text-red-400 hover:text-red-300 underline"
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
// MessageBubble — renders a single chat message
// ---------------------------------------------------------------------------

function MessageBubble({ msg, isMarkdown = false }: { msg: ChatMessage; isMarkdown?: boolean }) {
  const isError = msg.role === "assistant" && (msg.isError === true || msg.errorDetail !== undefined);

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30">
          <ErrorBubble message={msg.content} errorDetail={msg.errorDetail} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      {msg.role === "user" ? (
        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-blue-500 text-white">
          {msg.content}
        </div>
      ) : (
        <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
          {isMarkdown ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-headings:font-semibold">
              <ReactMarkdown
                allowedElements={[
                  "p", "br", "strong", "em",
                  "ul", "ol", "li",
                  "code", "pre", "blockquote",
                  "a", "h1", "h2", "h3", "h4", "h5", "h6",
                ]}
                components={{
                  a: ({ ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            msg.content
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModificarTab — exact current behavior, zero changes
// ---------------------------------------------------------------------------

function ModificarTab({
  spec,
  onSpecUpdate,
  messages,
  setMessages,
  isActive,
}: {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isActive: boolean;
}) {
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

  // Focus textarea when tab becomes active
  useEffect(() => {
    if (isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

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
          if (isApiErrorResponse(errBody)) {
            errorDetail = errBody;
            userMsg = errBody.error;
          } else {
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

        if (res.status === 429) {
          userMsg = "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.";
        }

        console.error("Modify API error:", errorDetail ?? userMsg);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: userMsg,
            timestamp: new Date(),
            isError: true,
            errorDetail,
          },
        ]);
        return;
      }

      const newSpec: DashboardSpec = await res.json();
      onSpecUpdate(newSpec, trimmed);

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
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, spec, onSpecUpdate, setMessages]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-center mt-8">
            Escribe un mensaje para modificar el dashboard.
          </p>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={idx} msg={msg} isMarkdown={false} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle text-tremor-content dark:text-dark-tremor-content rounded-lg px-3 py-2 text-sm">
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
      <div className="border-t border-tremor-border dark:border-dark-tremor-border px-4 py-3 bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle">
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
            className="flex-1 resize-none rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-2 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis placeholder:text-tremor-content-subtle dark:placeholder:text-dark-tremor-content-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || input.trim() === ""}
            aria-label="Enviar"
            className="self-end rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AnalizarTab — AI data analyst with action presets + suggestions
// ---------------------------------------------------------------------------

function AnalizarTab({
  spec,
  widgetData,
  messages,
  setMessages,
  onMessagesChange,
  isActive,
}: {
  spec: DashboardSpec;
  widgetData?: Map<number, WidgetState>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  isActive: boolean;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Focus textarea when tab becomes active
  useEffect(() => {
    if (isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

  const handleSend = useCallback(
    async (promptText: string, action?: string) => {
      const trimmed = promptText.trim();
      if (!trimmed || loading) return;

      const userMessage: ChatMessage = {
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setSuggestions([]);
      setLoading(true);

      try {
        const res = await fetch("/api/dashboard/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec,
            widgetData: serializeWidgetDataForApi(widgetData),
            prompt: trimmed,
            ...(action ? { action } : {}),
          }),
        });

        if (!res.ok) {
          let errorDetail: ApiErrorResponse | undefined;
          let userMsg: string;

          try {
            const errBody = await res.json();
            if (isApiErrorResponse(errBody)) {
              errorDetail = errBody;
              userMsg = errBody.error;
            } else {
              userMsg =
                res.status >= 500
                  ? "Error interno del servidor. Inténtalo de nuevo."
                  : "No se pudo analizar los datos. Revisa tu petición.";
            }
          } catch {
            userMsg =
              res.status >= 500
                ? "Error interno del servidor. Inténtalo de nuevo."
                : "No se pudo analizar los datos. Revisa tu petición.";
          }

          if (res.status === 429) {
            userMsg = "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.";
          }

          console.error("Analyze API error:", errorDetail ?? userMsg);

          const errorMessages = [
            ...updatedMessages,
            {
              role: "assistant" as const,
              content: userMsg,
              timestamp: new Date(),
              isError: true,
              errorDetail,
            },
          ];
          setMessages(errorMessages);
          onMessagesChange?.(errorMessages);
          return;
        }

        const data = await res.json() as { response: string; suggestions: string[] };

        const finalMessages = [
          ...updatedMessages,
          {
            role: "assistant" as const,
            content: data.response,
            timestamp: new Date(),
          },
        ];
        setMessages(finalMessages);
        onMessagesChange?.(finalMessages);
        setSuggestions(data.suggestions ?? []);
      } catch (err) {
        console.error("Error al analizar datos:", err);

        const errorMessage =
          err instanceof TypeError
            ? "No se pudo conectar con el servidor."
            : "Ocurrió un problema al procesar la respuesta.";

        const errorMessages = [
          ...updatedMessages,
          {
            role: "assistant" as const,
            content: errorMessage,
            timestamp: new Date(),
            isError: true,
          },
        ];
        setMessages(errorMessages);
        onMessagesChange?.(errorMessages);
      } finally {
        setLoading(false);
      }
    },
    [loading, spec, widgetData, messages, setMessages, onMessagesChange]
  );

  const handleInputSend = useCallback(() => {
    handleSend(input);
  }, [input, handleSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInputSend();
    }
  };

  const handleChipClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion);
    },
    [handleSend]
  );

  return (
    <>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Action buttons — always visible at the top */}
        <div
          className="flex gap-2 overflow-x-auto pb-2 flex-nowrap"
          data-testid="action-buttons-row"
        >
          {ACTION_BUTTONS.map((btn) => (
            <button
              key={btn.action}
              type="button"
              onClick={() => handleSend(btn.prompt, btn.action)}
              disabled={loading}
              data-action={btn.action}
              className="flex-shrink-0 rounded-full border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle px-3 py-1.5 text-xs font-medium text-tremor-content dark:text-dark-tremor-content hover:bg-tremor-background dark:hover:bg-dark-tremor-background hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Suggested question chips */}
        {suggestions.length > 0 && (
          <div
            className="flex gap-2 flex-wrap"
            data-testid="suggestion-chips"
          >
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleChipClick(suggestion)}
                disabled={loading}
                className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && (
          <p className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-center mt-4">
            Usa los botones de arriba o escribe una pregunta sobre los datos del dashboard.
          </p>
        )}

        {/* Message bubbles */}
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} msg={msg} isMarkdown={msg.role === "assistant"} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle text-tremor-content dark:text-dark-tremor-content rounded-lg px-3 py-2 text-sm">
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
      <div className="border-t border-tremor-border dark:border-dark-tremor-border px-4 py-3 bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Pregunta sobre los datos del dashboard"
            placeholder="Pregunta sobre los datos..."
            rows={2}
            className="flex-1 resize-none rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-2 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis placeholder:text-tremor-content-subtle dark:placeholder:text-dark-tremor-content-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleInputSend}
            disabled={loading || input.trim() === ""}
            aria-label="Enviar"
            className="self-end rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>
    </>
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
  widgetData,
  initialAnalyzeMessages,
  onAnalyzeMessagesChange,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"modificar" | "analizar">("modificar");
  const [modifyMessages, setModifyMessages] = useState<ChatMessage[]>([]);
  const [analyzeMessages, setAnalyzeMessages] = useState<ChatMessage[]>(
    initialAnalyzeMessages ?? []
  );

  // Sync initialAnalyzeMessages on first mount only
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && initialAnalyzeMessages && initialAnalyzeMessages.length > 0) {
      setAnalyzeMessages(initialAnalyzeMessages);
      initializedRef.current = true;
    }
  }, [initialAnalyzeMessages]);

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
      className="fixed right-0 top-0 h-full w-[350px] bg-tremor-background dark:bg-dark-tremor-background border-l border-tremor-border dark:border-dark-tremor-border shadow-xl flex flex-col z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle">
        <h2 className="text-sm font-semibold text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
          Asistente IA
        </h2>
        <button
          onClick={onToggle}
          aria-label="Cerrar chat"
          className="text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Tab bar */}
      <div
        className="flex border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle"
        role="tablist"
        aria-label="Pestañas del chat"
      >
        <button
          role="tab"
          aria-selected={activeTab === "modificar"}
          data-testid="tab-modificar"
          onClick={() => setActiveTab("modificar")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors focus:outline-none ${
            activeTab === "modificar"
              ? "border-b-2 border-blue-500 text-blue-500 -mb-px"
              : "text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis"
          }`}
        >
          Modificar
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "analizar"}
          data-testid="tab-analizar"
          onClick={() => setActiveTab("analizar")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors focus:outline-none ${
            activeTab === "analizar"
              ? "border-b-2 border-blue-500 text-blue-500 -mb-px"
              : "text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis"
          }`}
        >
          Analizar
        </button>
      </div>

      {/* Tab content — fills remaining height */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "modificar" ? (
          <ModificarTab
            spec={spec}
            onSpecUpdate={onSpecUpdate}
            messages={modifyMessages}
            setMessages={setModifyMessages}
            isActive={activeTab === "modificar"}
          />
        ) : (
          <AnalizarTab
            spec={spec}
            widgetData={widgetData}
            messages={analyzeMessages}
            setMessages={setAnalyzeMessages}
            onMessagesChange={onAnalyzeMessagesChange}
            isActive={activeTab === "analizar"}
          />
        )}
      </div>
    </aside>
  );
}
