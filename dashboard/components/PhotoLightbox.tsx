"use client";

/**
 * PhotoLightbox — la foto de un artículo en grande, con sus hasta 4 fotos (D-068).
 *
 * Calca el diálogo de `NewConversationDialog`: `role="dialog"`,
 * `aria-modal`, cierre con Escape, focus trap con Tab/Shift+Tab y devolución
 * del foco al cerrar.
 *
 * Dos diferencias, las dos por vivir dentro de una celda de tabla:
 *
 *  - Se pinta con un portal en `document.body`. Dentro de un `<td>` quedaría
 *    recortado por el `overflow` del contenedor de la tabla.
 *  - Corta la propagación de clicks y teclas. Los eventos de React suben por
 *    el árbol de componentes aunque el DOM esté en un portal, y arriba está el
 *    `onClick` de la fila que abre el drill-down.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Slot } from "@/lib/use-article-photos";

export interface PhotoLightboxProps {
  codigo: string;
  /** Slots con foto, en orden. Al menos uno. */
  slots: Slot[];
  /** Slot que se muestra al abrir. Por defecto el primero. */
  inicial?: Slot;
  referencia?: string;
  descripcion?: string;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function urlFoto(codigo: string, slot: Slot, w?: 160 | 256 | 512 | 1024): string {
  const base = `/api/fotos/${encodeURIComponent(codigo)}/${slot}`;
  return w ? `${base}?w=${w}` : base;
}

const botonNav: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 40,
  height: 40,
  borderRadius: 20,
  border: "none",
  background: "rgba(0,0,0,0.55)",
  color: "#fff",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
};

export function PhotoLightbox({
  codigo,
  slots,
  inicial,
  referencia,
  descripcion,
  onClose,
}: PhotoLightboxProps) {
  const tituloId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(() => Math.max(0, inicial ? slots.indexOf(inicial) : 0));
  const [estado, setEstado] = useState<"cargando" | "lista" | "error">("cargando");
  const varias = slots.length > 1;
  const slot = slots[pos] ?? slots[0];

  const ir = useCallback(
    (delta: number) => {
      if (slots.length < 2) return;
      setEstado("cargando");
      setPos((p) => (p + delta + slots.length) % slots.length);
    },
    [slots.length],
  );

  // Foco: al abrir entra en el diálogo; al cerrar vuelve a donde estaba.
  useEffect(() => {
    const anterior = document.activeElement;
    const raf = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      if (anterior instanceof HTMLElement || anterior instanceof SVGElement) anterior.focus();
    };
  }, []);

  // Escape, flechas y focus trap.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        ir(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        ir(-1);
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusables.length === 0) return;
        const primero = focusables[0];
        const ultimo = focusables[focusables.length - 1];
        const activo = document.activeElement;
        if (!dialogRef.current.contains(activo)) {
          e.preventDefault();
          primero.focus();
        } else if (e.shiftKey && activo === primero) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && activo === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };
    // En fase de CAPTURA. El diálogo corta la propagación de teclas para que
    // no lleguen a la fila de la tabla, y el `stopPropagation` de React detiene
    // el evento nativo en la raíz de la app: un listener normal en `window` no
    // llegaría a ver ninguna tecla pulsada con el foco dentro del diálogo.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [ir, onClose]);

  // Precarga de la siguiente, para que la flecha no espere a la red.
  useEffect(() => {
    if (slots.length < 2) return;
    const siguiente = slots[(pos + 1) % slots.length];
    const img = new window.Image();
    img.src = urlFoto(codigo, siguiente, 1024);
  }, [codigo, pos, slots]);

  if (typeof document === "undefined" || slot === undefined) return null;

  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      data-testid="photo-lightbox-backdrop"
      // El fondo cierra. Y nada de lo que pase aquí dentro debe llegar a la
      // fila de la tabla.
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={parar}
      onMouseEnter={parar}
      onMouseLeave={parar}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "100dvh",
        zIndex: 200,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        data-testid="photo-lightbox"
        onClick={parar}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: "min(1024px, 100%)",
          maxHeight: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span
            data-testid="photo-lightbox-counter"
            aria-live="polite"
            style={{
              color: "rgba(255,255,255,0.8)",
              fontSize: 12,
              fontFamily: "var(--font-jetbrains, monospace)",
            }}
          >
            {varias ? `${pos + 1}/${slots.length}` : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar foto"
            style={{
              border: "none",
              background: "rgba(255,255,255,0.14)",
              color: "#fff",
              width: 32,
              height: 32,
              borderRadius: 16,
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "min(320px, 80vw)",
            minHeight: "min(320px, 50vh)",
          }}
        >
          {estado === "cargando" && (
            <div
              aria-hidden="true"
              data-testid="photo-lightbox-skeleton"
              className="animate-pulse"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 8,
                background: "rgba(255,255,255,0.08)",
              }}
            />
          )}
          {estado === "error" ? (
            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, margin: 0 }}>
              No se pudo cargar la foto.
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- next/image no aporta nada aquí: el redimensionado y la caché son de /api/fotos
            <img
              key={slot}
              src={urlFoto(codigo, slot, 1024)}
              alt={`Foto ${pos + 1} de ${slots.length} del artículo ${referencia ?? codigo}`}
              onLoad={() => setEstado("lista")}
              onError={() => setEstado("error")}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "calc(100dvh - 160px)",
                objectFit: "contain",
                borderRadius: 8,
                opacity: estado === "lista" ? 1 : 0,
                transition: "opacity 0.15s",
              }}
            />
          )}
          {varias && (
            <>
              <button
                type="button"
                onClick={() => ir(-1)}
                aria-label="Foto anterior"
                style={{ ...botonNav, left: 8 }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => ir(1)}
                aria-label="Foto siguiente"
                style={{ ...botonNav, right: 8 }}
              >
                ›
              </button>
            </>
          )}
        </div>

        <div id={tituloId} style={{ color: "#fff", fontSize: 13, textAlign: "center" }}>
          <span style={{ fontFamily: "var(--font-jetbrains, monospace)" }}>
            {referencia ?? codigo}
          </span>
          {descripcion ? (
            <span style={{ color: "rgba(255,255,255,0.75)" }}> · {descripcion}</span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
