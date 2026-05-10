"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKLY_SUMMARY_SEED } from "@/lib/seed-prompts";

// Action-to-chat: POST /api/conversations → navigate to /k/<id>

interface WeeklySummaryButtonProps {
  style?: React.CSSProperties;
}

export default function WeeklySummaryButton({ style }: WeeklySummaryButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "summary",
          context_kind: "home",
          context_url: "/inicio",
          first_user_prompt: WEEKLY_SUMMARY_SEED,
        }),
      });

      if (!res.ok) {
        console.error("[WeeklySummaryButton] conversation creation failed", res.status);
        setError(true);
        return;
      }

      const { k_url } = (await res.json()) as { k_url: string };
      router.push(k_url);
    } catch (err) {
      console.error("[WeeklySummaryButton] error:", err);
      setError(true);
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
      {loading ? "…" : error ? "Error — reintentar" : "✦ Resumen semanal"}
    </button>
  );
}
