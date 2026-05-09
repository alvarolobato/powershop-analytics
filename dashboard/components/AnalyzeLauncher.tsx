"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// AnalyzeLauncher — floating right rail "Analizar con IA"
//
// Action-to-chat pattern (issue #503 Task 6):
//   1. User clicks the rail button.
//   2. Component POSTs to /api/conversations to create a conversation with a
//      seeded prompt and the current dashboard as context.
//   3. On success, navigates to /k/<id> — the in-context viewer that loads
//      the dashboard with the chat sidebar open and the seed visible.
//   4. No LLM call fires until the user reviews/edits the seed and clicks send.
//
// Note: if /k/<id> is not yet implemented (#539), the page will 404 but the
// conversation is still created and accessible via /c/<id>.
//
// Visible when chat sidebar is closed; hidden when open.
// ---------------------------------------------------------------------------

const SEED_PROMPT =
  "Analiza este cuadro de mandos y explícame los patrones más importantes";

interface AnalyzeLauncherProps {
  /** Numeric dashboard id — used to set context_ref when creating the conversation */
  dashboardId?: number | null;
  /** When true the rail is hidden (sidebar is already open) */
  hidden?: boolean;
}

export default function AnalyzeLauncher({
  dashboardId,
  hidden = false,
}: AnalyzeLauncherProps) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);

  if (hidden) return null;

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "analyze",
          context_kind: "dashboard",
          context_ref: dashboardId != null ? String(dashboardId) : null,
          context_url:
            typeof window !== "undefined" ? window.location.pathname : null,
          seed_prompt: SEED_PROMPT,
          first_user_prompt: SEED_PROMPT,
        }),
      });

      if (!res.ok) {
        console.error("[AnalyzeLauncher] conversation creation failed", res.status);
        return;
      }

      const { k_url } = (await res.json()) as { k_url: string };
      router.push(k_url);
    } catch (err) {
      console.error("[AnalyzeLauncher] error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Analizar con IA"
      aria-label="Analizar con IA"
      data-testid="analyze-launcher"
      disabled={loading}
      style={{
        position: "fixed",
        right: 0,
        top: "42%",
        zIndex: 14,
        width: 36,
        background: loading ? "var(--accent-soft)" : "var(--accent)",
        color: "#fff",
        border: "none",
        padding: "16px 0",
        borderTopLeftRadius: 10,
        borderBottomLeftRadius: 10,
        cursor: loading ? "wait" : "pointer",
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
        filter: hover && !loading ? "brightness(1.1)" : undefined,
        transition: "filter 120ms, background 120ms",
      }}
    >
      <span style={{ transform: "rotate(180deg)", display: "inline-block" }}>✦</span>
      <span>{loading ? "…" : "Analizar con IA"}</span>
    </button>
  );
}
