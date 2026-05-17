"use client";

import type { KeyboardEvent } from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { DashboardSpec } from "@/lib/schema";
import { isApiErrorResponse, generateRequestId } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import type { WidgetState } from "@/components/DashboardRenderer";
import LogBlock from "@/components/LogBlock";
import type { LogLine } from "@/components/LogBlock";
import { appendCoalescedLogLine } from "@/lib/format-agentic-progress";
import type { InteractionLine } from "@/lib/db-write";
import { interactionLineClass } from "@/lib/interaction-line-class";
import PreviousConversations from "@/components/PreviousConversations";
import { InitialContextPanel } from "@/components/InitialContextPanel";
import type { InitialContext } from "@/lib/conversation-types";
import type { ChatMessage, ConversationApiMessage } from "./conversation/types";
import { MessageList } from "./conversation/MessageList";
import { convertConversationMessages } from "./conversation/convertConversationMessages";
import { useConfiguredModel, displayModelName } from "@/lib/useConfiguredModel";
import { useDashboardConversation } from "@/lib/useDashboardConversation";

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Extract a user-facing message and a structured ApiErrorResponse from an
 * unknown API error body (JSON or raw). When the body isn't a proper
 * ApiErrorResponse we still surface the raw `.error` / `.message` field and
 * wrap the whole body in a synthetic ApiErrorResponse so the ErrorBubble
 * "Detalles técnicos" section shows something meaningful instead of nothing.
 */
function parseApiError(
  errBody: unknown,
  httpStatus: number,
  fallbackMsg: string,
): { userMsg: string; errorDetail: ApiErrorResponse } {
  if (isApiErrorResponse(errBody)) {
    return { userMsg: errBody.error, errorDetail: errBody };
  }
  // Not a proper ApiErrorResponse — still try to extract a message.
  const raw = errBody as Record<string, unknown> | null | undefined;
  const extracted =
    (typeof raw?.error === "string" && raw.error) ||
    (typeof raw?.message === "string" && raw.message) ||
    null;
  const userMsg = extracted ?? fallbackMsg;
  // Wrap raw body as `details` so it's visible in the error panel.
  const details =
    raw !== null && raw !== undefined
      ? JSON.stringify(raw, null, 2).slice(0, 1000)
      : `HTTP ${httpStatus}`;
  const errorDetail: ApiErrorResponse = {
    error: userMsg,
    code: httpStatus >= 500 ? "UNKNOWN" : "UNKNOWN",
    details,
    timestamp: new Date().toISOString(),
    requestId: generateRequestId(),
  };
  return { userMsg, errorDetail };
}

// ---------------------------------------------------------------------------
// Re-export ChatMessage so existing consumers (e.g. DashboardSurface) keep
// working without changing their import paths.
// ---------------------------------------------------------------------------

export type { ChatMessage };

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
  /** Initial modify messages to restore on page load. */
  initialModifyMessages?: ChatMessage[];
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
  /** LLM initial context from a preloaded modify conversation (e.g., /k/:id). */
  initialModifyContext?: InitialContext | null;
  /** LLM initial context from a preloaded analyze conversation (e.g., /k/:id). */
  initialAnalyzeContext?: InitialContext | null;
  /**
   * Conversation ID to load on mount into the Modify tab.
   * Used when arriving from a free-chat handoff via `?continue=:convId`.
   * Disables the "Nueva conversación" button and skips the auto-load.
   */
  initialConversationId?: string;
}

// ---------------------------------------------------------------------------
// Conversation API types (from /api/conversations — Task 2 #537)
// ---------------------------------------------------------------------------

// ConversationApiMessage is imported from ./conversation/types

interface ConversationWithMessages {
  id: string;
  mode: string;
  title: string | null;
  first_user_prompt: string | null;
  context_kind?: string | null;
  context_ref?: string | null;
  messages?: ConversationApiMessage[];
  initial_context?: InitialContext | null;
}

type ConversationListItem = {
  id: string;
  title: string | null;
  first_user_prompt: string | null;
  last_interaction_at: string;
  archived_at: string | null;
  message_count: number;
  last_status: string | null;
};

// GET /api/conversations returns a bare array; older callers used { conversations: [...] }.
// Accept both so we don't fight the server contract from the consumer side.
type ConversationListResponse =
  | ConversationListItem[]
  | { conversations: ConversationListItem[] };

