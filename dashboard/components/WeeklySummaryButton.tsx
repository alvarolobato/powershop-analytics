"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKLY_SUMMARY_SEED } from "@/lib/seed-prompts";

// ---------------------------------------------------------------------------
// WeeklySummaryButton
//
// Action-to-chat pattern (issue #504):
//   1. User clicks the button.
//   2. Component POSTs to /api/conversations to create a conversation with the
//      weekly summary seed prompt and the home page as context.
//   3. On success, navigates to /k/<id> — the in-context viewer with the seed
//      pre-filled in chat. No LLM call fires until the user clicks send.
//
// Styled as an inline button using the outlineBtn style from /inicio, so it
// sits naturally alongside the existing header action buttons.
// ---------------------------------------------------------------------------

interface WeeklySummaryButtonProps {
  style?: React.CSSProperties;
}

export default function WeeklySummaryButton({ style }: WeeklySummaryButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "summary",
          context_kind: "home",
          context_url: "/inicio",
          seed_prompt: WEEKLY_SUMMARY_SEED,
          first_user_prompt: WEEKLY_SUMMARY_SEED,
        }),
      });

      if (!res.ok) {
        console.error("[WeeklySummaryButton] conversation creation failed", res.status);
        return;
      }

      const { k_url } = (await res.json()) as { k_url: string };
      router.push(k_url);
    } catch (err) {
      console.error("[WeeklySummaryButton] error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Resumen semanal con IA"
      data-testid="weekly-summary-btn"
      disabled={loading}
      style={style}
    >
      {loading ? "…" : "✦ Resumen semanal"}
    </button>
  );
}
