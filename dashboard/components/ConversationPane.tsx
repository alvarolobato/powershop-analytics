"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ConversationWithMessages,
  ConversationMessage,
  InitialContext,
} from "@/lib/conversation-types";
import { isAssistantContent, getMessageText } from "@/lib/conversation-types";
import { InitialContextPanel } from "@/components/InitialContextPanel";
import LogBlock, { type LogLine } from "@/components/LogBlock";
import type { DashboardSpec } from "@/lib/schema";

// ── Types ──────────────────────────────────────────────────────────────────

interface TurnData {
  context: InitialContext | null;
  thinking: string | null; // final extended-thinking text (persisted after complete)
  logs: LogLine[];
  complete: boolean;
  error: string | null;
}

export interface NewConversationConfig {
  conversationMode: "modify" | "analyze" | "chat";
  contextKind: "dashboard" | "home" | "admin" | "global";
  contextRef?: string;
}

export interface ConversationPaneProps {
  conversationId: string | null;
  mode: "panel" | "standalone";
  onSpecUpdate?: (spec: DashboardSpec, prompt: string) => void;
  newConversationConfig?: NewConversationConfig;
  onConversationCreated?: (id: string) => void;
  onProcessingChange?: (streaming: boolean) => void;
  prefillText?: string;
  prefillId?: number;
  onPrefillConsumed?: () => void;
}

// ── SSE stream reader ──────────────────────────────────────────────────────
// Custom fetch-based SSE reader so we can set Last-Event-ID header and
// implement exponential backoff reconnect. The browser's native EventSource
// auto-reconnects but doesn't support custom headers or controlled backoff.

interface SseFrame {
  id: number;
  data: Record<string, unknown>;
}

async function* readSseStream(
  url: string,
  lastEventId: number,
  signal: AbortSignal,
): AsyncGenerator<SseFrame> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);

  const response = await fetch(url, { headers, signal });
  if (!response.body || !response.ok) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentId = lastEventId;
  let currentData = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("id: ")) {
        const parsed = parseInt(line.slice(4), 10);
        if (!isNaN(parsed)) currentId = parsed;
      } else if (line.startsWith("data: ")) {
        currentData += (currentData ? "\n" : "") + line.slice(6);
      } else if (line === "") {
        if (currentData && currentData !== "{}") {
          try {
            const parsed = JSON.parse(currentData) as Record<string, unknown>;
            yield { id: currentId, data: parsed };
          } catch {
            // skip malformed frames
          }
        }
        currentData = "";
      }
    }
  }
}

// ── Log payload conversion ─────────────────────────────────────────────────

function fmtTs(iso: string | undefined): string {
  if (!iso) return "";
  try {
    // Show just HH:MM:SS from the ISO timestamp
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return iso.slice(11, 19) || "";
  }
}

function payloadToLogLine(payload: Record<string, unknown>): LogLine | null {
  // Full LogLine structure (from agentic runner)
  if (typeof payload.label === "string") {
    return {
      timestamp: fmtTs(payload.timestamp as string | undefined),
      kind: (["tool", "reason", "done"].includes(payload.kind as string)
        ? payload.kind
        : "default") as LogLine["kind"],
      label: payload.label,
      detail: payload.detail as string | undefined,
      body: payload.body as string | undefined,
    };
  }
  // Simple {kind, text, ts} format emitted directly by turn-background
  if (typeof payload.text === "string") {
    return {
      timestamp: fmtTs(payload.ts as string | undefined),
      kind: "default",
      label: payload.text,
    };
  }
  return null;
}

// ── SuggestionPills ────────────────────────────────────────────────────────

const ANALYZE_SUGGESTIONS = [
  "Analiza este cuadro de mandos y explícame los patrones más importantes",
  "¿Qué tendencias destacan esta semana?",
  "¿Dónde hay anomalías o valores atípicos?",
  "¿Qué recomendarías mejorar?",
];

const MODIFY_SUGGESTIONS = [
  "Añade un widget de margen bruto",
  "Cambia el período a este trimestre",
  "Añade un gráfico de ventas por tienda",
  "Simplifica el dashboard con los KPIs más importantes",
];

function SuggestionPills({
  suggestions,
  onSend,
}: {
  suggestions: string[];
  onSend: (text: string) => void;
}) {
  return (
    <div
      data-testid="suggestion-pills"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "12px 4px 4px",
        justifyContent: "center",
      }}
    >
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          data-testid="suggestion-pill"
          onClick={() => onSend(s)}
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "6px 12px",
            fontSize: 11.5,
            color: "var(--fg-muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            maxWidth: 260,
            lineHeight: 1.3,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ── UserBubble ─────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
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

