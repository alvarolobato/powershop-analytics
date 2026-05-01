"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// AnalyzeLauncher — floating right rail "Analizar con IA"
// Visible when chat sidebar is closed; hidden when open.
// ---------------------------------------------------------------------------

interface AnalyzeLauncherProps {
  /** Called when the user clicks the rail — opens sidebar in analizar mode */
  onOpen: () => void;
  /** When true the rail is hidden (sidebar is already open) */
  hidden?: boolean;
}

export default function AnalyzeLauncher({
  onOpen,
  hidden = false,
}: AnalyzeLauncherProps) {
  const [hover, setHover] = useState(false);

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Analizar con IA"
      aria-label="Analizar con IA"
      data-testid="analyze-launcher"
      style={{
        position: "fixed",
        right: 0,
        top: "42%",
        zIndex: 14,
        width: 36,
        background: "var(--accent)",
        color: "#fff",
        border: "none",
        padding: "16px 0",
        borderTopLeftRadius: 10,
        borderBottomLeftRadius: 10,
        cursor: "pointer",
        writingMode: "vertical-rl",
        transform: "rotate(180deg)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        boxShadow: "0 8px 24px var(--accent-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: "inherit",
        filter: hover ? "brightness(1.1)" : undefined,
        transition: "filter 120ms",
      }}
    >
      <span style={{ transform: "rotate(180deg)", display: "inline-block" }}>✦</span>
      <span>Analizar con IA</span>
    </button>
  );
}
