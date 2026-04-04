"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSpec } from "@/lib/schema";

export default function NewDashboard() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);

    try {
      // Generate spec from prompt
      const genRes = await fetch("/api/dashboard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      if (!genRes.ok) {
        const errBody = await genRes.json().catch(() => null);
        throw new Error(
          errBody?.error || "Error al generar el dashboard",
        );
      }

      const spec: DashboardSpec = await genRes.json();

      // Auto-save with generated name
      const name = spec.title || "Dashboard sin título";
      const saveRes = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: spec.description || null,
          spec,
        }),
      });

      if (!saveRes.ok) {
        const errBody = await saveRes.json().catch(() => null);
        throw new Error(
          errBody?.error || "Error al guardar el dashboard",
        );
      }

      const saved = await saveRes.json();
      router.push(`/dashboard/${saved.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error inesperado",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe el cuadro de mando que deseas crear
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
          placeholder="Describe el dashboard que necesitas..."
          rows={6}
          className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || prompt.trim() === ""}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              role="status"
              aria-label="Generando"
            />
          )}
          {loading ? "Generando..." : "Generar Dashboard"}
        </button>
      </div>
    </div>
  );
}
