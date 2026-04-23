"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSpec } from "@/lib/schema";
import { TEMPLATES, type DashboardTemplate } from "@/lib/templates";
import { TASK_PROMPTS } from "@/lib/task-prompts";
import { DASHBOARD_ROLES } from "@/lib/dashboard-roles";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import { DashboardGenerateProgressDialog } from "@/components/DashboardGenerateProgressDialog";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import { runDashboardGenerateStream } from "@/lib/run-dashboard-generate-stream";

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

type CreationTab = "templates" | "assistant" | "free";

const CREATION_TAB_ORDER: CreationTab[] = ["templates", "assistant", "free"];

function focusCreationTabButton(id: CreationTab) {
  requestAnimationFrame(() => {
    document.getElementById(`creation-tab-${id}-btn`)?.focus();
  });
}

// ─── Role options ─────────────────────────────────────────────────────────────

const ROLES = DASHBOARD_ROLES;

// ─── Badges (IA vs plantilla) ───────────────────────────────────────────────

function BadgeUsesAi() {
  return (
    <span className="mb-2 inline-block rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-400/20 dark:text-violet-100">
      Usa IA
    </span>
  );
}

function BadgeNoAi() {
  return (
    <span className="mb-2 inline-block rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100">
      Sin IA · instantáneo
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<CreationTab>("assistant");

  // Free-form generation state
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorResponse | string | null>(null);
  const [lastErrorSource, setLastErrorSource] = useState<"generate" | "task" | "template" | null>(
    null,
  );

  const [cachedDashboardList, setCachedDashboardList] = useState<DashboardListItem[] | null>(null);

  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [gapsError, setGapsError] = useState<string | null>(null);

  const [agenticOpen, setAgenticOpen] = useState(false);
  const [agenticLines, setAgenticLines] = useState<string[]>([]);
  const [agenticRequestId, setAgenticRequestId] = useState<string | null>(null);
  const [agenticPhase, setAgenticPhase] = useState<"running" | "error" | "success">("running");
  const [agenticErrorSummary, setAgenticErrorSummary] = useState<ReactNode>(null);

  const dismissAgenticDialog = () => {
    setAgenticOpen(false);
    setAgenticLines([]);
    setAgenticRequestId(null);
    setAgenticPhase("running");
    setAgenticErrorSummary(null);
  };

  const getDashboardList = async (): Promise<DashboardListItem[]> => {
    if (cachedDashboardList !== null) {
      return cachedDashboardList;
    }
    const listRes = await fetch("/api/dashboards");
    if (!listRes.ok) {
      const errBody = await listRes.json().catch(() => null);
      throw new Error(
        (errBody?.error as string) || "Error al cargar los dashboards existentes",
      );
    }
    const data = (await listRes.json()) as DashboardListItem[];
    setCachedDashboardList(data);
    return data;
  };

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

  const generateFromPrompt = async (
    promptText: string,
    source: "generate" | "task" = "task",
  ) => {
    const trimmed = promptText.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setLastErrorSource(null);
    setAgenticOpen(true);
    setAgenticLines([]);
    setAgenticRequestId(null);
    setAgenticPhase("running");
    setAgenticErrorSummary(null);

    try {
      const spec = await runDashboardGenerateStream(trimmed, {
        onMeta: (rid, lines) => {
          setAgenticRequestId(rid);
          setAgenticLines((prev) => [...prev, ...lines]);
        },
        onLine: (line) => {
          setAgenticLines((prev) => [...prev, line]);
        },
      });

      const name = spec.title || "Dashboard sin título";
      dismissAgenticDialog();
      await saveAndRedirect(name, spec.description || null, spec);
    } catch (err) {
      setAgenticPhase("error");
      if (isApiErrorResponse(err)) {
        setError(err);
        setAgenticErrorSummary(<ErrorDisplay error={err} />);
      } else {
        const msg = err instanceof Error ? err.message : "Error inesperado";
        setError(msg);
        setAgenticErrorSummary(<ErrorDisplay error={msg} />);
      }
      setLastErrorSource(source);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    await generateFromPrompt(prompt, "generate");
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

  const handleRoleSelect = async (role: string) => {
    if (isDisabled) return;

    setSelectedRole(role);
    setSuggestions(null);
    setSuggestError(null);
    setLoadingSuggestions(true);

    try {
      const listData = await getDashboardList();

      const existingDashboards = listData.map((d) => ({
        title: d.name,
        description: d.description || "",
      }));

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

  const handleAnalyzeGaps = async () => {
    if (isDisabled) return;

    setGaps(null);
    setGapsError(null);
    setLoadingGaps(true);

    try {
      const listData = await getDashboardList();

      const dashboardsWithSpecs: {
        title: string;
        description: string;
        widgetTitles: string[];
      }[] = await Promise.all(
        listData.slice(0, 30).map(async (d) => {
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

  const isDisabled = loading || loadingTemplate !== null || loadingSuggestions || loadingGaps;

  const handleCreationTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: CreationTab) => {
    const idx = CREATION_TAB_ORDER.indexOf(current);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = CREATION_TAB_ORDER[(idx + 1) % CREATION_TAB_ORDER.length]!;
      setTab(next);
      focusCreationTabButton(next);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        CREATION_TAB_ORDER[(idx - 1 + CREATION_TAB_ORDER.length) % CREATION_TAB_ORDER.length]!;
      setTab(next);
      focusCreationTabButton(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      const next = CREATION_TAB_ORDER[0]!;
      setTab(next);
      focusCreationTabButton(next);
    } else if (e.key === "End") {
      e.preventDefault();
      const next = CREATION_TAB_ORDER[CREATION_TAB_ORDER.length - 1]!;
      setTab(next);
      focusCreationTabButton(next);
    }
  };

  const tabDefs: { id: CreationTab; label: string; hint: string }[] = [
    { id: "templates", label: "Plantillas", hint: "Sin IA, inmediato" },
    { id: "assistant", label: "Asistente IA", hint: "Tareas, rol y cobertura" },
    { id: "free", label: "Descripción libre", hint: "Prompt a medida" },
  ];

  return (
    <div className="space-y-8">
      <DataFreshnessBanner />

      <div>
        <h1 className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Nuevo Dashboard
        </h1>
        <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
          Elige cómo quieres crear tu cuadro de mando
        </p>
      </div>

      {error && (lastErrorSource === "task" || lastErrorSource === "template") && (
        <ErrorDisplay error={error} />
      )}

      {/* Mapa mental — issue #377 */}
      <section
        className="rounded-lg border border-tremor-border bg-tremor-background-subtle p-4 text-sm text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-subtle dark:text-dark-tremor-content"
        aria-labelledby="new-dash-how-heading"
      >
        <h2
          id="new-dash-how-heading"
          className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong"
        >
          Tres formas de crear tu cuadro de mando
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
          <li>
            <strong>Plantillas</strong>: partimos de un panel ya montado; se guarda al instante{" "}
            <em>sin</em> llamar al modelo de IA.
          </li>
          <li>
            <strong>Asistente IA</strong>: tareas de negocio listas, sugerencias según tu rol y
            análisis de huecos en tus paneles actuales. Todo usa el modelo (puede tardar unos
            segundos y consume presupuesto de uso).
          </li>
          <li>
            <strong>Descripción libre</strong>: escribes lo que necesitas y generamos el panel con
            IA.
          </li>
        </ul>
      </section>

      <div>
        <p id="creation-tabs-label" className="sr-only">
          Modo de creación
        </p>
        <div
          role="tablist"
          aria-labelledby="creation-tabs-label"
          className="flex flex-wrap gap-1 border-b border-tremor-border dark:border-dark-tremor-border"
        >
          {tabDefs.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                id={`creation-tab-${t.id}-btn`}
                aria-controls={selected ? `creation-tab-panel-${t.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                data-testid={`creation-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => handleCreationTabKeyDown(e, t.id)}
                className={`relative -mb-px rounded-t-md border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  selected
                    ? "border-tremor-border bg-tremor-background text-blue-600 dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-blue-400"
                    : "border-transparent text-tremor-content hover:text-blue-500 dark:text-dark-tremor-content dark:hover:text-blue-400"
                }`}
              >
                <span>{t.label}</span>
                <span className="mt-0.5 block text-[10px] font-normal opacity-80">{t.hint}</span>
              </button>
            );
          })}
        </div>

        {/* ─── Plantillas ─────────────────────────────────────────────────── */}
        <div
          id="creation-tab-panel-templates"
          role="tabpanel"
          aria-labelledby="creation-tab-templates-btn"
          hidden={tab !== "templates"}
          className="pt-8"
        >
            <div>
              <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                Plantillas predefinidas
              </h2>
              <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
                Usa una plantilla para empezar con un dashboard listo al instante (sin generación
                por IA).
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.slug}
                    type="button"
                    onClick={() => handleUseTemplate(template)}
                    disabled={isDisabled}
                    data-testid={`template-card-${template.slug}`}
                    className="flex flex-col items-start rounded-lg border border-emerald-500/25 bg-tremor-background-subtle p-5 text-left shadow-sm hover:border-emerald-500/50 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed dark:border-emerald-500/20 dark:bg-dark-tremor-background-subtle dark:hover:border-emerald-500/40"
                  >
                    <BadgeNoAi />
                    <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                      {template.name}
                    </h3>
                    <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-2">
                      {template.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {loadingTemplate === template.slug ? (
                        <>
                          <span
                            className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"
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

        {/* ─── Asistente IA ───────────────────────────────────────────────── */}
        <div
          id="creation-tab-panel-assistant"
          role="tabpanel"
          aria-labelledby="creation-tab-assistant-btn"
          hidden={tab !== "assistant"}
          className="space-y-10 pt-8"
        >
            <div>
              <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                ¿Qué necesitas hacer?
              </h2>
              <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
                Atajos de negocio: al pulsar, el modelo genera el panel y lo guardamos automáticamente.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {TASK_PROMPTS.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => generateFromPrompt(task.prompt)}
                    disabled={isDisabled}
                    data-testid={`task-card-${task.id}`}
                    className="flex flex-col items-start rounded-lg border border-violet-500/20 bg-tremor-background-subtle p-5 text-left shadow-sm hover:border-violet-500/45 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed dark:border-violet-400/15 dark:bg-dark-tremor-background-subtle dark:hover:border-violet-400/35"
                  >
                    <BadgeUsesAi />
                    <span className="text-2xl" aria-hidden="true">
                      {task.icon}
                    </span>
                    <h3 className="mt-2 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                      {task.title}
                    </h3>
                    <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-2">
                      {task.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                      Crear panel
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                Recomendado para ti
              </h2>
              <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
                Selecciona tu rol y te sugerimos paneles útiles evitando solaparse con los que ya
                tienes.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleRoleSelect(role)}
                    disabled={isDisabled || loadingSuggestions}
                    data-testid={`role-pill-${role}`}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      selectedRole === role
                        ? "border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-600"
                        : "border-tremor-border text-tremor-content hover:border-violet-400 hover:text-violet-600 dark:border-dark-tremor-border dark:text-dark-tremor-content dark:hover:border-violet-400 dark:hover:text-violet-300"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>

              {loadingSuggestions && (
                <div className="mt-4 flex items-center gap-2 text-sm text-tremor-content dark:text-dark-tremor-content">
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"
                    role="status"
                    aria-label="Cargando sugerencias"
                  />
                  Analizando tu perfil...
                </div>
              )}

              {suggestError && <p className="mt-4 text-sm text-red-400">{suggestError}</p>}

              {suggestions && suggestions.length > 0 && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {suggestions.map((s, i) => (
                    <div
                      key={`${s.name}-${i}`}
                      className="flex flex-col items-start rounded-lg border border-violet-500/20 bg-tremor-background-subtle p-5 shadow-sm dark:border-violet-400/15 dark:bg-dark-tremor-background-subtle"
                    >
                      <BadgeUsesAi />
                      <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                        {s.name}
                      </h3>
                      <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content line-clamp-3">
                        {s.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => generateFromPrompt(s.prompt)}
                        disabled={isDisabled}
                        className="mt-3 inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-violet-600 dark:hover:bg-violet-500"
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

            <div>
              <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                ¿Qué me falta?
              </h2>
              <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
                Analiza tus paneles actuales y descubre áreas de negocio poco cubiertas.
              </p>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleAnalyzeGaps}
                  disabled={isDisabled || loadingGaps}
                  data-testid="analyze-gaps-button"
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-500/25 bg-tremor-background-subtle px-4 py-2 text-sm font-medium text-tremor-content-strong hover:border-violet-500/50 hover:text-violet-800 disabled:opacity-50 disabled:cursor-not-allowed dark:border-violet-400/20 dark:bg-dark-tremor-background-subtle dark:text-dark-tremor-content-strong dark:hover:text-violet-200"
                >
                  {loadingGaps ? (
                    <>
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"
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

              {gapsError && <p className="mt-4 text-sm text-red-400">{gapsError}</p>}

              {gaps && gaps.length > 0 && (
                <div className="mt-4 space-y-3">
                  {gaps.map((g, i) => (
                    <div
                      key={`${g.area}-${i}`}
                      className="flex items-start justify-between gap-4 rounded-lg border border-violet-500/20 bg-tremor-background-subtle p-4 shadow-sm dark:border-violet-400/15 dark:bg-dark-tremor-background-subtle"
                    >
                      <div className="flex-1">
                        <BadgeUsesAi />
                        <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                          {g.area}
                        </h3>
                        <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content">
                          {g.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => generateFromPrompt(g.suggestedPrompt)}
                        disabled={isDisabled}
                        className="shrink-0 self-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-violet-600 dark:hover:bg-violet-500"
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
        </div>

        {/* ─── Descripción libre ───────────────────────────────────────────── */}
        <div
          id="creation-tab-panel-free"
          role="tabpanel"
          aria-labelledby="creation-tab-free-btn"
          hidden={tab !== "free"}
          className="pt-8"
        >
            <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              Descripción libre
            </h2>
            <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
              Describe el cuadro de mando con tus propias palabras; generamos el panel con IA.
            </p>

            <div className="mt-4 max-w-2xl space-y-4">
              <BadgeUsesAi />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isDisabled}
                placeholder="Describe el dashboard que necesitas..."
                rows={6}
                className="w-full resize-none rounded-lg border border-tremor-border bg-tremor-background px-4 py-3 text-sm text-tremor-content-emphasis placeholder:text-tremor-content-subtle focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-emphasis dark:placeholder:text-dark-tremor-content-subtle"
              />

              {error && lastErrorSource === "generate" && !agenticOpen && (
                <ErrorDisplay error={error} onRetry={handleGenerate} />
              )}

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isDisabled || prompt.trim() === ""}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-violet-600 dark:hover:bg-violet-500"
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
      </div>

      <DashboardGenerateProgressDialog
        open={agenticOpen}
        title="Generando panel con IA"
        requestId={agenticRequestId}
        lines={agenticLines}
        phase={agenticPhase}
        errorSummary={agenticErrorSummary}
        onDismiss={dismissAgenticDialog}
      />
    </div>
  );
}