// GET /api/conversations/:id returns the conversation row with messages inlined.
type ConversationDetailResponse = ConversationWithMessages;

// ---------------------------------------------------------------------------
// Simulated log sequences
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NDJSON stream reader
// ---------------------------------------------------------------------------
//
// `/api/dashboard/analyze` and `/api/dashboard/modify` open an NDJSON stream
// when the agentic runner emits at least one progress event before the LLM
// finishes. Each line is one JSON object. The terminal frame is either
// `{type:"result", …}` or `{type:"error", httpStatus, …}`.
//
// When no progress event is emitted (or the runtime is in fast/single-shot
// mode), the response is a single JSON document with the proper HTTP status,
// and we stay on the legacy `await res.json()` path.

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
          /* skip malformed line */
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

function isNdjsonResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/x-ndjson");
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
  isActive,
  prefillRequest,
  onPrefillApplied,
  dashboardId,
  initialContext,
  onInitialContextLoaded,
  onLoadingChange,
  ensureConversation,
  saveMessage,
}: {
  spec: DashboardSpec;
  onSpecUpdate: (newSpec: DashboardSpec, prompt: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isActive: boolean;
  prefillRequest?: { text: string; id: number } | null;
  onPrefillApplied?: () => void;
  dashboardId?: number;
  initialContext?: InitialContext | null;
  onInitialContextLoaded?: (ctx: InitialContext | null) => void;
  onLoadingChange?: (v: boolean) => void;
  ensureConversation: (mode: "modify" | "analyze") => Promise<string | null>;
  saveMessage: (convId: string, opts: { role: "user" | "assistant"; content: string }) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const setLoadingWithNotify = (v: boolean) => { setLoading(v); onLoadingChange?.(v); };
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
    setLoadingWithNotify(true);
    setStreamingLog([]);

    // Create (or reuse) a conversation so the session is persisted immediately.
    // After ensuring the conversation, fetch its initial_context so the
    // "Contexto original" panel shows right away without waiting for the
    // next auto-load cycle.
    const convId = await ensureConversation("modify");
    if (convId) {
      void saveMessage(convId, { role: "user", content: trimmed });
      if (!initialContext && onInitialContextLoaded) {
        void fetch(`/api/conversations/${convId}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => { if (d?.initial_context) onInitialContextLoaded(d.initial_context); })
          .catch(() => {});
      }
    }

    // Real progress lines streamed from the server (NDJSON path) — captured
    // in a local mutable array so the final message logs include exactly
    // what the user saw during the request.
    const capturedLogs: LogLine[] = [];

    /**
     * Append the assistant message AFTER the user message in a way that is
     * resilient to concurrent message arrivals (the streaming request is
     * async, so `messages` captured at the start of the callback can be
     * stale by the time we resolve). We use a functional updater that walks
     * the current message list and appends immediately after the matching
     * user message, never overwriting newer messages someone else added.
     */
    const appendAssistant = (assistant: ChatMessage) => {
      setMessages((prev) => {
        // Find our user message by reference — userMessage is unique to
        // this send. Insert right after it; if not found (defensive),
        // append to the end.
        const idx = prev.indexOf(userMessage);
        return idx >= 0
          ? [...prev.slice(0, idx + 1), assistant, ...prev.slice(idx + 1)]
          : [...prev, assistant];
      });
    };

    try {
      const res = await fetch("/api/dashboard/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, prompt: trimmed }),
      });

      // -------------------------------------------------------------------
      // Streaming path: server opened an NDJSON stream (HTTP 200).
      // -------------------------------------------------------------------
      if (res.ok && res.body && isNdjsonResponse(res)) {
        type ModifyMsg =
          | { type: "progress"; requestId: string; logLine: LogLine }
          | { type: "result"; requestId: string; spec: DashboardSpec; message?: string; summary?: string }
          | ({ type: "error"; requestId: string; httpStatus?: number } & Partial<ApiErrorResponse>);

        let resultSpec: DashboardSpec | null = null;
        let resultMessage: string | null = null;
        let resultSummary: string | null = null;
        let errorFrame: (ModifyMsg & { type: "error" }) | null = null;

        for await (const msg of readNdjsonStream<ModifyMsg>(res.body)) {
          if (msg.type === "progress") {
            // Coalesce consecutive streaming ticks (model_text_delta /
            // model_thinking_delta) into a single growing line. With
            // token-level streaming the server sends one frame per token,
            // so without dedup the UI would stack hundreds of identical
            // "Modelo respondiendo · N caracteres" rows.
            appendCoalescedLogLine(capturedLogs, msg.logLine);
            setStreamingLog([...capturedLogs]);
          } else if (msg.type === "result") {
            resultSpec = msg.spec;
            resultMessage = msg.message ?? null;
            resultSummary = msg.summary ?? null;
          } else if (msg.type === "error") {
            errorFrame = msg;
          }
        }

        if (errorFrame) {
          const httpStatus = errorFrame.httpStatus ?? 500;
          const fallback = httpStatus >= 500
            ? "Error interno del servidor. Inténtalo de nuevo."
            : "No se pudo aplicar la modificación. Revisa tu petición.";
          const { userMsg: baseMsg, errorDetail } = parseApiError(errorFrame, httpStatus, fallback);
          const userMsg = httpStatus === 429
            ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
            : baseMsg;
          console.error("Modify API error (stream):", errorDetail);
          appendAssistant({
            role: "assistant",
            content: userMsg,
            timestamp: new Date(),
            isError: true,
            errorDetail,
            logs: [...capturedLogs],
          });
          return;
        }

        if (resultSpec) {
          onSpecUpdate(resultSpec, trimmed);
          // Use the model's freeform message if provided, otherwise fallback to widget delta summary.
          let chatContent: string;
          if (resultMessage && resultMessage.trim()) {
            chatContent = resultMessage.trim();
          } else {
            const widgetDelta = resultSpec.widgets.length - spec.widgets.length;
            chatContent = "Dashboard actualizado.";
            if (widgetDelta > 0) {
              chatContent += ` Se ${widgetDelta === 1 ? "ha añadido 1 widget" : `han añadido ${widgetDelta} widgets`}.`;
            } else if (widgetDelta < 0) {
              chatContent += ` Se ${widgetDelta === -1 ? "ha eliminado 1 widget" : `han eliminado ${Math.abs(widgetDelta)} widgets`}.`;
            }
          }
          if (convId) void saveMessage(convId, { role: "assistant", content: chatContent });
          appendAssistant({
            role: "assistant",
            content: chatContent,
            timestamp: new Date(),
            logs: [...capturedLogs],
            ...(resultSummary ? { appliedSummary: resultSummary } : {}),
          });
          return;
        }

        // Stream ended without result or error — treat as transport error.
        appendAssistant({
          role: "assistant",
          content: "La respuesta del servidor terminó inesperadamente.",
          timestamp: new Date(),
          isError: true,
          logs: [...capturedLogs],
        });
        return;
      }

      // -------------------------------------------------------------------
      // Legacy JSON path (fast / single-shot / validation errors).
      // -------------------------------------------------------------------
      if (!res.ok) {
        const fallback = res.status >= 500
          ? "Error interno del servidor. Inténtalo de nuevo."
          : "No se pudo aplicar la modificación. Revisa tu petición.";
        let errorDetail: ApiErrorResponse;
        let userMsg: string;

        try {
          const errBody = await res.json();
          ({ userMsg, errorDetail } = parseApiError(errBody, res.status, fallback));
        } catch {
          ({ userMsg, errorDetail } = parseApiError(null, res.status, fallback));
        }

        if (res.status === 429) {
          userMsg = "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.";
        }

        console.error("Modify API error:", errorDetail);

        appendAssistant({
          role: "assistant",
          content: userMsg,
          timestamp: new Date(),
          isError: true,
          errorDetail,
          logs: [...capturedLogs],
        });
        return;
      }

      const responseBody = await res.json() as DashboardSpec & { message?: string; summary?: string };
      // The new response body has { ...spec, message?, summary? }.
      // Extract spec fields (title, widgets, etc.) and the additive message field.
      const { message: respMessage, summary: respSummary, ...newSpec } = responseBody;
      onSpecUpdate(newSpec as DashboardSpec, trimmed);

      // Use the model's freeform message if provided, otherwise fallback to widget delta summary.
      let chatContent: string;
      if (respMessage && respMessage.trim()) {
        chatContent = respMessage.trim();
      } else {
        const widgetDelta = (newSpec as DashboardSpec).widgets.length - spec.widgets.length;
        chatContent = "Dashboard actualizado.";
        if (widgetDelta > 0) {
          chatContent += ` Se ${widgetDelta === 1 ? "ha añadido 1 widget" : `han añadido ${widgetDelta} widgets`}.`;
        } else if (widgetDelta < 0) {
          chatContent += ` Se ${widgetDelta === -1 ? "ha eliminado 1 widget" : `han eliminado ${Math.abs(widgetDelta)} widgets`}.`;
        }
      }

      if (convId) void saveMessage(convId, { role: "assistant", content: chatContent });
      appendAssistant({
        role: "assistant",
        content: chatContent,
        timestamp: new Date(),
        logs: [...capturedLogs],
        ...(respSummary ? { appliedSummary: respSummary } : {}),
      });
    } catch (err) {
      console.error("Error al procesar la solicitud del chat:", err);

      const errorMessage =
        err instanceof TypeError
          ? "No se pudo conectar con el servidor."
          : "Ocurrió un problema al procesar la respuesta.";

      appendAssistant({
        role: "assistant",
        content: errorMessage,
        timestamp: new Date(),
        isError: true,
        logs: [...capturedLogs],
      });
    } finally {
      setLoadingWithNotify(false);
      setTimeout(() => setStreamingLog(null), 400);
    }
  }, [input, loading, spec, onSpecUpdate, setMessages]);

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
        {/* Initial context panel — shown at the top when a prior conversation has context */}
        {initialContext && messages.length > 0 && (
          <InitialContextPanel context={initialContext} />
        )}

        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 32 }}>
            Escribe un mensaje para modificar el dashboard.
          </p>
        )}

        <MessageList
          messages={messages}
          isMarkdown={false}
          expandedLogs={expandedLogs}
          onLogToggle={toggleLog}
        />

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
  isActive,
  dashboardId,
  prefillRequest,
  onPrefillApplied,
  initialContext,
  onInitialContextLoaded,
  onLoadingChange,
  ensureConversation,
  saveMessage,
}: {
  spec: DashboardSpec;
  widgetData?: Map<number, WidgetState>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isActive: boolean;
  dashboardId?: number;
  prefillRequest?: { text: string; id: number } | null;
  onPrefillApplied?: () => void;
  initialContext?: InitialContext | null;
  onInitialContextLoaded?: (ctx: InitialContext | null) => void;
  onLoadingChange?: (v: boolean) => void;
  ensureConversation: (mode: "modify" | "analyze") => Promise<string | null>;
  saveMessage: (convId: string, opts: { role: "user" | "assistant"; content: string }) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [streamingLog, setStreamingLog] = useState<LogLine[] | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const appliedPrefillIdRef = useRef<number | null>(null);
  const setLoadingWithNotify = (v: boolean) => { setLoading(v); onLoadingChange?.(v); };

  // Prefill from drilldown — fires when handleDataPointClick on the page
  // sets pendingAnalyze with a fresh trigger id.
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

      // Append user message via functional updater so concurrent sends do
      // not lose each other.
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setSuggestions([]);
      setLoadingWithNotify(true);
      setStreamingLog([]);

      // Create (or reuse) a conversation so the session is persisted immediately.
      const convId = await ensureConversation("analyze");
      if (convId) {
        void saveMessage(convId, { role: "user", content: trimmed });
        if (!initialContext && onInitialContextLoaded) {
          void fetch(`/api/conversations/${convId}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => { if (d?.initial_context) onInitialContextLoaded(d.initial_context); })
            .catch(() => {});
        }
      }

      // Real progress lines streamed from the server (NDJSON).
      const capturedLogs: LogLine[] = [];

      /**
       * Append assistant message right after the user message we just
       * pushed, walking the current state (not a stale snapshot) to avoid
       * race conditions when other state changes happen mid-request.
       */
      const appendAssistant = (assistant: ChatMessage) => {
        setMessages((prev) => {
          const idx = prev.indexOf(userMessage);
          return idx >= 0
            ? [...prev.slice(0, idx + 1), assistant, ...prev.slice(idx + 1)]
            : [...prev, assistant];
        });
      };

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

        // -----------------------------------------------------------------
        // Streaming path: server opened an NDJSON stream.
        // -----------------------------------------------------------------
        if (res.ok && res.body && isNdjsonResponse(res)) {
          type AnalyzeMsg =
            | { type: "progress"; requestId: string; logLine: LogLine }
            | { type: "result"; requestId: string; response: string; message?: string; summary?: string; suggestions: string[] }
            | ({ type: "error"; requestId: string; httpStatus?: number } & Partial<ApiErrorResponse>);

          let result: { response: string; message?: string; summary?: string; suggestions: string[] } | null = null;
          let errorFrame: (AnalyzeMsg & { type: "error" }) | null = null;

          for await (const msg of readNdjsonStream<AnalyzeMsg>(res.body)) {
            if (msg.type === "progress") {
              // Coalesce streaming ticks — see modify branch above.
              appendCoalescedLogLine(capturedLogs, msg.logLine);
              setStreamingLog([...capturedLogs]);
            } else if (msg.type === "result") {
              result = {
                response: msg.response,
                message: msg.message,
                summary: msg.summary,
                suggestions: msg.suggestions ?? [],
              };
            } else if (msg.type === "error") {
              errorFrame = msg;
            }
          }

          if (errorFrame) {
            const httpStatus = errorFrame.httpStatus ?? 500;
            const fallback = httpStatus >= 500
              ? "Error interno del servidor. Inténtalo de nuevo."
              : "No se pudo analizar los datos. Revisa tu petición.";
            const { userMsg: baseMsg, errorDetail } = parseApiError(errorFrame, httpStatus, fallback);
            const userMsg = httpStatus === 429
              ? "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos."
              : baseMsg;
            console.error("Analyze API error (stream):", errorDetail);
            appendAssistant({
              role: "assistant",
              content: userMsg,
              timestamp: new Date(),
              isError: true,
              errorDetail,
              logs: [...capturedLogs],
            });
            return;
          }

          if (result) {
            // With the publish-tool contract: message = freeform chat reply, response = analysis body.
            // If message is empty (legacy path), fall back to response.
            const chatContent = result.message?.trim() || result.response;
            if (convId) void saveMessage(convId, { role: "assistant", content: chatContent });
            appendAssistant({
              role: "assistant",
              content: chatContent,
              timestamp: new Date(),
              logs: [...capturedLogs],
              ...(result.summary ? { appliedSummary: result.summary, appliedChipLabel: "Análisis publicado" } : {}),
            });
            setSuggestions(result.suggestions);
            return;
          }

          appendAssistant({
            role: "assistant",
            content: "La respuesta del servidor terminó inesperadamente.",
            timestamp: new Date(),
            isError: true,
            logs: [...capturedLogs],
          });
          return;
        }

        // -----------------------------------------------------------------
        // Legacy JSON path (fast / single-shot / validation errors).
        // -----------------------------------------------------------------
        if (!res.ok) {
          const fallback = res.status >= 500
            ? "Error interno del servidor. Inténtalo de nuevo."
            : "No se pudo analizar los datos. Revisa tu petición.";
          let errorDetail: ApiErrorResponse;
          let userMsg: string;

          try {
            const errBody = await res.json();
            ({ userMsg, errorDetail } = parseApiError(errBody, res.status, fallback));
          } catch {
            ({ userMsg, errorDetail } = parseApiError(null, res.status, fallback));
          }

          if (res.status === 429) {
            userMsg = "Límite de uso del modelo de IA alcanzado. Inténtalo en unos minutos.";
          }

          console.error("Analyze API error:", errorDetail);

          appendAssistant({
            role: "assistant",
            content: userMsg,
            timestamp: new Date(),
            isError: true,
            errorDetail,
            logs: [...capturedLogs],
          });
          return;
        }

        const data = await res.json() as { response: string; message?: string; summary?: string; suggestions: string[] };

        // With publish-tool contract: message = freeform chat reply, response = analysis body.
        const chatContent = data.message?.trim() || data.response;
        if (convId) void saveMessage(convId, { role: "assistant", content: chatContent });
        appendAssistant({
          role: "assistant",
          content: chatContent,
          timestamp: new Date(),
          logs: [...capturedLogs],
          ...(data.summary ? { appliedSummary: data.summary, appliedChipLabel: "Análisis publicado" } : {}),
        });
        setSuggestions(data.suggestions ?? []);
      } catch (err) {
        console.error("Error al analizar datos:", err);

        const errorMessage =
          err instanceof TypeError
            ? "No se pudo conectar con el servidor."
            : "Ocurrió un problema al procesar la respuesta.";

        appendAssistant({
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
          isError: true,
          logs: [...capturedLogs],
        });
      } finally {
        setLoading(false);
        setTimeout(() => setStreamingLog(null), 400);
      }
    },
    [loading, spec, widgetData, setMessages, dashboardId]
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

        {/* Initial context panel — shown at the top when a prior conversation has context */}
        {initialContext && messages.length > 0 && (
          <InitialContextPanel context={initialContext} />
        )}

        {/* Empty state */}
        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 16 }}>
            Usa los botones de arriba o escribe una pregunta sobre los datos del dashboard.
          </p>
        )}

        {/* Message bubbles */}
        <MessageList
          messages={messages}
          isMarkdown
          expandedLogs={expandedLogs}
          onLogToggle={toggleLog}
        />

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