// ── AssistantBubble ────────────────────────────────────────────────────────

function AssistantBubble({
  text,
  isError,
}: {
  text: string;
  isError?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div
        style={{
          maxWidth: "85%",
          background: isError ? "rgba(220,38,38,0.1)" : "var(--bg-2)",
          border: isError ? "1px solid rgba(220,38,38,0.3)" : "none",
          borderRadius: "12px 12px 12px 2px",
          padding: "8px 12px",
          fontSize: 13,
          color: "var(--fg)",
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}
        data-testid="assistant-bubble"
      >
        {isError ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-headings:font-semibold">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              allowedElements={[
                "p", "br", "strong", "em", "ul", "ol", "li",
                "code", "pre", "blockquote", "a",
                "h1", "h2", "h3", "h4", "h5", "h6",
                "table", "thead", "tbody", "tr", "th", "td",
              ]}
              components={{
                a: ({ ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ThinkingBlock ──────────────────────────────────────────────────────────

function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming); // open while streaming, collapsed after
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div data-testid="thinking-block" style={{ marginBottom: 4, maxWidth: "85%" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          color: "var(--fg-muted)",
          fontSize: 11,
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        <span>{streaming ? "🤔 Pensando…" : "🤔 Pensamiento"}</span>
      </button>
      {open && (
        <div
          ref={scrollRef}
          data-testid="thinking-scroll"
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 6,
            fontSize: 11.5,
            color: "var(--fg-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.55,
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

// ── LoadingDots ────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
      <div
        style={{
          background: "var(--bg-2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12.5,
        }}
        data-testid="loading-dots"
      >
        <span className="inline-flex gap-1" aria-label="Procesando">
          <span className="animate-bounce">.</span>
          <span className="animate-bounce [animation-delay:0.15s]">.</span>
          <span className="animate-bounce [animation-delay:0.3s]">.</span>
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ConversationPane({
  conversationId: initialConversationId,
  mode,
  onSpecUpdate,
  newConversationConfig,
  onConversationCreated,
  onProcessingChange,
  prefillText,
  prefillId,
  onPrefillConsumed,
}: ConversationPaneProps) {
  const [convId, setConvId] = useState<string | null>(initialConversationId);
  const [conv, setConv] = useState<ConversationWithMessages | null>(null);
  // turnId → TurnData (context + logs from SSE events)
  const [turns, setTurns] = useState<Map<string, TurnData>>(new Map());
  // assistantMessageId → turnId
  const [msgToTurn, setMsgToTurn] = useState<Map<string, string>>(new Map());
  // Currently streaming turn
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [pendingUserMsg, setPendingUserMsg] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
  // Accumulated streaming text (token events) for the active turn
  const [streamingText, setStreamingText] = useState("");
  // Accumulated extended thinking text for the active turn
  const [thinkingText, setThinkingText] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastEventIdRef = useRef(0);
  const pendingTurnIdRef = useRef<string | null>(null);
  const pendingPromptRef = useRef("");
  const thinkingTextRef = useRef("");
  const autosendFiredRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    pendingTurnIdRef.current = pendingTurnId;
  }, [pendingTurnId]);
  useEffect(() => {
    pendingPromptRef.current = pendingPrompt;
  }, [pendingPrompt]);
  useEffect(() => {
    thinkingTextRef.current = thinkingText;
  }, [thinkingText]);

  // Sync onProcessingChange
  useEffect(() => {
    onProcessingChange?.(pendingTurnId !== null);
  }, [pendingTurnId, onProcessingChange]);

  // When conversationId prop changes from outside (e.g. parent resets for new conv)
  useEffect(() => {
    setConvId(initialConversationId);
    setConv(null);
    setTurns(new Map());
    setMsgToTurn(new Map());
    setPendingTurnId(null);
    setPendingUserMsg("");
    setPendingPrompt("");
    setStreamingText("");
    setThinkingText("");
    lastEventIdRef.current = 0;
  }, [initialConversationId]);

  // Load conversation from server. On the initial load, also restores
  // pendingTurnId from any in-progress streaming turn (EC-2 / AC-4 resume).
  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as ConversationWithMessages & { active_turn_id?: string | null };
      setConv(data);
      // Restore the pending turn on refresh so renderPendingTurn() shows accumulated logs.
      if (data.active_turn_id && !pendingTurnIdRef.current) {
        setPendingTurnId(data.active_turn_id);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (convId) void loadConversation(convId);
  }, [convId, loadConversation]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (typeof scrollEndRef.current?.scrollIntoView === "function") {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [conv?.messages?.length, pendingTurnId]);

  // Prefill input
  const appliedPrefillRef = useRef<number | null>(null);
  useEffect(() => {
    if (!prefillText?.trim()) return;
    if (prefillId !== undefined && appliedPrefillRef.current === prefillId) return;
    if (prefillId !== undefined) appliedPrefillRef.current = prefillId;
    setInput(prefillText);
    onPrefillConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [prefillId, prefillText, onPrefillConsumed]);

  // Handle spec_update SSE event
  const handleSpecUpdateEvent = useCallback(
    (payload: Record<string, unknown>, prompt: string) => {
      if (!onSpecUpdate) return;
      const spec = payload.spec as DashboardSpec | undefined;
      if (spec) {
        onSpecUpdate(spec, prompt);
      }
    },
    [onSpecUpdate],
  );

  // SSE connection with exponential backoff reconnect
  useEffect(() => {
    if (!convId) return;

    let active = true;
    let backoff = 1000;
    const controller = new AbortController();

    function handleEvent(data: Record<string, unknown>, eventId: number) {
      lastEventIdRef.current = eventId;
      const turnId = data.turnId as string;
      const eventType = data.eventType as string;
      const payload = data.payload as Record<string, unknown>;

      if (eventType === "context") {
        const ctx = (payload.context ?? payload) as InitialContext;
        setTurns((prev) => {
          const map = new Map(prev);
          const existing = map.get(turnId) ?? {
            context: null,
            thinking: null,
            logs: [],
            complete: false,
            error: null,
          };
          return map.set(turnId, { ...existing, context: ctx });
        });
      } else if (eventType === "log") {
        const logLine = payloadToLogLine(payload);
        if (logLine) {
          setTurns((prev) => {
            const map = new Map(prev);
            const existing = map.get(turnId) ?? {
              context: null,
              thinking: null,
              logs: [],
              complete: false,
              error: null,
            };
            return map.set(turnId, {
              ...existing,
              logs: [...existing.logs, logLine],
            });
          });
        }
      } else if (eventType === "thinking") {
        // Extended thinking — cumulative. Empty string = tool round cleared.
        const text = (payload.text as string | undefined) ?? "";
        if (pendingTurnIdRef.current === turnId) {
          setThinkingText(text);
        }
      } else if (eventType === "token") {
        // model_text_delta.text is CUMULATIVE (full text so far, not a delta).
        // Replace streamingText entirely. Empty string = clear (tool round detected).
        const text = (payload.text as string | undefined) ?? (payload.delta as string | undefined) ?? "";
        if (pendingTurnIdRef.current === turnId) {
          setStreamingText(text);
        }
      } else if (eventType === "spec_update") {
        handleSpecUpdateEvent(payload, (payload.prompt as string | undefined) ?? pendingPromptRef.current);
      } else if (eventType === "complete") {
        const messageId = payload.messageId as string | undefined;
        setTurns((prev) => {
          const map = new Map(prev);
          const existing = map.get(turnId) ?? {
            context: null,
            thinking: null,
            logs: [],
            complete: false,
            error: null,
          };
          // Persist final thinking text into TurnData so it survives after complete.
          const finalThinking = thinkingTextRef.current || null;
          return map.set(turnId, { ...existing, complete: true, thinking: finalThinking });
        });
        if (messageId) {
          setMsgToTurn((prev) => new Map(prev).set(messageId, turnId));
        }
        // Always refresh messages so passive watchers (second browser window)
        // also pick up the newly-persisted assistant message. Clear pending-
        // turn state only when this client initiated the turn.
        void fetch(`/api/conversations/${convId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((freshConv) => {
            if (freshConv) setConv(freshConv as ConversationWithMessages);
            if (pendingTurnIdRef.current === turnId) {
              setPendingTurnId(null);
              setPendingUserMsg("");
              setPendingPrompt("");
              setStreamingText("");
              setThinkingText("");
            }
          })
          .catch(() => {
            if (pendingTurnIdRef.current === turnId) {
              setPendingTurnId(null);
              setStreamingText("");
              setThinkingText("");
            }
          });
      } else if (eventType === "error") {
        const errText = (payload.message as string | undefined) ?? "Error desconocido";
        setTurns((prev) => {
          const map = new Map(prev);
          const existing = map.get(turnId) ?? {
            context: null,
            thinking: null,
            logs: [],
            complete: false,
            error: null,
          };
          return map.set(turnId, { ...existing, error: errText });
        });
        if (pendingTurnIdRef.current === turnId) {
          setPendingTurnId(null);
          setPendingUserMsg("");
          setPendingPrompt("");
          setSendError(errText);
        }
      }
    }

    async function connect() {
      while (active) {
        try {
          for await (const { id, data } of readSseStream(
            `/api/conversations/${convId}/stream`,
            lastEventIdRef.current,
            controller.signal,
          )) {
            // Reset backoff on any successful event
            backoff = 1000;
            handleEvent(data, id);
          }
          // Stream ended cleanly (unusual) — reconnect with short delay
          if (active) {
            await new Promise((r) => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, 30000);
          }
        } catch {
          if (!active || controller.signal.aborted) return;
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    }

    void connect();

    return () => {
      active = false;
      controller.abort();
    };
    // handleSpecUpdateEvent is stable (useCallback with stable deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, handleSpecUpdateEvent]);

  // Send a message
  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || sending) return;

      setInput("");
      setSending(true);
      setSendError(null);

      try {
        let currentConvId = convId;

        // Create conversation if needed
        if (!currentConvId) {
          if (!newConversationConfig) {
            setSendError("No se puede enviar sin una conversación activa.");
            return;
          }
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: newConversationConfig.conversationMode,
              context_kind: newConversationConfig.contextKind,
              context_ref: newConversationConfig.contextRef,
            }),
          });
          if (!res.ok) {
            setSendError("No se pudo crear la conversación.");
            return;
          }
          const created = (await res.json()) as { id: string };
          currentConvId = created.id;
          setConvId(currentConvId);
          onConversationCreated?.(currentConvId);
        }

        // Optimistic user message
        setPendingUserMsg(text);
        setPendingPrompt(text);

        // POST turn
        const res = await fetch(`/api/conversations/${currentConvId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });

        if (!res.ok) {
          setPendingUserMsg("");
          setPendingPrompt("");
          const errData = await res.json().catch(() => null);
          const msg =
            (errData as Record<string, string> | null)?.error ??
            "Error al enviar el mensaje.";
          setSendError(msg);
          return;
        }

        const { turnId } = (await res.json()) as { turnId: string };
        setPendingTurnId(turnId);
      } catch {
        setPendingUserMsg("");
        setPendingPrompt("");
        setSendError("No se pudo conectar con el servidor.");
      } finally {
        setSending(false);
      }
    },
    [input, sending, convId, newConversationConfig, onConversationCreated],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // Autosend on mount — reads the sessionStorage key written by NewConversationDialog
  // when the user created this conversation with a prompt. Fires at most once per mount.
  useEffect(() => {
    if (!initialConversationId || autosendFiredRef.current) return;
    const key = `conv-autosend-${initialConversationId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return;
    autosendFiredRef.current = true;
    sessionStorage.removeItem(key);
    void handleSend(stored);
  }, [initialConversationId, handleSend]);

  const toggleLog = (id: string) =>
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── Render messages ──────────────────────────────────────────────────────

  const messages = conv?.messages ?? [];

  // Graceful fallback: if no turns exist for this conversation (pre-turn era),
  // just render messages from conversation_messages directly without context panels.
  const hasTurnData = turns.size > 0 || msgToTurn.size > 0;

  // Render conversation_messages, injecting turn context/logs before each assistant message
  const renderMessages = () => {
    if (messages.length === 0 && !pendingTurnId) {
      const convMode =
        newConversationConfig?.conversationMode ?? (conv?.mode as string | undefined);
      const pills =
        convMode === "analyze"
          ? ANALYZE_SUGGESTIONS
          : convMode === "modify"
            ? MODIFY_SUGGESTIONS
            : null;
      return (
        <>
          <p
            style={{
              fontSize: 12,
              color: "var(--fg-subtle)",
              textAlign: "center",
              marginTop: 32,
            }}
          >
            {convId ? "Escribe un mensaje para continuar." : "Escribe tu primer mensaje."}
          </p>
          {pills && !sending && (
            <SuggestionPills
              suggestions={pills}
              onSend={(text) => void handleSend(text)}
            />
          )}
        </>
      );
    }

    const items: React.ReactNode[] = [];

    for (const msg of messages) {
      if (msg.role === "tool") continue;

      const msgId = msg.id;
      const text = extractMessageText(msg);
      if (!text && msg.role !== "assistant") continue;

      if (msg.role === "user") {
        items.push(<UserBubble key={msgId} text={text} />);
      } else {
        // assistant message
        const turnId = hasTurnData ? msgToTurn.get(msgId) : undefined;
        const turnData = turnId ? turns.get(turnId) : null;
        const isErr =
          isAssistantContent(msg.content) && (msg.content.is_error ?? false);

        if (turnData?.context) {
          items.push(
            <div key={`ctx-${msgId}`} data-testid="context-panel" style={{ marginBottom: 4 }}>
              <InitialContextPanel context={turnData.context} />
            </div>,
          );
        }

        if (turnData?.thinking) {
          items.push(
            <ThinkingBlock key={`think-${msgId}`} text={turnData.thinking} />,
          );
        }

        if (turnData && turnData.logs.length > 0) {
          items.push(
            <div
              key={`log-${msgId}`}
              data-testid="log-block"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                marginBottom: 4,
              }}
            >
              <LogBlock
                lines={turnData.logs}
                expanded={expandedLogs[msgId] ?? false}
                onToggle={() => toggleLog(msgId)}
              />
            </div>,
          );
        }

        items.push(
          <AssistantBubble key={msgId} text={text || "(sin texto)"} isError={isErr} />,
        );
      }
    }

    return items;
  };

  // Streaming turn rendering
  const renderPendingTurn = () => {
    if (!pendingTurnId) return null;

    const turnData = turns.get(pendingTurnId);
    const hasLogs = turnData && turnData.logs.length > 0;

    // Fallback: derive basic context from the conversation object immediately
    // (before the SSE context event arrives). The SSE event replaces this once
    // received. Prevents the blank context-panel window in standalone view.
    const displayContext: InitialContext | null = turnData?.context ?? (conv
      ? {
          model: conv.llm_driver ?? conv.llm_provider ?? "unknown",
          provider: conv.llm_provider ?? "unknown",
          config: { flow: conv.mode ?? "chat" },
          seed_prompt: pendingUserMsg || undefined,
        }
      : null);

    return (
      <>
        {pendingUserMsg && <UserBubble text={pendingUserMsg} />}
        {displayContext && (
          <div data-testid="context-panel" style={{ marginBottom: 4 }}>
            <InitialContextPanel context={displayContext} />
          </div>
        )}
        {hasLogs && (
          <div
            data-testid="log-block"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              marginBottom: 4,
            }}
          >
            <LogBlock lines={turnData.logs} streaming />
          </div>
        )}
        {thinkingText && <ThinkingBlock text={thinkingText} streaming />}
        {streamingText && (
          <AssistantBubble key="streaming" text={streamingText} isError={false} />
        )}
        {!thinkingText && !streamingText && !turnData?.complete && !turnData?.error && <LoadingDots />}
        {turnData?.error && (
          <AssistantBubble text={turnData.error} isError />
        )}
      </>
    );
  };

  // ── Layout styles ────────────────────────────────────────────────────────

  const isPanel = mode === "panel";

  return (
    <div
      data-testid="conversation-pane"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: isPanel ? "12px 14px" : "16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderMessages()}
        {renderPendingTurn()}
        <div ref={scrollEndRef} />
      </div>

      {/* Error banner */}
      {sendError && (
        <div
          style={{
            padding: "6px 14px",
            fontSize: 12,
            color: "var(--down, #dc2626)",
            background: "rgba(220,38,38,0.08)",
            borderTop: "1px solid rgba(220,38,38,0.2)",
          }}
        >
          {sendError}
        </div>
      )}

      {/* Input area */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: isPanel ? "10px 12px" : "12px 16px",
          background: "var(--bg-1)",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || pendingTurnId !== null}
            placeholder="Escribe un mensaje…"
            rows={2}
            style={{
              flex: 1,
              resize: "none",
              padding: "8px 10px",
              fontSize: isPanel ? 12 : 13,
              background: "var(--bg)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              color: "var(--fg)",
              fontFamily: "inherit",
              outline: "none",
              opacity: sending || pendingTurnId !== null ? 0.6 : 1,
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={sending || pendingTurnId !== null || !input.trim()}
            style={{
              padding: isPanel ? "8px 12px" : "9px 16px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: isPanel ? 12 : 13,
              fontWeight: 500,
              cursor:
                sending || pendingTurnId !== null || !input.trim()
                  ? "not-allowed"
                  : "pointer",
              opacity:
                sending || pendingTurnId !== null || !input.trim() ? 0.5 : 1,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractMessageText(msg: ConversationMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (isAssistantContent(msg.content)) {
    return getMessageText(msg.content);
  }
  return "";
}
