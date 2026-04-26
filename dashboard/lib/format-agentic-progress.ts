import type { AgenticProgressEvent } from "@/lib/llm-tools/types";
import type { LogLine } from "@/components/LogBlock";

export interface TimedEvent {
  event: AgenticProgressEvent;
  ms: number;
}

/**
 * Convert a single AgenticProgressEvent to a LogLine immediately.
 * Returns null for event types that don't produce visible log lines
 * (e.g. `round` with round=1, `assistant_tools`, `tool_start`).
 */
export function agenticEventToLogLine(event: AgenticProgressEvent, ms: number): LogLine | null {
  const ts = `+${(ms / 1000).toFixed(1)}s`;
  switch (event.type) {
    case "tool_done":
      return {
        timestamp: ts,
        kind: "tool",
        label: event.name,
        detail: event.ok ? `${event.ms}ms` : `error · ${event.errorCode ?? "err"}`,
      };
    case "round":
      if (event.round > 1) {
        return { timestamp: ts, kind: "reason", label: "Razonando", detail: `ronda ${event.round}` };
      }
      return null;
    case "finalizing":
      return { timestamp: ts, kind: "done", label: "Respuesta lista", detail: `${event.messageChars} chars` };
    case "assistant_tools":
    case "tool_start":
      return null;
    default:
      return null;
  }
}

/** Build a LogLine collector for use as onAgenticProgress, then call toLogLines() after the run. */
export function createLogCollector(): {
  onAgenticProgress: (event: AgenticProgressEvent) => void;
  toLogLines: () => LogLine[];
} {
  const timed: TimedEvent[] = [];
  const t0 = Date.now();
  return {
    onAgenticProgress: (event) => timed.push({ event, ms: Date.now() - t0 }),
    toLogLines: () => eventsToLogLines(timed),
  };
}

function eventsToLogLines(events: TimedEvent[]): LogLine[] {
  const lines: LogLine[] = [];
  for (const { event, ms } of events) {
    const line = agenticEventToLogLine(event, ms);
    if (line) lines.push(line);
  }
  return lines;
}

/** Human-readable line (Spanish) for dashboard generation UI + logs. */
export function formatAgenticProgressLineEs(event: AgenticProgressEvent): string {
  switch (event.type) {
    case "round":
      return `Ronda ${event.round}/${event.maxRounds} — llamada al modelo…`;
    case "assistant_tools":
      return `Herramientas solicitadas: ${event.tools.join(", ")}`;
    case "tool_start":
      return `  → ${event.name}…`;
    case "tool_done": {
      const icon = event.ok ? "✓" : "✗";
      const err = event.errorCode ? ` (${event.errorCode})` : "";
      return `  ${icon} ${event.name} — ${event.ms} ms${err}`;
    }
    case "finalizing":
      return `Respuesta JSON lista (${event.messageChars} caracteres)`;
    default: {
      return JSON.stringify(event);
    }
  }
}
