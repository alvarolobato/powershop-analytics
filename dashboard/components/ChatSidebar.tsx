"use client";

import type { KeyboardEvent } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DashboardSpec } from "@/lib/schema";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import type { WidgetState } from "@/components/DashboardRenderer";
import LogBlock from "@/components/LogBlock";
import type { LogLine } from "@/components/LogBlock";
import type { InteractionLine } from "@/lib/db-write";
import { interactionLineClass } from "@/lib/interaction-line-class";

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
  /** Log lines captured during the API call that produced this message. */
  logs?: LogLine[];
}

export interface ChatSidebarProps {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Saved dashboard id for agentic analyze tools (optional). */
  dashboardId?: number;
  /** Live widget data from DashboardRenderer, used in the Analizar tab. */
  widgetData?: Map<number, WidgetState>;
  /** Initial analyze messages to restore on page load. */
  initialAnalyzeMessages?: ChatMessage[];
  /** Callback fired when analyze messages change (for persistence). */
  onAnalyzeMessagesChange?: (messages: ChatMessage[]) => void;
  /** Initial modify messages to restore on page load. */
  initialModifyMessages?: ChatMessage[];
  /** Callback fired when modify messages change (for persistence). */
  onModifyMessagesChange?: (messages: ChatMessage[]) => void;
  /**
   * When `pendingModifyTriggerId` changes with a non-empty `pendingModifyInput`,
   * the Modificar tab is selected, the textarea is filled, focused, and the sidebar opens if needed.
   */
  pendingModifyInput?: string;
  pendingModifyTriggerId?: number;
  /** Called once the modify pre-fill has been applied so the parent can clear state. */
  onPendingModifyInputConsumed?: () => void;
  /**
   * When `pendingAnalyzeTriggerId` changes with a non-empty `pendingAnalyzeInput`,
   * the Analizar tab is selected, the textarea is filled, focused, and the sidebar opens if needed.
   */
  pendingAnalyzeInput?: string;
  pendingAnalyzeTriggerId?: number;
  /** Called once the analyze pre-fill has been applied so the parent can clear state. */
  onPendingAnalyzeInputConsumed?: () => void;
  /**
   * Idempotent open when drill-down fires while the sidebar is collapsed.
   */
  onOpenSidebar?: () => void;
  /** When set, the sidebar opens directly in analizar mode. */
  initialMode?: "modificar" | "analizar";
  /**
   * When true, the sidebar renders nothing when closed instead of its own
   * floating "Chat" toggle button. Use when an external launcher (AnalyzeLauncher)
   * already handles opening the sidebar.
   */
  hideWhenClosed?: boolean;
}

// ---------------------------------------------------------------------------
// Suggestion chips per mode
// ---------------------------------------------------------------------------

const ANALIZAR_SUGGESTIONS = [
  "¿Por qué cayeron las ventas?",
  "Tiendas con mayor bajada",
  "Comparar con Semana Santa 2025",
];

const MODIFICAR_SUGGESTIONS = [
  "Añade widget de margen por familia",
  "Cambia comparativa a año anterior",
  "Filtra solo tiendas TOP 10",
];

// ---------------------------------------------------------------------------
// NDJSON stream reader
// ---------------------------------------------------------------------------

