"use client";

/**
 * ReviewDisplay — weekly business review v2 (evidence + deep links).
 */

import { useState, useRef, useEffect } from "react";
import type { ReviewContent, ReviewSectionV2, ReviewActionItemV2 } from "@/lib/review-schema";
import type { ReviewActionRow } from "@/lib/review-actions-db";

export interface ReviewDisplayProps {
  review: ReviewContent & { id?: number | null; week_start?: string };
  actions?: ReviewActionRow[];
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function priorityBadgeClass(priority: "alta" | "media" | "baja"): string {
  switch (priority) {
    case "alta":
      return "bg-red-500/20 text-red-400 border border-red-500/30";
    case "media":
      return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
    case "baja":
      return "bg-green-500/20 text-green-400 border border-green-500/30";
    default:
      return "bg-blue-500/20 text-blue-400 border border-blue-500/30";
  }
}

function buildCopyText(review: ReviewContent & { week_start?: string }): string {
  const lines: string[] = [];
  if (review.week_start) {
    lines.push(`REVISIÓN SEMANAL — Semana del ${review.week_start}`);
  } else {
    lines.push("REVISIÓN SEMANAL");
  }
  lines.push("");
  lines.push("RESUMEN EJECUTIVO");
  for (const b of review.executive_summary) lines.push(`• ${b}`);
  lines.push("");
  for (const section of review.sections) {
    lines.push(section.title.toUpperCase());
    lines.push(section.narrative);
    lines.push("");
  }
  lines.push("ACCIONES RECOMENDADAS");
  review.action_items.forEach((item, i) => {
    lines.push(`${i + 1}. [${item.priority}] ${item.action}`);
  });
  lines.push("");
  if (review.generated_at) {
    lines.push(`Generado el ${formatTimestamp(review.generated_at)}`);
  }
  return lines.join("\n");
}

function SectionCard({ section }: { section: ReviewSectionV2 }) {
  const paragraphs = section.narrative.split(/\n\n+/);
  return (
    <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          {section.title}
        </h3>
        {section.dashboard_url && (
          <a
            href={section.dashboard_url}
            className="text-xs font-medium text-blue-400 hover:underline print:hidden"
            data-testid={`section-dashboard-${section.key}`}
          >
            Abrir dashboard explicativo
          </a>
        )}
      </div>
      {section.kpis.length > 0 && (
        <ul className="mb-3 list-disc list-inside text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          {section.kpis.map((k, i) => (
            <li key={i}>{k}</li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="text-sm text-tremor-content dark:text-dark-tremor-content whitespace-pre-line leading-relaxed"
          >
            {para.trim()}
          </p>
        ))}
      </div>
      {section.evidence && section.evidence.length > 0 && (
        <div className="mt-4 rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-3">
          <p className="text-xs font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-2">
            Evidencia
          </p>
          <ul className="space-y-2">
            {section.evidence.map((e, i) => (
              <li key={i} className="text-xs text-tremor-content dark:text-dark-tremor-content">
                <span className="font-mono text-blue-400">{e.query_name}</span>
                {e.error && <span className="text-red-400 ml-2">({e.error})</span>}
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug opacity-90">
                  {e.snapshot}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionCard({ item }: { item: ReviewActionItemV2 }) {
  return (
    <li className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${priorityBadgeClass(item.priority)}`}
          >
            {item.priority}
          </span>
          <span className="text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
            {item.action}
          </span>
        </div>
        {item.dashboard_url && (
          <a
            href={item.dashboard_url}
            className="text-xs font-medium text-blue-400 hover:underline print:hidden"
            data-testid={`action-dashboard-${item.action_key}`}
          >
            Abrir dashboard
          </a>
        )}
      </div>
      <p className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
        Responsable sugerido: {item.owner_role}
        {item.owner_name ? ` — ${item.owner_name}` : ""} · Objetivo: {item.due_date}
      </p>
      <p className="text-xs text-tremor-content dark:text-dark-tremor-content">
        <span className="font-semibold">Impacto esperado:</span> {item.expected_impact}
      </p>
      {item.evidence && item.evidence.length > 0 && (
        <div className="pt-2 border-t border-tremor-border dark:border-dark-tremor-border">
          <p className="text-xs font-semibold mb-1">Evidencia</p>
          <ul className="space-y-1">
            {item.evidence.map((e, i) => (
              <li key={i} className="text-[11px] font-mono text-tremor-content dark:text-dark-tremor-content">
                {e.query_name}
                {e.error ? ` — ${e.error}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ReviewDisplay({ review }: ReviewDisplayProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleCopy = async () => {
    try {
      const text = buildCopyText(review);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle flex flex-wrap gap-2">
          {review.generated_at && <span>Generado el {formatTimestamp(review.generated_at)}</span>}
          {review.week_start && (
            <span className="text-tremor-content dark:text-dark-tremor-content">
              — Semana del {review.week_start}
            </span>
          )}
          {review.quality_status === "degraded" && (
            <span
              className="rounded px-2 py-0.5 bg-amber-500/20 text-amber-200 border border-amber-500/30"
              data-testid="quality-degraded"
            >
              Calidad de datos degradada
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copiar revisión"
            data-testid="copy-button"
            className="rounded-md px-3 py-1.5 text-sm font-medium border border-tremor-border dark:border-dark-tremor-border text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            aria-label="Imprimir revisión"
            data-testid="print-button"
            className="rounded-md px-3 py-1.5 text-sm font-medium border border-tremor-border dark:border-dark-tremor-border text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
          >
            Imprimir
          </button>
        </div>
      </div>

      {review.data_quality_notes.length > 0 && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100"
          data-testid="data-quality-notes"
        >
          <p className="font-semibold mb-1">Notas de calidad de datos</p>
          <ul className="list-disc list-inside space-y-1">
            {review.data_quality_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        data-testid="executive-summary"
        className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white"
      >
        <h2 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
          Resumen Ejecutivo
        </h2>
        <ul className="space-y-1.5" aria-label="Puntos clave de la semana">
          {review.executive_summary.map((line, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-tremor-content dark:text-dark-tremor-content"
            >
              <span className="mt-0.5 text-blue-500 flex-shrink-0" aria-hidden="true">
                •
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>

      {review.sections.map((section, i) => (
        <SectionCard key={section.key ?? i} section={section} />
      ))}

      <div
        data-testid="action-items"
        className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white"
      >
        <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
          Acciones Recomendadas
        </h3>
        <ul className="space-y-3" aria-label="Acciones recomendadas">
          {review.action_items.map((item) => (
            <ActionCard key={item.action_key} item={item} />
          ))}
        </ul>
      </div>

      <p className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-right">
        {review.generated_at && <span>Generado el {formatTimestamp(review.generated_at)}</span>}
      </p>
    </div>
  );
}

export default ReviewDisplay;
