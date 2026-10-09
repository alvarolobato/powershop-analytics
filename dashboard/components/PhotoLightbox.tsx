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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Slot } from "@/lib/use-article-photos";

/** Una foto concreta de un artículo concreto. */
export interface FotoRef {
  codigo: string;
  slot: Slot;
  /** Qué distingue a esta foto de las demás del grupo (el color, normalmente). */
  etiqueta?: string;
}

export interface PhotoLightboxProps {
  codigo: string;
  /** Slots con foto, en orden. Al menos uno. */
  slots: Slot[];
  /**
   * Recorrido explícito, cuando las fotos no son todas del mismo artículo.
   * Lo usa el chat: ahí un «modelo» agrupa un artículo por color, y verlos
   * todos seguidos es justo lo que se quiere. Si viene, manda sobre
   * `codigo`/`slots`, que siguen sirviendo de rótulo.
   */
  fotos?: FotoRef[];
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
  fotos: fotosProp,
  inicial,
  referencia,
  descripcion,
  onClose,
}: PhotoLightboxProps) {
  const tituloId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Un único recorrido, venga de `fotos` o de `codigo` + `slots`.
  const fotos: FotoRef[] = useMemo(
    () => (fotosProp && fotosProp.length > 0 ? fotosProp : slots.map((s) => ({ codigo, slot: s }))),
    [fotosProp, codigo, slots],
  );
  const [pos, setPos] = useState(() =>
    Math.max(0, inicial ? fotos.findIndex((f) => f.slot === inicial && f.codigo === codigo) : 0),
  );
  const [estado, setEstado] = useState<"cargando" | "lista" | "error">("cargando");
  const varias = fotos.length > 1;
  // Una revalidación puede quitar un slot con el diálogo abierto.
  const posReal = Math.min(Math.max(pos, 0), fotos.length - 1);
  const foto = fotos[posReal];
  const slot = foto?.slot;

  const ir = useCallback(
    (delta: number) => {
      if (fotos.length < 2) return;
      setEstado("cargando");
      setPos((p) => (p + delta + fotos.length) % fotos.length);
    },
    [fotos.length],
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
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // Que las flechas no desplacen la página que hay detrás.
        e.preventDefault();
        ir(e.key === "ArrowRight" ? 1 : -1);
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

  // La página de detrás no se desplaza mientras el diálogo está abierto.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  // Precarga de la siguiente, para que la flecha no espere a la red.
  useEffect(() => {
    if (fotos.length < 2) return;
    const siguiente = fotos[(Math.min(Math.max(pos, 0), fotos.length - 1) + 1) % fotos.length];
    const img = new window.Image();
    img.src = urlFoto(siguiente.codigo, siguiente.slot, 1024);
  }, [pos, fotos]);

  if (typeof document === "undefined" || foto === undefined || slot === undefined) return null;

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
            {varias ? `${posReal + 1}/${fotos.length}` : ""}
            {foto.etiqueta ? ` · ${foto.etiqueta}` : ""}
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
              key={`${foto.codigo}-${slot}`}
              src={urlFoto(foto.codigo, slot, 1024)}
              alt={`Foto ${posReal + 1} de ${fotos.length} del artículo ${foto.etiqueta ?? referencia ?? foto.codigo}`}
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
