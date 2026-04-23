"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { InteractionLine } from "@/lib/db-write";

// ─── Line rendering ─────────────────────────────────────────────────────────

/**
 * Infer a line `kind` from its raw text when no explicit kind is provided.
 */
function inferKind(text: string): InteractionLine["kind"] {
  const t = text.trim();
  if (t.startsWith("  →") || t.startsWith("→") || t.includes("Herramientas solicitadas")) {
    return "tool_call";
  }
  if (t.startsWith("  ✓") || t.startsWith("  ✗") || t.startsWith("✓") || t.startsWith("✗")) {
    return "tool_result";
  }
  if (t.toLowerCase().startsWith("error")) {
    return "error";
  }
  return "meta";
}

function kindClassName(kind: InteractionLine["kind"]): string {
  switch (kind) {
    case "tool_call":
      return "font-mono text-blue-400 dark:text-blue-300";
    case "tool_result":
      return "font-mono text-emerald-500 dark:text-emerald-400";
    case "error":
      return "font-mono text-red-400 dark:text-red-300";
    case "assistant_text":
      return "text-tremor-content dark:text-dark-tremor-content";
    case "phase":
    case "meta":
    default:
      return "italic text-tremor-content-subtle dark:text-dark-tremor-content-subtle";
  }
}

// ─── Component types ─────────────────────────────────────────────────────────

/** A typed line with optional kind + text. Accepts plain string or typed object. */
export interface ProgressLine {
  kind?: InteractionLine["kind"];
  text: string;
}

export interface DashboardGenerateProgressDialogProps {
  open: boolean;
  title: string;
  requestId: string | null;
  /** Accept either raw string lines (legacy) or typed ProgressLine objects. */
  lines: string[] | ProgressLine[];
  phase: "running" | "error" | "success";
  errorSummary?: ReactNode | null;
  onDismiss: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DashboardGenerateProgressDialog({
  open,
  title,
  requestId,
  lines,
  phase,
  errorSummary = null,
  onDismiss,
}: DashboardGenerateProgressDialogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Auto-scroll to bottom on each new line, unless user has scrolled up manually.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  // Reset userScrolled when dialog opens.
  useEffect(() => {
    if (open) {
      userScrolledRef.current = false;
    }
  }, [open]);

  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    userScrolledRef.current = !atBottom;
  };

  // Normalise lines so we always have ProgressLine[]
  const normalised: ProgressLine[] = (lines as (string | ProgressLine)[]).map((l) =>
    typeof l === "string" ? { kind: inferKind(l), text: l } : l,
  );

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (phase !== "running") {
          onDismiss();
        }
      }}
      className="relative z-50"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          className="flex flex-col rounded-xl border border-tremor-border bg-tremor-background shadow-xl dark:border-dark-tremor-border dark:bg-dark-tremor-background"
          style={{ width: "min(64rem, 95vw)", height: "min(42rem, 85vh)" }}
        >
          {/* Header */}
          <div className="flex-none px-5 pt-5 pb-2">
            <DialogTitle className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              {title}
            </DialogTitle>
            {requestId ? (
              <p className="mt-1 font-mono text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                ID: {requestId}
              </p>
            ) : null}
          </div>

          {/* Log panel — fills remaining space, scrolls independently */}
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto mx-5 rounded-lg border border-tremor-border bg-tremor-background-muted/80 p-3 text-xs leading-relaxed dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted/50"
            style={{ scrollBehavior: "smooth" }}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            data-testid="progress-log"
          >
            {normalised.length === 0 ? (
              <span className="italic text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Iniciando…
              </span>
            ) : (
              normalised.map((line, i) => (
                <div
                  key={`${i}-${line.text.slice(0, 24)}`}
                  className={`whitespace-pre-wrap break-words ${kindClassName(line.kind ?? "meta")}`}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex-none px-5 pb-5 pt-3">
            {phase === "error" && errorSummary ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
                {errorSummary}
              </div>
            ) : null}

            {phase !== "running" ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Cerrar
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Generando… puedes seguir el progreso arriba. Los mismos pasos se registran en el log
                del servidor.
              </p>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
