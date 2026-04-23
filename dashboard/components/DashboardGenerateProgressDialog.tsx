"use client";

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import type { ReactNode } from "react";

export interface DashboardGenerateProgressDialogProps {
  open: boolean;
  title: string;
  requestId: string | null;
  lines: string[];
  phase: "running" | "error" | "success";
  errorSummary?: ReactNode | null;
  onDismiss: () => void;
}

export function DashboardGenerateProgressDialog({
  open,
  title,
  requestId,
  lines,
  phase,
  errorSummary = null,
  onDismiss,
}: DashboardGenerateProgressDialogProps) {
  return (
    <Dialog open={open} onClose={() => {}} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg rounded-xl border border-tremor-border bg-tremor-background p-5 shadow-xl dark:border-dark-tremor-border dark:bg-dark-tremor-background">
          <DialogTitle className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            {title}
          </DialogTitle>
          {requestId ? (
            <p className="mt-1 font-mono text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              ID: {requestId}
            </p>
          ) : null}

          <div
            className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-tremor-border bg-tremor-background-muted/80 p-3 font-mono text-xs leading-relaxed text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted/50 dark:text-dark-tremor-content"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {lines.length === 0 ? (
              <span className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Iniciando…
              </span>
            ) : (
              lines.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))
            )}
          </div>

          {phase === "error" && errorSummary ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
              {errorSummary}
            </div>
          ) : null}

          {phase !== "running" ? (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                Cerrar
              </button>
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              Generando… puedes seguir el progreso arriba. Los mismos pasos se registran en el log
              del servidor.
            </p>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