async function* readNdjsonStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          yield JSON.parse(t) as T;
        } catch {
          /* skip malformed lines */
        }
      }
    }
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as T;
      } catch {
        /* skip */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Helpers — serialize widget data for API calls
// ---------------------------------------------------------------------------

function truncateWidgetData(
  data: { columns: string[]; rows: unknown[][] } | null,
  maxRows: number
): { columns: string[]; rows: unknown[][] } | null {
  if (!data) return null;
  return {
    columns: data.columns,
    rows: data.rows.slice(0, maxRows),
  };
}

const CLIENT_MAX_CHART_ROWS = 100;

function serializeWidgetDataForApi(
  widgetData: Map<number, WidgetState> | undefined
): Record<string, unknown> {
  if (!widgetData) return {};
  const result: Record<string, unknown> = {};
  for (const [idx, state] of widgetData.entries()) {
    const rawData = state.data;
    let truncatedData: unknown;
    if (Array.isArray(rawData)) {
      truncatedData = rawData.map((d) =>
        d && typeof d === "object" && "rows" in d
          ? truncateWidgetData(d as { columns: string[]; rows: unknown[][] }, 1)
          : d
      );
    } else if (rawData && typeof rawData === "object" && "rows" in rawData) {
      const wd = rawData as { columns: string[]; rows: unknown[][] };
      truncatedData = truncateWidgetData(wd, CLIENT_MAX_CHART_ROWS);
    } else {
      truncatedData = rawData;
    }

    result[String(idx)] = {
      data: truncatedData,
      trendData: state.trendData?.map((d) =>
        d && typeof d === "object" && "rows" in d
          ? truncateWidgetData(d as { columns: string[]; rows: unknown[][] }, 1)
          : d
      ),
      loading: state.loading,
      error: null,
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
// MessageBubble — renders a single chat message with optional log block
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  isMarkdown = false,
  logExpanded,
  onLogToggle,
}: {
  msg: ChatMessage;
  isMarkdown?: boolean;
  logExpanded?: boolean;
  onLogToggle?: () => void;
}) {
  const isError = msg.role === "assistant" && (msg.isError === true || msg.errorDetail !== undefined);
  const isUser = msg.role === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      {/* Log block above AI messages that have logs */}
      {!isUser && msg.logs && msg.logs.length > 0 && (
        <LogBlock
          lines={msg.logs}
          expanded={logExpanded}
          onToggle={onLogToggle}
          streaming={false}
        />
      )}

      {isError ? (
        <div
          style={{
            maxWidth: "86%",
            borderRadius: 10,
            padding: "10px 12px",
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.3)",
          }}
        >
          <ErrorBubble message={msg.content} errorDetail={msg.errorDetail} />
        </div>
      ) : (
        <div
          style={{
            maxWidth: "86%",
            background: isUser ? "var(--accent)" : "var(--bg-2)",
            color: isUser ? "#fff" : "var(--fg)",
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {isMarkdown && !isUser ? (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-headings:font-semibold">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                allowedElements={[
                  "p", "br", "strong", "em",
                  "ul", "ol", "li",
                  "code", "pre", "blockquote",
                  "a", "h1", "h2", "h3", "h4", "h5", "h6",
                  "table", "thead", "tbody", "tr", "th", "td",
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
// ACTION_BUTTONS — Analizar tab presets
// ---------------------------------------------------------------------------

interface ActionButton {
  label: string;
  action: string;
  prompt: string;
}

const ACTION_BUTTONS: ActionButton[] = [
  { label: "Explícame los datos", action: "explicar", prompt: "Explícame los datos del dashboard" },
  { label: "Plan de acción", action: "plan_accion", prompt: "Propón un plan de acción basado en estos datos" },
  { label: "Detectar anomalías", action: "anomalias", prompt: "Detecta anomalías en los datos" },
  { label: "Comparar períodos", action: "comparar", prompt: "Compara los datos con el período anterior" },
  { label: "Resumen ejecutivo", action: "resumen_ejecutivo", prompt: "Genera un resumen ejecutivo" },
  { label: "Buenas prácticas", action: "buenas_practicas", prompt: "Sugiere buenas prácticas para estos datos" },
];

// ---------------------------------------------------------------------------
// Chip style helper
// ---------------------------------------------------------------------------

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 14,
  background: "var(--bg-2)",
  border: "1px solid var(--border)",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// CreationLogPanel — collapsible "Log inicial" for the Modificar tab
// ---------------------------------------------------------------------------

function CreationLogPanel({ lines }: { lines: InteractionLine[] }) {
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) return null;

  return (
    <div style={{ margin: "12px 16px 0", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)" }}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", fontSize: 11, color: "var(--fg-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-jetbrains, monospace)", textTransform: "uppercase", letterSpacing: "0.08em" }}
        aria-expanded={expanded}
        data-testid="creation-log-toggle"
      >
        <span>Log inicial ({lines.length} líneas)</span>
        <span
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}
          aria-hidden="true"
        >
          ▸
        </span>
      </button>
      {expanded && (
        <div
          style={{ maxHeight: 192, overflowY: "auto", padding: "0 12px 12px", fontSize: 11, lineHeight: 1.6 }}
          data-testid="creation-log-content"
        >
          {lines.map((l, i) => (
            <div
              key={i}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: interactionLineClass(l.kind) === "text-emerald-600 dark:text-emerald-400" ? "var(--up)" : interactionLineClass(l.kind) === "text-red-600 dark:text-red-400" ? "var(--down)" : "var(--fg-muted)" }}
            >
              {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook: fetch creation interaction lines for a saved dashboard
// ---------------------------------------------------------------------------

interface InteractionRowSummary {
  id: string;
  request_id: string;
  endpoint: "generate" | "modify" | "analyze";
  lines: InteractionLine[];
  status: "running" | "completed" | "error";
}

function useCreationLogs(dashboardId?: number): InteractionLine[] {
  const [lines, setLines] = useState<InteractionLine[]>([]);

  useEffect(() => {
    if (!dashboardId) return;
    let cancelled = false;
    fetch(`/api/dashboard/${dashboardId}/interactions`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { interactions: InteractionRowSummary[] };
        if (cancelled) return;
        const createInteraction = data.interactions.find(
          (r) => r.endpoint === "generate" && r.status === "completed",
        );
        if (createInteraction) {
          setLines(Array.isArray(createInteraction.lines) ? createInteraction.lines : []);
        }
      })
      .catch(() => {
        // Non-critical — silently ignore
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  return lines;
}


// ---------------------------------------------------------------------------
// ModificarTab
// ---------------------------------------------------------------------------

function ModificarTab({
  spec,
  onSpecUpdate,
  messages,
  setMessages,
  onMessagesChange,
  isActive,
  prefillRequest,
  onPrefillApplied,
  dashboardId,
}: {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  isActive: boolean;
  prefillRequest?: { text: string; id: number } | null;
  onPrefillApplied?: () => void;
  dashboardId?: number;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingLog, setStreamingLog] = useState<LogLine[] | null>(null);
  const creationLogs = useCreationLogs(dashboardId);
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingLog]);

  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus();
    }
  }, [isActive]);

  const appliedPrefillIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!prefillRequest?.text.trim()) return;
    if (appliedPrefillIdRef.current === prefillRequest.id) return;
    appliedPrefillIdRef.current = prefillRequest.id;
    setInput(prefillRequest.text);
    onPrefillApplied?.();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [prefillRequest?.id, prefillRequest?.text, onPrefillApplied]);

  const handleSend = useCallback(async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    setStreamingLog([]);
    const capturedLogs: LogLine[] = [];

    try {
      const res = await fetch("/api/dashboard/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, prompt: trimmed }),
      });

      // Non-streaming error (400 validation before stream opens)
      if (!res.ok || !res.body) {
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

        const newMessages: ChatMessage[] = [
          ...messages,
          userMessage,
          {
            role: "assistant",
            content: userMsg,
            timestamp: new Date(),
            isError: true,
            errorDetail,
            logs: capturedLogs,
          },
        ];
        setMessages(newMessages);
        onMessagesChange?.(newMessages);
        return;
      }

      // Stream NDJSON lines
      type ModifyMsg =
        | { type: "progress"; requestId: string; logLine: LogLine }
        | { type: "result"; requestId: string; spec: DashboardSpec }
        | { type: "error"; requestId: string; error: string; code: string; details?: string };

      for await (const msg of readNdjsonStream<ModifyMsg>(res.body)) {
        if (msg.type === "progress") {
          capturedLogs.push(msg.logLine);
          setStreamingLog([...capturedLogs]);
        } else if (msg.type === "result") {
          onSpecUpdate(msg.spec, trimmed);

          const widgetDelta = msg.spec.widgets.length - spec.widgets.length;
          let summary = "Dashboard actualizado.";
          if (widgetDelta > 0) {
            summary += ` Se ${widgetDelta === 1 ? "ha añadido 1 widget" : `han añadido ${widgetDelta} widgets`}.`;
          } else if (widgetDelta < 0) {
            summary += ` Se ${widgetDelta === -1 ? "ha eliminado 1 widget" : `han eliminado ${Math.abs(widgetDelta)} widgets`}.`;
          }

          const newMessages: ChatMessage[] = [
            ...messages,
            userMessage,
            {
              role: "assistant",
              content: summary,
              timestamp: new Date(),
              logs: capturedLogs,
            },
          ];
          setMessages(newMessages);
          onMessagesChange?.(newMessages);
        } else if (msg.type === "error") {
          const errorDetail: ApiErrorResponse | undefined = isApiErrorResponse(msg)
            ? (msg as unknown as ApiErrorResponse)
            : undefined;
          const newMessages: ChatMessage[] = [
            ...messages,
            userMessage,
            {
              role: "assistant",
              content: msg.error,
              timestamp: new Date(),
              isError: true,
              errorDetail,
              logs: capturedLogs,
            },
          ];
          setMessages(newMessages);
          onMessagesChange?.(newMessages);
        }
      }
    } catch (err) {
      console.error("Error al procesar la solicitud del chat:", err);

      const errorMessage =
        err instanceof TypeError
          ? "No se pudo conectar con el servidor."
          : "Ocurrió un problema al procesar la respuesta.";

      const newMessages: ChatMessage[] = [
        ...messages,
        userMessage,
        {
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
          isError: true,
        },
      ];
      setMessages(newMessages);
      onMessagesChange?.(newMessages);
    } finally {
      setLoading(false);
      setTimeout(() => setStreamingLog(null), 400);
    }
  }, [input, loading, spec, onSpecUpdate, setMessages, onMessagesChange, messages]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleLog = (idx: number) =>
    setExpandedLogs((e) => ({ ...e, [idx]: !e[idx] }));

  return (
    <>
      {/* Mode hint */}
      <div style={{ padding: "10px 16px 0", fontSize: 11, color: "var(--fg-subtle)" }}>
        Pide cambios al dashboard.
      </div>
      {/* Creation log (collapsible, shown when available) */}
      {creationLogs && creationLogs.length > 0 && (
        <CreationLogPanel lines={creationLogs} />
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 32 }}>
            Escribe un mensaje para modificar el dashboard.
          </p>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble
            key={idx}
            msg={msg}
            isMarkdown={false}
            logExpanded={expandedLogs[idx] ?? false}
            onLogToggle={() => toggleLog(idx)}
          />
        ))}

        {/* Streaming log block */}
        {loading && streamingLog && streamingLog.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <LogBlock lines={streamingLog} streaming />
          </div>
        )}

        {/* Simple dots fallback when log not yet started */}
        {loading && (!streamingLog || streamingLog.length === 0) && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: "var(--bg-2)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12.5,
              }}
            >
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

      {/* Input area */}
      <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
        {/* Suggestion chips */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {MODIFICAR_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSend(s)}
              disabled={loading}
              style={{ ...chipStyle, opacity: loading ? 0.5 : 1 }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Mensaje para modificar el dashboard"
            placeholder="Ej: Añade el ticket medio..."
            style={{
              flex: 1,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--fg)",
              outline: "none",
              fontFamily: "inherit",
              opacity: loading ? 0.6 : 1,
            }}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={loading || input.trim() === ""}
            aria-label="Enviar"
            style={{
              height: 32,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "0 12px",
              fontSize: 12,
              fontWeight: 500,
              cursor: loading || input.trim() === "" ? "not-allowed" : "pointer",
              opacity: loading || input.trim() === "" ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AnalizarTab
// ---------------------------------------------------------------------------

function AnalizarTab({
  spec,
  widgetData,
  messages,
  setMessages,
  onMessagesChange,
  isActive,
  dashboardId,
  prefillRequest,
  onPrefillApplied,
}: {
  spec: DashboardSpec;
  widgetData?: Map<number, WidgetState>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  isActive: boolean;
  dashboardId?: number;
  prefillRequest?: { text: string; id: number } | null;
  onPrefillApplied?: () => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [streamingLog, setStreamingLog] = useState<LogLine[] | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const appliedPrefillIdRef = useRef<number | undefined>(undefined);

  // Prefill from drilldown
  useEffect(() => {
    if (!prefillRequest?.text.trim()) return;
    if (appliedPrefillIdRef.current === prefillRequest.id) return;
    appliedPrefillIdRef.current = prefillRequest.id;
    setInput(prefillRequest.text);
    setTimeout(() => inputRef.current?.focus(), 50);
    onPrefillApplied?.();
  }, [prefillRequest?.id, prefillRequest?.text, onPrefillApplied]);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingLog]);

  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus();
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

      setStreamingLog([]);
      const capturedLogs: LogLine[] = [];

      try {
        const res = await fetch("/api/dashboard/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec,
            widgetData: serializeWidgetDataForApi(widgetData),
            prompt: trimmed,
            ...(action ? { action } : {}),
            ...(dashboardId !== undefined ? { dashboardId } : {}),
          }),
        });

        // Non-streaming error (400 validation before stream opens)
        if (!res.ok || !res.body) {
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

          const errorMessages: ChatMessage[] = [
            ...updatedMessages,
            {
              role: "assistant",
              content: userMsg,
              timestamp: new Date(),
              isError: true,
              errorDetail,
              logs: capturedLogs,
            },
          ];
          setMessages(errorMessages);
          onMessagesChange?.(errorMessages);
          return;
        }

        // Stream NDJSON lines
        type AnalyzeMsg =
          | { type: "progress"; requestId: string; logLine: LogLine }
          | { type: "result"; requestId: string; response: string; suggestions: string[] }
          | { type: "error"; requestId: string; error: string; code: string; details?: string };

        for await (const msg of readNdjsonStream<AnalyzeMsg>(res.body)) {
          if (msg.type === "progress") {
            capturedLogs.push(msg.logLine);
            setStreamingLog([...capturedLogs]);
          } else if (msg.type === "result") {
            const finalMessages: ChatMessage[] = [
              ...updatedMessages,
              {
                role: "assistant",
                content: msg.response,
                timestamp: new Date(),
                logs: capturedLogs,
              },
            ];
            setMessages(finalMessages);
            onMessagesChange?.(finalMessages);
            setSuggestions(msg.suggestions ?? []);
          } else if (msg.type === "error") {
            const errorDetail: ApiErrorResponse | undefined = isApiErrorResponse(msg)
              ? (msg as unknown as ApiErrorResponse)
              : undefined;
            const errorMessages: ChatMessage[] = [
              ...updatedMessages,
              {
                role: "assistant",
                content: msg.error,
                timestamp: new Date(),
                isError: true,
                errorDetail,
                logs: capturedLogs,
              },
            ];
            setMessages(errorMessages);
            onMessagesChange?.(errorMessages);
          }
        }
      } catch (err) {
        console.error("Error al analizar datos:", err);

        const errorMessage =
          err instanceof TypeError
            ? "No se pudo conectar con el servidor."
            : "Ocurrió un problema al procesar la respuesta.";

        const errorMessages: ChatMessage[] = [
          ...updatedMessages,
          {
            role: "assistant",
            content: errorMessage,
            timestamp: new Date(),
            isError: true,
          },
        ];
        setMessages(errorMessages);
        onMessagesChange?.(errorMessages);
      } finally {
        setLoading(false);
        setTimeout(() => setStreamingLog(null), 400);
      }
    },
    [loading, spec, widgetData, messages, setMessages, onMessagesChange, dashboardId]
  );

  const handleInputSend = useCallback(() => {
    handleSend(input);
  }, [input, handleSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInputSend();
    }
  };

  const toggleLog = (idx: number) =>
    setExpandedLogs((e) => ({ ...e, [idx]: !e[idx] }));

  return (
    <>
      {/* Mode hint */}
      <div style={{ padding: "10px 16px 0", fontSize: 11, color: "var(--fg-subtle)" }}>
        Pregunta sobre los datos.
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Action preset buttons */}
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
              style={{
                flexShrink: 0,
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "4px 10px",
                fontSize: 11,
                color: "var(--fg-muted)",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Dynamic suggestion chips */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap" data-testid="suggestion-chips">
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(suggestion)}
                disabled={loading}
                style={{
                  ...chipStyle,
                  borderColor: "rgba(var(--accent-rgb,99,102,241),0.3)",
                  background: "rgba(var(--accent-rgb,99,102,241),0.1)",
                  color: "var(--accent)",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 16 }}>
            Usa los botones de arriba o escribe una pregunta sobre los datos del dashboard.
          </p>
        )}

        {/* Message bubbles */}
        {messages.map((msg, idx) => (
          <MessageBubble
            key={idx}
            msg={msg}
            isMarkdown={msg.role === "assistant"}
            logExpanded={expandedLogs[idx] ?? false}
            onLogToggle={() => toggleLog(idx)}
          />
        ))}

        {/* Streaming log */}
        {loading && streamingLog && streamingLog.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <LogBlock lines={streamingLog} streaming />
          </div>
        )}

        {loading && (!streamingLog || streamingLog.length === 0) && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: "var(--bg-2)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12.5,
              }}
            >
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

      {/* Input area */}
      <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
        {/* Suggestion chips for analizar mode */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {ANALIZAR_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSend(s)}
              disabled={loading}
              data-testid={`suggestion-chip-${s}`}
              style={{ ...chipStyle, opacity: loading ? 0.5 : 1 }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label="Pregunta sobre los datos del dashboard"
            placeholder="Pregunta sobre los datos..."
            style={{
              flex: 1,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--fg)",
              outline: "none",
              fontFamily: "inherit",
              opacity: loading ? 0.6 : 1,
            }}
          />
          <button
            type="button"
            onClick={handleInputSend}
            disabled={loading || input.trim() === ""}
            aria-label="Enviar"
            style={{
              height: 32,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "0 12px",
              fontSize: 12,
              fontWeight: 500,
              cursor: loading || input.trim() === "" ? "not-allowed" : "pointer",
              opacity: loading || input.trim() === "" ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatSidebar — main component
// ---------------------------------------------------------------------------

export default function ChatSidebar({
  spec,
  onSpecUpdate,
  isOpen,
  onToggle,
  dashboardId,
  widgetData,
  initialAnalyzeMessages,
  onAnalyzeMessagesChange,
  initialModifyMessages,
  onModifyMessagesChange,
  pendingModifyInput,
  pendingModifyTriggerId,
  onPendingModifyInputConsumed,
  pendingAnalyzeInput,
  pendingAnalyzeTriggerId,
  onPendingAnalyzeInputConsumed,
  onOpenSidebar,
  initialMode,
  hideWhenClosed = false,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"modificar" | "analizar">(
    initialMode ?? "modificar"
  );
  const [modifyMessages, setModifyMessages] = useState<ChatMessage[]>(
    initialModifyMessages ?? []
  );
  const [analyzeMessages, setAnalyzeMessages] = useState<ChatMessage[]>(
    initialAnalyzeMessages ?? []
  );

  // Sync initialAnalyzeMessages on first mount only
  const initializedAnalyzeRef = useRef(false);
  useEffect(() => {
    if (!initializedAnalyzeRef.current && initialAnalyzeMessages && initialAnalyzeMessages.length > 0) {
      setAnalyzeMessages(initialAnalyzeMessages);
      initializedAnalyzeRef.current = true;
    }
  }, [initialAnalyzeMessages]);

  // Sync initialModifyMessages on first mount only
  const initializedModifyRef = useRef(false);
  useEffect(() => {
    if (!initializedModifyRef.current && initialModifyMessages && initialModifyMessages.length > 0) {
      setModifyMessages(initialModifyMessages);
      initializedModifyRef.current = true;
    }
  }, [initialModifyMessages]);

  // Apply initialMode changes
  useEffect(() => {
    if (initialMode) {
      setActiveTab(initialMode);
    }
  }, [initialMode]);

  // Handle pending modify prefill (opens sidebar in modify tab)
  useEffect(() => {
    if (!pendingModifyInput?.trim() || pendingModifyTriggerId === undefined) return;
    if (!isOpen) {
      (onOpenSidebar ?? onToggle)();
      return;
    }
    setActiveTab("modificar");
  }, [pendingModifyInput, pendingModifyTriggerId, isOpen, onOpenSidebar, onToggle]);

  // Handle pending analyze prefill (opens sidebar in analizar tab)
  useEffect(() => {
    if (!pendingAnalyzeInput?.trim() || pendingAnalyzeTriggerId === undefined) return;
    if (!isOpen) {
      (onOpenSidebar ?? onToggle)();
      return;
    }
    setActiveTab("analizar");
  }, [pendingAnalyzeInput, pendingAnalyzeTriggerId, isOpen, onOpenSidebar, onToggle]);

  // -------------------------------------------------------------------------
  // Collapsed state
  // -------------------------------------------------------------------------

  if (!isOpen) {
    if (hideWhenClosed) return null;
    return (
      <button
        onClick={onToggle}
        aria-label="Abrir chat"
        style={{
          position: "fixed",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 50,
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          padding: "16px 8px",
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <span
          style={{
            writingMode: "vertical-rl",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
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
      style={{
        position: "fixed",
        top: 56,
        right: 0,
        bottom: 0,
        width: 380,
        background: "var(--bg-1)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        zIndex: 15,
      }}
    >
      {/* Header */}
      <header style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>
              Asistente IA
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--fg-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--up)",
                  animation: "pulse-dot 2s ease-in-out infinite",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              Conectado · claude-sonnet
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Cerrar chat"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--fg-muted)",
              fontSize: 16,
              padding: "4px 8px",
              borderRadius: 6,
              height: 28,
              display: "flex",
              alignItems: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div
          style={{ display: "flex", gap: 0, marginTop: 6 }}
          role="tablist"
          aria-label="Pestañas del chat"
        >
          {(["analizar", "modificar"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                color: activeTab === tab ? "var(--accent)" : "var(--fg-muted)",
                borderBottom: `2px solid ${activeTab === tab ? "var(--accent)" : "transparent"}`,
                fontSize: 12,
                fontWeight: activeTab === tab ? 600 : 500,
                cursor: "pointer",
                fontFamily: "inherit",
                textTransform: "capitalize",
              }}
            >
              {tab === "modificar" ? "Modificar" : "Analizar"}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {activeTab === "modificar" ? (
          <ModificarTab
            spec={spec}
            onSpecUpdate={onSpecUpdate}
            messages={modifyMessages}
            setMessages={setModifyMessages}
            onMessagesChange={onModifyMessagesChange}
            isActive={activeTab === "modificar"}
            prefillRequest={
              pendingModifyInput?.trim() && pendingModifyTriggerId !== undefined
                ? { text: pendingModifyInput, id: pendingModifyTriggerId }
                : null
            }
            onPrefillApplied={onPendingModifyInputConsumed}
            dashboardId={dashboardId}
          />
        ) : (
          <AnalizarTab
            spec={spec}
            widgetData={widgetData}
            messages={analyzeMessages}
            setMessages={setAnalyzeMessages}
            onMessagesChange={onAnalyzeMessagesChange}
            isActive={activeTab === "analizar"}
            dashboardId={dashboardId}
            prefillRequest={
              pendingAnalyzeInput?.trim() && pendingAnalyzeTriggerId !== undefined
                ? { text: pendingAnalyzeInput, id: pendingAnalyzeTriggerId }
                : null
            }
            onPrefillApplied={onPendingAnalyzeInputConsumed}
          />
        )}
      </div>
    </aside>
  );
}
