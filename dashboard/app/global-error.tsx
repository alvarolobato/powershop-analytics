"use client";

/**
 * Root error boundary — the last line of defence.
 *
 * Next.js renders this only when the root layout itself throws, which is why
 * it has to supply its own <html>/<body>: at that point the root layout has
 * not rendered, so nothing else provides them. Every other boundary in this
 * app must NOT render those tags.
 *
 * Because the root layout is gone here, so are the app's fonts, theme tokens
 * and chrome — this file deliberately uses plain inline styles rather than
 * importing anything that could itself be the thing that just failed.
 *
 * Scope note: this makes the failure legible and reportable. It does NOT send
 * anything to the server — `console.error` below runs in the visitor's own
 * browser. Getting client-side errors back to the operator needs a reporting
 * endpoint, which is deliberately not part of this change.
 */

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[global-error] Root layout error:", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          padding: 32,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0b0f19",
          color: "#e5e7eb",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            La aplicación no ha podido cargarse
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#9ca3af" }}>
            Ha fallado algo en el arranque de la interfaz. Si vuelve a ocurrir,
            copia la referencia de abajo al reportarlo.
          </p>
          <pre
            style={{
              fontSize: 12,
              background: "#111827",
              border: "1px solid #1f2937",
              borderRadius: 6,
              padding: 12,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {error.message || "Error desconocido"}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: "0 16px",
              fontSize: 14,
              color: "#e5e7eb",
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
