"use client";

/**
 * ReviewDisplay — renders a structured weekly business review.
 *
 * Props:
 *   review — the structured review content (executive summary, sections, action items)
 *
 * Features:
 *   - Executive summary card (bullet points)
 *   - Domain sections (Ventas Retail, Canal Mayorista, Stock, Compras)
 *   - Action items with priority indicators
 *   - Print button (window.print)
 *   - Copy button (navigator.clipboard)
 *   - Print-friendly: toolbar hidden in print, cards without dark backgrounds
 *   - Tremor dark mode token classes throughout
 */

import { useState, useRef, useEffect } from "react";
import type { ReviewContent, ReviewSection } from "@/lib/review-prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewDisplayProps {
  review: ReviewContent & { id?: number | null; week_start?: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function parsePriority(item: string): { priority: "alta" | "media" | "baja" | null; text: string } {
  const match = item.match(/^(?:Prioridad\s+)?(alta|media|baja)[:\s-]+(.+)/i);
  if (match) {
    return {
      priority: match[1].toLowerCase() as "alta" | "media" | "baja",
      text: match[2].trim(),
    };
  }
  return { priority: null, text: item };
}

function priorityBadgeClass(priority: "alta" | "media" | "baja" | null): string {
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
  lines.push(review.executive_summary);
  lines.push("");

  for (const section of review.sections) {
    lines.push(section.title.toUpperCase());
    lines.push(section.content);
    lines.push("");
  }

  lines.push("ACCIONES RECOMENDADAS");
  review.action_items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item}`);
  });
  lines.push("");

  if (review.generated_at) {
    lines.push(`Generado el ${formatTimestamp(review.generated_at)}`);
  }

  return lines.join("\n");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ section }: { section: ReviewSection }) {
  const paragraphs = section.content.split(/\n\n+/);
  return (
    <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white">
      <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
        {section.title}
      </h3>
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
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
      // Clipboard not available — silently ignore
    }
  };

  // Parse executive summary bullets
  const summaryLines = review.executive_summary
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Toolbar — hidden in print */}
      <div className="flex items-center justify-between print:hidden">
        <div className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          {review.generated_at && (
            <span>Generado el {formatTimestamp(review.generated_at)}</span>
          )}
          {review.week_start && (
            <span className="ml-2 text-tremor-content dark:text-dark-tremor-content">
              — Semana del {review.week_start}
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

      {/* Executive Summary */}
      <div
        data-testid="executive-summary"
        className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white"
      >
        <h2 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
          Resumen Ejecutivo
        </h2>
        <ul className="space-y-1.5" aria-label="Puntos clave de la semana">
          {summaryLines.map((line, i) => {
            // Strip leading bullet marker if present
            const text = line.replace(/^[•\-–*]\s*/, "");
            return (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-tremor-content dark:text-dark-tremor-content"
              >
                <span className="mt-0.5 text-blue-500 flex-shrink-0" aria-hidden="true">
                  •
                </span>
                {text}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Domain Sections */}
      {review.sections.map((section, i) => (
        <SectionCard key={i} section={section} />
      ))}

      {/* Action Items */}
      <div
        data-testid="action-items"
        className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-5 print:border print:border-gray-200 print:bg-white"
      >
        <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-3">
          Acciones Recomendadas
        </h3>
        <ul className="space-y-2" aria-label="Acciones recomendadas">
          {review.action_items.map((item, i) => {
            const { priority, text } = parsePriority(item);
            return (
              <li key={i} className="flex items-start gap-3">
                {/* Visual-only checkbox */}
                <span
                  className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border border-tremor-border dark:border-dark-tremor-border"
                  aria-hidden="true"
                />
                <div className="flex-1 flex items-start gap-2 flex-wrap">
                  {priority && (
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${priorityBadgeClass(priority)}`}
                      aria-label={`Prioridad ${priority}`}
                    >
                      {priority}
                    </span>
                  )}
                  <span className="text-sm text-tremor-content dark:text-dark-tremor-content">
                    {text}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Timestamp footer (print-friendly) */}
      <p className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle text-right">
        {review.generated_at && (
          <span>Generado el {formatTimestamp(review.generated_at)}</span>
        )}
      </p>
    </div>
  );
}

export default ReviewDisplay;
