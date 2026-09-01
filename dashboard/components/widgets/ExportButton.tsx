"use client";

import { useState } from "react";
import { aCsv, nombreDeFichero } from "@/lib/csv";
import type { WidgetData } from "./types";

interface Props {
  data: WidgetData | null;
  /** Título del widget: da nombre al fichero. */
  titulo: string;
}

/**
 * Botón de exportar a CSV, pensado para vivir en la cabecera de un widget.
 *
 * Discreto a propósito: sólo el icono, al 45 % de opacidad hasta que el ratón
 * pasa por encima. En una pantalla con ocho widgets, ocho botones llamativos
 * compiten con los datos, que es lo que el usuario ha venido a mirar.
 *
 * No se pinta si no hay filas: un botón que descarga un fichero vacío es peor
 * que no tener botón.
 */
export function ExportButton({ data, titulo }: Props) {
  const [copiado, setCopiado] = useState(false);

  if (!data || data.rows.length === 0) return null;

  function exportar() {
    if (!data) return;
    const csv = aCsv(data.columns, data.rows);
    // `text/csv` a secas hace que algunos navegadores lo abran en una pestaña
    // en vez de descargarlo; `charset=utf-8` acompaña al BOM.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreDeFichero(titulo, new Date());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Retrasamos la revocación 1 s: si la llamamos sincronamente, Chromium
    // (sobre todo en modo headless / CI) puede no haber resuelto el blob URL
    // antes de que desaparezca, y la descarga falla silenciosamente.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={exportar}
      title={`Exportar ${data.rows.length} fila(s) a CSV`}
      aria-label="Exportar a CSV"
      data-testid="export-csv"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "transparent",
        border: "none",
        borderRadius: 6,
        padding: "3px 5px",
        cursor: "pointer",
        color: "var(--fg-muted)",
        opacity: copiado ? 1 : 0.45,
        transition: "opacity 120ms ease, background 120ms ease",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.background = "var(--bg-2, rgba(127,127,127,0.12))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = copiado ? "1" : "0.45";
        e.currentTarget.style.background = "transparent";
      }}
      onFocus={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
      onBlur={(e) => {
        e.currentTarget.style.opacity = copiado ? "1" : "0.45";
      }}
    >
      {copiado ? (
        // Marca efímera de que algo ha pasado: una descarga no da ninguna
        // señal visible en el navegador y sin esto el clic parece no hacer nada.
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )}
    </button>
  );
}
