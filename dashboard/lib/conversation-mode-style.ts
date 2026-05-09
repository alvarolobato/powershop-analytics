/**
 * Canonical mode → color mapping for conversation mode pills.
 *
 * Single source of truth — import this wherever a mode pill renders:
 * index page, viewers, sidebar tabs, per-dashboard panel.
 *
 * Tokens align with the CSS variable system (D-022) — light/dark theme
 * variants resolve via the same theme attributes on `html`.
 */

export interface ModeStyle {
  label: string;
  bg: string;
  fg: string;
}

const MODE_STYLES: Record<string, ModeStyle> = {
  generate: { label: "Generar", bg: "#e0e7ff", fg: "#3730a3" },
  modify: { label: "Modificar", bg: "#fef3c7", fg: "#92400e" },
  analyze: { label: "Analizar", bg: "#ede9fe", fg: "#5b21b6" },
  suggest: { label: "Sugerir", bg: "#d1fae5", fg: "#065f46" },
  gap: { label: "Brechas", bg: "#ffe4e6", fg: "#9f1239" },
  summary: { label: "Resumen", bg: "#ccfbf1", fg: "#115e59" },
  title: { label: "Título", bg: "#f1f5f9", fg: "#475569" },
};

// Fallback palette for unknown modes — rotate through distinct colors
const FALLBACK_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#fce7f3", fg: "#831843" },
  { bg: "#e0f2fe", fg: "#0c4a6e" },
  { bg: "#fef9c3", fg: "#713f12" },
  { bg: "#f3e8ff", fg: "#581c87" },
];

export function getModeStyle(mode: string): ModeStyle {
  if (mode in MODE_STYLES) return MODE_STYLES[mode];
  // Stable hash into fallback palette
  let hash = 0;
  for (let i = 0; i < mode.length; i++) hash = (hash * 31 + mode.charCodeAt(i)) & 0xffff;
  const fallback = FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
  return { label: mode, ...fallback };
}

export function getModeLabel(mode: string): string {
  return getModeStyle(mode).label;
}
