"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSpec } from "@/lib/schema";
import { TEMPLATES, type DashboardTemplate } from "@/lib/templates";

export default function NewDashboard() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Save a spec to the database and redirect to its view page. */
  const saveAndRedirect = async (
    name: string,
    description: string | null,
    spec: DashboardSpec,
  ) => {
    const saveRes = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, spec }),
    });

    if (!saveRes.ok) {
      const errBody = await saveRes.json().catch(() => null);
      throw new Error(errBody?.error || "Error al guardar el dashboard");
    }

    const saved = await saveRes.json();
    router.push(`/dashboard/${saved.id}`);
  };

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
      const name = spec.title || "Dashboard sin titulo";
      await saveAndRedirect(name, spec.description || null, spec);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error inesperado",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUseTemplate = async (template: DashboardTemplate) => {
    if (loading || loadingTemplate) return;

    setLoadingTemplate(template.slug);
    setError(null);

    try {
      await saveAndRedirect(
        template.spec.title,
        template.description,
        template.spec,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error inesperado",
      );
    } finally {
      setLoadingTemplate(null);
    }
  };

  const isDisabled = loading || loadingTemplate !== null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe el cuadro de mando que deseas crear, o selecciona una plantilla
        </p>
      </div>

      {/* Free-form prompt */}
      <div className="max-w-2xl space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isDisabled}
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
          disabled={isDisabled || prompt.trim() === ""}
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

      {/* Template cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Plantillas predefinidas
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Usa una plantilla para empezar con un dashboard listo al instante
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <button
              key={template.slug}
              onClick={() => handleUseTemplate(template)}
              disabled={isDisabled}
              className="flex flex-col items-start rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm hover:border-blue-400 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <h3 className="text-sm font-semibold text-gray-900">
                {template.name}
              </h3>
              <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                {template.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                {loadingTemplate === template.slug ? (
                  <>
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                      role="status"
                      aria-label="Cargando plantilla"
                    />
                    Creando...
                  </>
                ) : (
                  "Usar plantilla"
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
