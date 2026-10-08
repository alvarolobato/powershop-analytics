"use client";

/**
 * ArticlePhotoHover — la foto de un artículo al pasar el ratón; click para ampliar (D-068).
 *
 * Envuelve lo que ya pinta la celda (un código, una referencia, una
 * descripción). Cerrado por defecto: lo único que se ve es un glifo de cámara
 * tras el texto. Sin fotos no pinta nada: devuelve el contenido tal cual.
 *
 * Sigue el patrón accesible de `GlossaryTooltip` (`role="tooltip"`,
 * `aria-describedby`, `tabIndex=0`, sin librerías) con dos diferencias
 * obligadas por dónde vive:
 *
 *  - El tooltip va en un portal con `position: fixed`. El contenedor de la
 *    tabla tiene `overflow`, que recortaría un tooltip `absolute` en las
 *    primeras filas.
 *  - La visibilidad la lleva estado, no `group-hover`: hacen falta el retardo
 *    de 250 ms (cruzar la tabla con el ratón no debe hacer parpadear fotos) y
 *    que la `<img>` no exista hasta el primer hover o focus. Una tabla de 50
 *    filas no dispara 50 descargas.
 *
 * En táctil no hay hover: el toque abre el lightbox directamente.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Slot } from "@/lib/use-article-photos";
import { PhotoLightbox, urlFoto } from "./PhotoLightbox";

export interface ArticlePhotoHoverProps {
  codigo: string;
  /** Slots con foto. Vacío → se renderiza `children` sin más. */
  slots: Slot[];
  referencia?: string;
  descripcion?: string;
  /** `false` para envolver algo que ya es una foto (la columna de miniaturas). */
  glifo?: boolean;
  children: ReactNode;
}

export const HOVER_DELAY_MS = 250;
const LADO = 176;
const MARGEN = 8;
/** Alto total del tooltip: foto + relleno + línea del contador. */
const ALTO = LADO + 34;
const ANCHO = LADO + 12;

function esTactil(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches
  );
}

function CameraGlyph() {
  return (
    <svg
      data-testid="article-photo-glyph"
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Tamaño fijo y `vertical-align`: no altera la altura de línea de la celda.
      style={{ display: "inline-block", marginLeft: 4, verticalAlign: "-1px", opacity: 0.55, flexShrink: 0 }}
    >
      <path d="M2 5.5h2.2l1-1.5h5.6l1 1.5H14a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z" />
      <circle cx="8" cy="8.8" r="2.3" />
    </svg>
  );
}

export function ArticlePhotoHover({
  codigo,
  slots,
  referencia,
  descripcion,
  glifo = true,
  children,
}: ArticlePhotoHoverProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `armed`: ya hubo un hover o focus, así que la <img> puede existir.
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [cargada, setCargada] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cancelar = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancelar, [cancelar]);

  const mostrar = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Arriba si cabe; si no, debajo. Y sin salirse por los lados.
    const top = r.top >= ALTO + MARGEN ? r.top - ALTO - MARGEN : r.bottom + MARGEN;
    const centro = r.left + r.width / 2 - ANCHO / 2;
    const left = Math.max(MARGEN, Math.min(centro, window.innerWidth - ANCHO - MARGEN));
    setPos({ top, left });
    setArmed(true);
    setVisible(true);
  }, []);

  const programar = useCallback(
    (retardo: number) => {
      if (esTactil()) return;
      cancelar();
      timer.current = setTimeout(mostrar, retardo);
    },
    [cancelar, mostrar],
  );

  const ocultar = useCallback(() => {
    cancelar();
    setVisible(false);
  }, [cancelar]);

  const abrir = useCallback(() => {
    ocultar();
    setAbierto(true);
  }, [ocultar]);

  if (slots.length === 0) return <>{children}</>;

  const primero = slots[0];
  const etiqueta = referencia ?? codigo;

  return (
    <>
      <span
        ref={triggerRef}
        data-testid="article-photo-trigger"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-describedby={armed ? tooltipId : undefined}
        onMouseEnter={() => programar(HOVER_DELAY_MS)}
        onMouseLeave={ocultar}
        onFocus={() => programar(0)}
        onBlur={ocultar}
        onClick={(e) => {
          // La fila tiene su propio click (drill-down): este no debe llegarle.
          e.stopPropagation();
          abrir();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            abrir();
          }
        }}
        style={{ cursor: "zoom-in", display: "inline-flex", alignItems: "center", maxWidth: "100%" }}
      >
        {children}
        {glifo && <CameraGlyph />}
        <span className="sr-only">, ver foto</span>
      </span>

      {armed &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            data-testid="article-photo-tooltip"
            data-visible={visible ? "true" : "false"}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 150,
              width: ANCHO,
              padding: 6,
              borderRadius: 8,
              background: "var(--bg-1, #fff)",
              border: "1px solid var(--border, rgba(0,0,0,0.15))",
              boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
              pointerEvents: "none",
              opacity: visible ? 1 : 0,
              visibility: visible ? "visible" : "hidden",
              transition: "opacity 0.12s",
              display: "block",
            }}
          >
            {/* Caja de tamaño fijo: la foto llega cuando llega y nada salta. */}
            <span
              style={{
                position: "relative",
                display: "block",
                width: LADO,
                height: LADO,
                borderRadius: 4,
                overflow: "hidden",
                background: "var(--bg-2, rgba(0,0,0,0.06))",
              }}
            >
              {!cargada && (
                <span
                  aria-hidden="true"
                  data-testid="article-photo-skeleton"
                  className="animate-pulse"
                  style={{ position: "absolute", inset: 0, background: "var(--bg-3, rgba(0,0,0,0.1))" }}
                />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image no aporta nada aquí: el redimensionado y la caché son de /api/fotos */}
              <img
                src={urlFoto(codigo, primero, 256)}
                alt={`Foto del artículo ${etiqueta}`}
                width={LADO}
                height={LADO}
                onLoad={() => setCargada(true)}
                style={{
                  position: "relative",
                  width: LADO,
                  height: LADO,
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </span>
            <span
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 5,
                fontSize: 10,
                lineHeight: "14px",
                color: "var(--fg-muted, #666)",
                fontFamily: "var(--font-inter, sans-serif)",
                whiteSpace: "nowrap",
              }}
            >
              <span>Clic para ampliar</span>
              {slots.length > 1 && (
                <span data-testid="article-photo-count" style={{ fontFamily: "var(--font-jetbrains, monospace)" }}>
                  1/{slots.length}
                </span>
              )}
            </span>
          </span>,
          document.body,
        )}

      {abierto && (
        <PhotoLightbox
          codigo={codigo}
          slots={slots}
          referencia={referencia}
          descripcion={descripcion}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}
