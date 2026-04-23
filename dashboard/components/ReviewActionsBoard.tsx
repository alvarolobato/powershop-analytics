"use client";

import { useCallback, useState } from "react";
import type { ReviewActionRow } from "@/lib/review-actions-db";

export interface ReviewActionsBoardProps {
  reviewId: number;
  actions: ReviewActionRow[];
  onActionPatched: (row: ReviewActionRow) => void;
}

export function ReviewActionsBoard({ reviewId, actions, onActionPatched }: ReviewActionsBoardProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const patch = useCallback(
    async (actionKey: string, body: { status?: string; owner_name?: string }) => {
      setBusyKey(actionKey);
      try {
        const res = await fetch(`/api/review/${reviewId}/actions/${encodeURIComponent(actionKey)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return;
        const updated = (await res.json()) as ReviewActionRow;
        onActionPatched(updated);
      } finally {
        setBusyKey(null);
      }
    },
    [onActionPatched, reviewId],
  );

  if (actions.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5"
      data-testid="review-actions-board"
    >
      <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
        Seguimiento de acciones
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left">
          <thead>
            <tr className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle border-b border-tremor-border dark:border-dark-tremor-border">
              <th className="py-2 pr-3">Prioridad</th>
              <th className="py-2 pr-3">Clave</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3">Responsable</th>
              <th className="py-2 pr-3">Vencimiento</th>
              <th className="py-2 pr-3">Impacto</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.action_key} className="border-b border-tremor-border/60 dark:border-dark-tremor-border/60">
                <td className="py-2 pr-3">{a.priority}</td>
                <td className="py-2 pr-3 font-mono text-xs">{a.action_key}</td>
                <td className="py-2 pr-3">
                  <select
                    className="text-xs rounded border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background"
                    value={a.status}
                    disabled={busyKey === a.action_key}
                    onChange={(e) => void patch(a.action_key, { status: e.target.value })}
                    data-testid={`action-status-${a.action_key}`}
                  >
                    <option value="pendiente">pendiente</option>
                    <option value="en_curso">en_curso</option>
                    <option value="hecha">hecha</option>
                    <option value="descartada">descartada</option>
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input
                    className="w-40 text-xs rounded border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-1"
                    defaultValue={a.owner_name}
                    disabled={busyKey === a.action_key}
                    onBlur={(e) => {
                      if (e.target.value !== a.owner_name) {
                        void patch(a.action_key, { owner_name: e.target.value });
                      }
                    }}
                    data-testid={`action-owner-${a.action_key}`}
                  />
                </td>
                <td className="py-2 pr-3 text-xs">{a.due_date}</td>
                <td className="py-2 pr-3 text-xs max-w-xs truncate" title={a.expected_impact}>
                  {a.expected_impact}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