const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH_VW = 0.65;
const SIDEBAR_STORAGE_KEY = "chat-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 380;

function clampSidebarWidth(w: number): number {
  const maxW = typeof window !== "undefined" ? window.innerWidth * SIDEBAR_MAX_WIDTH_VW : Infinity;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(w, maxW));
}

export default function ChatSidebar({
  spec,
  onSpecUpdate,
  isOpen,
  onToggle,
  dashboardId,
  widgetData,
  initialAnalyzeMessages,
  initialModifyMessages,
  pendingModifyInput,
  pendingModifyTriggerId,
  onPendingModifyInputConsumed,
  pendingAnalyzeInput,
  pendingAnalyzeTriggerId,
  onPendingAnalyzeInputConsumed,
  onOpenSidebar,
  initialMode,
  hideWhenClosed = false,
  initialModifyContext,
  initialAnalyzeContext,
  initialConversationId,
}: ChatSidebarProps) {
  const configuredModel = useConfiguredModel();
  const [activeTab, setActiveTab] = useState<"modificar" | "analizar">(
    initialMode ?? "modificar"
  );
  const [modifyMessages, setModifyMessages] = useState<ChatMessage[]>(
    initialModifyMessages ?? []
  );
  const [analyzeMessages, setAnalyzeMessages] = useState<ChatMessage[]>(
    initialAnalyzeMessages ?? []
  );

  // Track the LLM initial context for each tab (set from preloaded prop or auto-load).
  const [modifyInitialContext, setModifyInitialContext] = useState<InitialContext | null>(
    initialModifyContext ?? null
  );
  const [analyzeInitialContext, setAnalyzeInitialContext] = useState<InitialContext | null>(
    initialAnalyzeContext ?? null
  );

  // Conversation persistence hooks — hoisted to ChatSidebar so handleNewConversation
  // can call startNewConversation on the correct tab's hook instance.
  const modifyConv = useDashboardConversation(dashboardId);
  const analyzeConv = useDashboardConversation(dashboardId);
  // Tracks whether the active tab's LLM call is in flight — used by the header spinner.
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs to detect whether initial messages were provided by the parent on mount.
  // Used to skip auto-load when preloaded messages are present, preventing them from being
  // overwritten by the conversation API (e.g., when arriving from /k/:id or via ?continue=).
  // When initialConversationId is set, we block the auto-load here so the dedicated
  // initialConversationId effect can load the specific conversation without racing.
  const hadInitialModifyMessagesRef = useRef(
    (initialModifyMessages?.length ?? 0) > 0 || !!initialConversationId
  );
  const hadInitialAnalyzeMessagesRef = useRef((initialAnalyzeMessages?.length ?? 0) > 0);

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

  // Load a specific conversation by ID into the Modify tab on mount.
  // Used when arriving via ?continue=:convId from a free-chat handoff.
  const loadedConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialConversationId) return;
    if (!/^[a-f0-9]{12}$/.test(initialConversationId)) return;
    if (loadedConvIdRef.current === initialConversationId) return;
    loadedConvIdRef.current = initialConversationId;

    const controller = new AbortController();
    fetch(`/api/conversations/${initialConversationId}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || controller.signal.aborted) return;
        const data = (await res.json()) as ConversationDetailResponse;
        if (controller.signal.aborted) return;
        // Reject conversations that explicitly belong to a different dashboard to prevent
        // cross-dashboard history injection via a crafted ?continue= param.
        if (
          dashboardId !== undefined &&
          data.context_kind === "dashboard" &&
          data.context_ref !== String(dashboardId)
        ) {
          console.warn(
            `[ChatSidebar] Handoff rejected: conversation ${initialConversationId} belongs to dashboard ${data.context_ref}, not ${dashboardId}.`,
          );
          return;
        }

        const msgs = convertConversationMessages(data.messages ?? []);
        setModifyMessages(msgs);
        setModifyInitialContext(data.initial_context ?? null);
        setActiveTab("modificar");
      })
      .catch(() => {
        // Non-critical — if the fetch fails, the tab starts empty
      });
    return () => controller.abort();
  }, [initialConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Sidebar resize state
  // -------------------------------------------------------------------------

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
  });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = clampSidebarWidth(resizeStartWidthRef.current + delta);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      const delta = resizeStartXRef.current - e.clientX;
      const newWidth = clampSidebarWidth(resizeStartWidthRef.current + delta);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, newWidth.toString());
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (isResizingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        isResizingRef.current = false;
      }
    };
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  // -------------------------------------------------------------------------
  // Conversation history state
  // -------------------------------------------------------------------------

  const [showPreviousConversations, setShowPreviousConversations] = useState(false);

  // Auto-load the latest non-archived conversation for each mode on mount.
  // Gracefully falls through if the API is not yet available (Task 2 / #537).
  const conversationAutoLoadedRef = useRef(false);
  useEffect(() => {
    // Reset on dashboardId change so swapping dashboards re-triggers auto-load.
    conversationAutoLoadedRef.current = false;
    if (dashboardId === undefined) return;
    conversationAutoLoadedRef.current = true;

    const controller = new AbortController();

    const loadLatest = async (apiMode: string) => {
      try {
        const res = await fetch(
          `/api/conversations?context_kind=dashboard&context_ref=${dashboardId}&mode=${apiMode}&limit=1`,
          { signal: controller.signal },
        );
        if (!res.ok) return; // API not ready (Task 2 not merged), fall through
        const data = (await res.json()) as ConversationListResponse;
        const list = Array.isArray(data) ? data : data.conversations;
        if (!list?.length) return;

        const conv = list[0];
        if (conv.archived_at) return; // Only load non-archived

        const msgRes = await fetch(`/api/conversations/${conv.id}`, { signal: controller.signal });
        if (!msgRes.ok) return;
        const msgData = (await msgRes.json()) as ConversationDetailResponse;
        if (controller.signal.aborted) return;
        const messages = convertConversationMessages(msgData.messages ?? []);

        if (apiMode === "modify") {
          if (!hadInitialModifyMessagesRef.current) {
            setModifyMessages(messages);
            setModifyInitialContext(msgData.initial_context ?? null);
          }
        } else {
          if (!hadInitialAnalyzeMessagesRef.current) {
            setAnalyzeMessages(messages);
            setAnalyzeInitialContext(msgData.initial_context ?? null);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Silently ignore — API not available yet
      }
    };

    if (!initialConversationId) void loadLatest("modify");
    void loadLatest("analyze");
    return () => controller.abort();
  }, [dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Nueva conversación" — clears messages for the active tab and archives the
  // current conversation so the next send creates a fresh one.
  const handleNewConversation = useCallback(() => {
    if (activeTab === "modificar") {
      void modifyConv.startNewConversation();
      setModifyMessages([]);
      setModifyInitialContext(null);
      hadInitialModifyMessagesRef.current = false;
    } else {
      void analyzeConv.startNewConversation();
      setAnalyzeMessages([]);
      setAnalyzeInitialContext(null);
      hadInitialAnalyzeMessagesRef.current = false;
    }
    setShowPreviousConversations(false);
  }, [activeTab, modifyConv, analyzeConv]);

  // Handle pending modify prefill (opens sidebar in modify tab)
  useEffect(() => {
    if (!pendingModifyInput?.trim() || pendingModifyTriggerId === undefined) return;
    if (!isOpen) {
      (onOpenSidebar ?? onToggle)();
      return;
    }
    setActiveTab("modificar");
  }, [pendingModifyInput, pendingModifyTriggerId, isOpen, onOpenSidebar, onToggle]);

  // Handle pending analyze prefill (opens sidebar in analyze tab — fired by drilldowns).
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
        width: sidebarWidth,
        background: "var(--bg-1)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        zIndex: 15,
      }}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 6,
          bottom: 0,
          cursor: "col-resize",
          zIndex: 20,
        }}
        title="Arrastrar para cambiar el ancho"
      />
      {/* Header */}
      <header
        style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border)", position: "relative" }}
      >
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
                aria-label={isProcessing ? "Procesando" : "Conectado"}
                style={{
                  width: isProcessing ? 10 : 5,
                  height: isProcessing ? 10 : 5,
                  borderRadius: "50%",
                  background: isProcessing ? "transparent" : "var(--up)",
                  border: isProcessing ? "2px solid var(--accent)" : "none",
                  borderTopColor: isProcessing ? "transparent" : undefined,
                  animation: isProcessing
                    ? "spin 0.8s linear infinite"
                    : "pulse-dot 2s ease-in-out infinite",
                  display: "inline-block",
                  flexShrink: 0,
                  transition: "all 0.2s",
                }}
              />
              {isProcessing
                ? `Procesando · ${configuredModel ? displayModelName(configuredModel) : "..."}`
                : `Conectado · ${configuredModel ? displayModelName(configuredModel) : "..."}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* "+ Nueva conversación" button — shown when dashboardId is set, hidden when continuing a handoff conversation */}
            {dashboardId !== undefined && !initialConversationId && (
              <button
                type="button"
                onClick={handleNewConversation}
                aria-label="Nueva conversación"
                data-testid="new-conversation-btn"
                title="Nueva conversación"
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  color: "var(--fg-muted)",
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 6,
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  whiteSpace: "nowrap",
                }}
              >
                <span aria-hidden="true">+</span>
                <span>Nueva</span>
              </button>
            )}
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
        </div>

        {/* Tab bar with history icon */}
        <div
          style={{ display: "flex", gap: 0, marginTop: 6, alignItems: "stretch" }}
          role="tablist"
          aria-label="Pestañas del chat"
        >
          {(["modificar", "analizar"] as const).map((tab) => (
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

          {/* History icon button — only shown when dashboardId is set */}
          {dashboardId !== undefined && (
            <button
              type="button"
              onClick={() => setShowPreviousConversations((v) => !v)}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Ver conversaciones anteriores"
              aria-expanded={showPreviousConversations}
              data-testid="previous-conversations-btn"
              title="Conversaciones anteriores"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${showPreviousConversations ? "var(--accent)" : "transparent"}`,
                cursor: "pointer",
                color: showPreviousConversations ? "var(--accent)" : "var(--fg-muted)",
                padding: "10px 10px",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Clock / history icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          )}
        </div>

        {/* Previous conversations panel */}
        {showPreviousConversations && dashboardId !== undefined && (
          <PreviousConversations
            dashboardId={dashboardId}
            mode={activeTab === "modificar" ? "modify" : "analyze"}
            onClose={() => setShowPreviousConversations(false)}
          />
        )}
      </header>

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {activeTab === "modificar" ? (
          <ModificarTab
            spec={spec}
            onSpecUpdate={onSpecUpdate}
            messages={modifyMessages}
            setMessages={setModifyMessages}
            isActive={activeTab === "modificar"}
            prefillRequest={
              pendingModifyInput?.trim() && pendingModifyTriggerId !== undefined
                ? { text: pendingModifyInput, id: pendingModifyTriggerId }
                : null
            }
            onPrefillApplied={onPendingModifyInputConsumed}
            dashboardId={dashboardId}
            initialContext={modifyInitialContext}
            onInitialContextLoaded={setModifyInitialContext}
            onLoadingChange={setIsProcessing}
            ensureConversation={modifyConv.ensureConversation}
            saveMessage={modifyConv.saveMessage}
          />
        ) : (
          <AnalizarTab
            spec={spec}
            widgetData={widgetData}
            messages={analyzeMessages}
            setMessages={setAnalyzeMessages}
            isActive={activeTab === "analizar"}
            dashboardId={dashboardId}
            prefillRequest={
              pendingAnalyzeInput?.trim() && pendingAnalyzeTriggerId !== undefined
                ? { text: pendingAnalyzeInput, id: pendingAnalyzeTriggerId }
                : null
            }
            onPrefillApplied={onPendingAnalyzeInputConsumed}
            initialContext={analyzeInitialContext}
            onInitialContextLoaded={setAnalyzeInitialContext}
            onLoadingChange={setIsProcessing}
            ensureConversation={analyzeConv.ensureConversation}
            saveMessage={analyzeConv.saveMessage}
          />
        )}
      </div>
    </aside>
  );
}
