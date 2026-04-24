import type { AgenticProgressEvent } from "@/lib/llm-tools/types";
import type { LogLine } from "@/components/LogBlock";

export interface TimedEvent {
  event: AgenticProgressEvent;
  ms: number;
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
    const ts = `+${(ms / 1000).toFixed(1)}s`;
    switch (event.type) {
      case "tool_done":
        lines.push({
          timestamp: ts,
          kind: "tool",
          label: event.name,
          detail: event.ok ? `${event.ms}ms` : `error · ${event.errorCode ?? "err"}`,
        });
        break;
      case "round":
        if (event.round > 1) {
          lines.push({ timestamp: ts, kind: "reason", label: "Razonando", detail: `ronda ${event.round}` });
        }
        break;
      case "finalizing":
        lines.push({ timestamp: ts, kind: "done", label: "Respuesta lista", detail: `${event.messageChars} chars` });
        break;
    }
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
