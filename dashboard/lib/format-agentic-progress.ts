import type { AgenticProgressEvent } from "@/lib/llm-tools/types";

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
