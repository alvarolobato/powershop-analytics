"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSpec } from "@/lib/schema";
import { TEMPLATES, type DashboardTemplate } from "@/lib/templates";
import { TASK_PROMPTS } from "@/lib/task-prompts";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardListItem {
  id: number;
  name: string;
  description: string | null;
  updated_at: string;
}

interface DashboardWithSpec extends DashboardListItem {
  spec: DashboardSpec;
}

interface Suggestion {
  name: string;
  description: string;
  prompt: string;
}

interface Gap {
  area: string;
  description: string;
  suggestedPrompt: string;
}

// ─── Role options ─────────────────────────────────────────────────────────────

const ROLES = [
  "Responsable de tienda",
  "Director de ventas",
  "Comprador",
  "Director general",
  "Responsable de stock",
  "Controller financiero",
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewDashboard() {
  const router = useRouter();

  // Free-form generation state
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorResponse | string | null>(null);
  const [lastErrorSource, setLastErrorSource] = useState<"generate" | "template" | null>(null);

  // Role suggestion state
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Gap analysis state
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [gapsError, setGapsError] = useState<string | null>(null);

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
      if (isApiErrorResponse(errBody)) {
        throw errBody;
      }
      throw new Error((errBody?.error as string) || "Error al guardar el dashboard");
    }

    const saved = await saveRes.json();
    router.push(`/dashboard/${saved.id}`);
  };

  /** Generate a dashboard from a prompt string and save it. */
  const generateFromPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setLastErrorSource(null);

    try {
      const genRes = await fetch("/api/dashboard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      if (!genRes.ok) {
        const errBody = await genRes.json().catch(() => null);
        if (isApiErrorResponse(errBody)) {
          throw errBody;
        }
        throw new Error(
          (errBody?.error as string) || "Error al generar el dashboard",
        );
      }

      const spec: DashboardSpec = await genRes.json();
      const name = spec.title || "Dashboard sin título";
      await saveAndRedirect(name, spec.description || null, spec);
    } catch (err) {
      if (isApiErrorResponse(err)) {
        setError(err);
      } else {
        setError(err instanceof Error ? err.message : "Error inesperado");
      }
      setLastErrorSource("generate");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    await generateFromPrompt(prompt);
  };

  const handleUseTemplate = async (template: DashboardTemplate) => {
    if (loading || loadingTemplate) return;

    setLoadingTemplate(template.slug);
    setError(null);
    setLastErrorSource(null);

    try {
      await saveAndRedirect(
        template.spec.title,
        template.description,
        template.spec,
      );
    } catch (err) {
      if (isApiErrorResponse(err)) {
        setError(err);
      } else {
        setError(
          err instanceof Error ? err.message : "Error inesperado al usar la plantilla",
        );
      }
      setLastErrorSource("template");
    } finally {
      setLoadingTemplate(null);
    }
  };

  /** Fetch dashboard list then request role suggestions from the LLM. */
  const handleRoleSelect = async (role: string) => {
    if (isDisabled) return;

    setSelectedRole(role);
    setSuggestions(null);
    setSuggestError(null);
    setLoadingSuggestions(true);

    try {
      // Fetch existing dashboards to avoid overlap
      const listRes = await fetch("/api/dashboards");
      const listData = listRes.ok
        ? ((await listRes.json()) as DashboardListItem[])
        : [];

      const existingDashboards = listData.map((d) => ({
        title: d.name,
        description: d.description || "",
      }));

      // Request suggestions
      const suggestRes = await fetch("/api/dashboard/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, existingDashboards }),
      });

      if (!suggestRes.ok) {
        const errBody = await suggestRes.json().catch(() => null);
        throw new Error(
          (errBody?.error as string) || "Error al obtener sugerencias",
        );
      }

      const data = await suggestRes.json();
      setSuggestions((data.suggestions as Suggestion[]) || []);
    } catch (err) {
      setSuggestError(
        err instanceof Error ? err.message : "Error inesperado al obtener sugerencias",
      );
    } finally {
      setLoadingSuggestions(false);
    }
  };

  /** Fetch all dashboard specs then request gap analysis from the LLM. */
  const handleAnalyzeGaps = async () => {
    if (isDisabled) return;

    setGaps(null);
    setGapsError(null);
    setLoadingGaps(true);

    try {
      // Fetch dashboard list
      const listRes = await fetch("/api/dashboards");
      const listData: DashboardListItem[] = listRes.ok
        ? ((await listRes.json()) as DashboardListItem[])
        : [];

      // Fetch specs for each dashboard to extract widget titles
      const dashboardsWithSpecs: {
        title: string;
        description: string;
        widgetTitles: string[];
      }[] = await Promise.all(
        listData.map(async (d) => {
          try {
            const specRes = await fetch(`/api/dashboard/${d.id}`);
            if (!specRes.ok) {
              return { title: d.name, description: d.description || "", widgetTitles: [] };
            }
            const full: DashboardWithSpec = await specRes.json();
            const widgetTitles = (full.spec?.widgets ?? [])
              .map((w) => ("title" in w ? (w.title as string) : ""))
              .filter(Boolean);
            return {
              title: d.name,
              description: d.description || "",
              widgetTitles,
            };
          } catch {
            return { title: d.name, description: d.description || "", widgetTitles: [] };
          }
        }),
      );

      const gapsRes = await fetch("/api/dashboard/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ existingDashboards: dashboardsWithSpecs }),
      });

      if (!gapsRes.ok) {
        const errBody = await gapsRes.json().catch(() => null);
        throw new Error(
          (errBody?.error as string) || "Error al analizar la cobertura",
        );
      }

      const data = await gapsRes.json();
      setGaps((data.gaps as Gap[]) || []);
    } catch (err) {
      setGapsError(
        err instanceof Error ? err.message : "Error inesperado al analizar cobertura",
      );
    } finally {
      setLoadingGaps(false);
    }
  };

  const isDisabled = loading || loadingTemplate !== null;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Nuevo Dashboard
        </h1>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Elige cómo quieres crear tu cuadro de mando
        </p>
      </div>

      {/* Section 1: Task-oriented prompts */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          ¿Qué necesitas hacer?
        </h2>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Selecciona la tarea y generamos el panel de decisión adecuado
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TASK_PROMPTS.map((task) => (
            <button
              key={task.id}
              onClick={() => generateFromPrompt(task.prompt)}
              disabled={isDisabled}
              data-testid={`task-card-${task.id}`}
              className="flex flex-col items-start rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-5 text-left shadow-sm hover:border-blue-400 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <span className="text-2xl" aria-hidden="true">{task.icon}</span>
              <h3 className="mt-2 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {task.title}
              </h3>
              <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-2">
                {task.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-400">
                Crear panel
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Section 2: Role-based suggestions */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Recomendado para ti
        </h2>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Selecciona tu rol y te sugerimos los paneles más útiles para ti
        </p>

        {/* Role pill buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          {ROLES.map((role) => (
            <button
              key={role}
              onClick={() => handleRoleSelect(role)}
              disabled={isDisabled || loadingSuggestions}
              data-testid={`role-pill-${role}`}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                selectedRole === role
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-tremor-border dark:border-dark-tremor-border text-tremor-content dark:text-dark-tremor-content hover:border-blue-400 hover:text-blue-400"
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loadingSuggestions && (
          <div className="mt-4 flex items-center gap-2 text-sm text-tremor-content dark:text-dark-tremor-content">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
              role="status"
              aria-label="Cargando sugerencias"
            />
            Analizando tu perfil...
          </div>
        )}

        {/* Error state */}
        {suggestError && (
          <p className="mt-4 text-sm text-red-400">{suggestError}</p>
        )}

        {/* Suggestions */}
        {suggestions && suggestions.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex flex-col items-start rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                  {s.name}
                </h3>
                <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-3">
                  {s.description}
                </p>
                <button
                  onClick={() => generateFromPrompt(s.prompt)}
                  disabled={isDisabled}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Crear
                </button>
              </div>
            ))}
          </div>
        )}

        {suggestions && suggestions.length === 0 && (
          <p className="mt-4 text-sm text-tremor-content dark:text-dark-tremor-content">
            No se encontraron sugerencias para este rol.
          </p>
        )}
      </div>

      {/* Section 3: Gap analysis */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          ¿Qué me falta?
        </h2>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Analiza tus paneles actuales y descubre qué áreas de negocio no están cubiertas
        </p>

        <div className="mt-3">
          <button
            onClick={handleAnalyzeGaps}
            disabled={isDisabled || loadingGaps}
            data-testid="analyze-gaps-button"
            className="inline-flex items-center gap-2 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle px-4 py-2 text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong hover:border-blue-400 hover:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loadingGaps ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
                  role="status"
                  aria-label="Analizando cobertura"
                />
                Analizando...
              </>
            ) : (
              "Analizar cobertura"
            )}
          </button>
        </div>

        {/* Error state */}
        {gapsError && (
          <p className="mt-4 text-sm text-red-400">{gapsError}</p>
        )}

        {/* Gap cards */}
        {gaps && gaps.length > 0 && (
          <div className="mt-4 space-y-3">
            {gaps.map((g, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-4 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-4 shadow-sm"
              >
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    {g.area}
                  </h3>
                  <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content">
                    {g.description}
                  </p>
                </div>
                <button
                  onClick={() => generateFromPrompt(g.suggestedPrompt)}
                  disabled={isDisabled}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Crear panel
                </button>
              </div>
            ))}
          </div>
        )}

        {gaps && gaps.length === 0 && (
          <p className="mt-4 text-sm text-tremor-content dark:text-dark-tremor-content">
            ¡Excelente! Tu cobertura de dashboards parece completa.
          </p>
        )}
      </div>

      {/* Free-form prompt */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Descripción libre
        </h2>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Describe el cuadro de mando que deseas crear con tus propias palabras
        </p>

        <div className="mt-4 max-w-2xl space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isDisabled}
            placeholder="Describe el dashboard que necesitas..."
            rows={6}
            className="w-full resize-none rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-4 py-3 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis placeholder:text-tremor-content-subtle dark:placeholder:text-dark-tremor-content-subtle focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />

          {error && (
            <ErrorDisplay
              error={error}
              onRetry={lastErrorSource === "generate" ? handleGenerate : undefined}
            />
          )}

          <button
            onClick={handleGenerate}
            disabled={isDisabled || prompt.trim() === ""}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      {/* Template cards */}
      <div>
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Plantillas predefinidas
        </h2>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Usa una plantilla para empezar con un dashboard listo al instante
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <button
              key={template.slug}
              onClick={() => handleUseTemplate(template)}
              disabled={isDisabled}
              className="flex flex-col items-start rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle p-5 text-left shadow-sm hover:border-blue-400 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {template.name}
              </h3>
              <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-2">
                {template.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-400">
                {loadingTemplate === template.slug ? (
                  <>
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
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
