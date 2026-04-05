"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardRenderer } from "@/components/DashboardRenderer";
import ChatSidebar from "@/components/ChatSidebar";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { DateRange } from "@/components/DateRangePicker";
import { GlossaryPanel } from "@/components/GlossaryPanel";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { DashboardSpec } from "@/lib/schema";
import type { ApiErrorResponse } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardRecord {
  id: number;
  name: string;
  description: string | null;
  spec: DashboardSpec;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Auto-refresh intervals (in minutes)
// ---------------------------------------------------------------------------

const REFRESH_INTERVALS = [5, 15, 30] as const;
type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

// ---------------------------------------------------------------------------
// Helper: format widget data as text for clipboard copy
// ---------------------------------------------------------------------------

function formatWidgetDataAsText(spec: DashboardSpec): string {
  const lines: string[] = [];
  lines.push(spec.title);
  if (spec.description) lines.push(spec.description);
  lines.push("---");

  for (const widget of spec.widgets) {
    if (widget.type === "kpi_row") {
      for (const item of widget.items) {
        lines.push(`${item.label}: [SQL: ${item.sql}]`);
      }
    } else {
      lines.push(`${widget.title}: [SQL: ${widget.sql}]`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ViewDashboard() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [dashboard, setDashboard] = useState<DashboardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorResponse | string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorResponse | string | null>(null);
  const saveCounter = useRef(0);
  const latestSpecRef = useRef<DashboardSpec | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-refresh state
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(15);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(0);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Date range filter state — default to last 30 days (day-based to avoid month-end overflow)
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  });

  // When date range changes, store the range and re-run all widget queries.
  // The date range is displayed in the picker for context; actual SQL filtering
  // depends on the widget SQL containing appropriate date expressions.
  // In a future iteration, widgets with a dateColumn hint could use
  // injectDateRange() to automatically apply the range client-side.
  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
    setRefreshKey((k) => k + 1);
  }, []);

  // Export dropdown state
  const [exportOpen, setExportOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Toast for silent failures (name save)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Load dashboard
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/dashboard/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        if (isApiErrorResponse(errBody)) {
          setError(errBody);
        } else {
          setError("Error al cargar el dashboard");
        }
        return;
      }
      const data: DashboardRecord = await res.json();
      setDashboard(data);
      setNameValue(data.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar el dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Keep latestSpecRef in sync
  useEffect(() => {
    if (dashboard) latestSpecRef.current = dashboard.spec;
  }, [dashboard]);

  // Focus input when editing name
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Auto-refresh logic
  // -------------------------------------------------------------------------

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setLastRefreshed(new Date());
  }, []);

  // Manage auto-refresh interval
  useEffect(() => {
    // Clear existing intervals
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (autoRefresh) {
      const intervalMs = refreshInterval * 60 * 1000;
      setSecondsUntilRefresh(refreshInterval * 60);

      autoRefreshRef.current = setInterval(() => {
        setRefreshKey((k) => k + 1);
        setLastRefreshed(new Date());
        setSecondsUntilRefresh(refreshInterval * 60);
      }, intervalMs);

      countdownRef.current = setInterval(() => {
        setSecondsUntilRefresh((s) => Math.max(0, s - 1));
      }, 1000);
    }

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, refreshInterval]);

  // -------------------------------------------------------------------------
  // Export: close dropdown on outside click
  // -------------------------------------------------------------------------

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    if (exportOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [exportOpen]);

  // -------------------------------------------------------------------------
  // Export handlers
  // -------------------------------------------------------------------------

  const handleCopyData = useCallback(async () => {
    if (!dashboard) return;
    const text = formatWidgetDataAsText(dashboard.spec);
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback: select-all-copy not supported in all contexts
    }
    setExportOpen(false);
  }, [dashboard]);

  const handlePrint = useCallback(() => {
    setExportOpen(false);
    window.print();
  }, []);

  // Save spec (and optionally name)
  const saveSpec = useCallback(
    async (spec: DashboardSpec, prompt?: string) => {
      const thisCount = ++saveCounter.current;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/dashboard/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec, prompt }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          if (isApiErrorResponse(errBody)) {
            throw errBody;
          }
          throw new Error("Error al guardar");
        }
        const updated: DashboardRecord = await res.json();
        // Only apply if this is still the latest save
        if (thisCount === saveCounter.current) {
          setDashboard(updated);
        }
      } catch (err) {
        if (thisCount === saveCounter.current) {
          if (isApiErrorResponse(err)) {
            setSaveError(err);
          } else {
            setSaveError(
              err instanceof Error ? err.message : "Error al guardar",
            );
          }
        }
      } finally {
        if (thisCount === saveCounter.current) {
          setSaving(false);
        }
      }
    },
    [id],
  );

  // Handle chat modification
  const handleSpecUpdate = useCallback(
    (newSpec: DashboardSpec, prompt: string) => {
      setDashboard((prev) =>
        prev ? { ...prev, spec: newSpec } : prev,
      );
      // Auto-save after chat modification with the actual user prompt
      saveSpec(newSpec, prompt);
    },
    [saveSpec],
  );

  // Handle name edit — persist via PUT endpoint
  const handleNameSave = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || !dashboard) {
      setEditingName(false);
      setNameValue(dashboard?.name || "");
      return;
    }
    setEditingName(false);
    setNameValue(trimmed);
    if (trimmed === dashboard.name) return;

    setDashboard((prev) => (prev ? { ...prev, name: trimmed } : prev));
    // Persist name change via the PUT endpoint, coordinated with saveCounter
    // Use latestSpecRef to avoid stale spec closure capture
    const currentSpec = latestSpecRef.current ?? dashboard.spec;
    const thisCount = ++saveCounter.current;
    try {
      const res = await fetch(`/api/dashboard/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: currentSpec, name: trimmed, skipVersion: true }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        if (isApiErrorResponse(errBody)) {
          throw errBody;
        }
        throw new Error(
          (errBody?.error as string) || "Error al guardar el nombre",
        );
      }
      const updated: DashboardRecord = await res.json();
      if (thisCount === saveCounter.current) {
        setDashboard(updated);
      }
    } catch (err) {
      if (thisCount === saveCounter.current) {
        // Revert on failure and notify via toast
        setDashboard((prev) =>
          prev ? { ...prev, name: dashboard.name } : prev,
        );
        setNameValue(dashboard.name);
        if (isApiErrorResponse(err)) {
          showToast(err.error);
        } else {
          showToast(
            err instanceof Error
              ? err.message
              : "No se pudo guardar el nombre del dashboard.",
          );
        }
      }
    }
  }, [nameValue, dashboard, id, showToast]);

  // Handle manual save button
  const handleSave = useCallback(() => {
    if (dashboard) {
      saveSpec(dashboard.spec);
    }
  }, [dashboard, saveSpec]);

  // -------------------------------------------------------------------------
  // Format helpers
  // -------------------------------------------------------------------------

  function formatTime(date: Date): string {
    return date.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatCountdown(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"
          role="status"
          aria-label="Cargando"
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not found
  // -------------------------------------------------------------------------

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Dashboard no encontrado
        </h1>
        <p className="text-sm text-tremor-content dark:text-dark-tremor-content">
          El dashboard solicitado no existe o fue eliminado.
        </p>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
        >
          Volver a la lista
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error || !dashboard) {
    return (
      <div className="space-y-4">
        <ErrorDisplay
          error={error || "Error al cargar el dashboard"}
          onRetry={fetchDashboard}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Dashboard view
  // -------------------------------------------------------------------------

  return (
    <div className={`transition-all ${chatOpen ? "mr-[350px]" : ""}`}>
      {/* Toast notification */}
      {toast && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
          data-testid="toast"
        >
          {toast}
        </div>
      )}

      {/* Top bar */}
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            aria-label="Volver"
            className="text-tremor-content dark:text-dark-tremor-content hover:text-tremor-content-emphasis dark:hover:text-dark-tremor-content-emphasis text-sm"
          >
            &larr; Volver
          </button>

          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameValue(dashboard.name);
                }
              }}
              className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong border-b-2 border-blue-500 bg-transparent outline-none"
            />
          ) : (
            <h1
              className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong cursor-pointer hover:text-blue-400"
              onClick={() => setEditingName(true)}
              title="Haz clic para editar el nombre"
            >
              {dashboard.name}
            </h1>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date range picker */}
          <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />

          {/* Last refreshed timestamp */}
          <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle" data-testid="last-refreshed">
            {`\u00DAltima actualizaci\u00F3n: ${formatTime(lastRefreshed)}`}
          </span>

          {/* Auto-refresh countdown */}
          {autoRefresh && (
            <span className="text-xs text-blue-500" data-testid="countdown">
              {formatCountdown(secondsUntilRefresh)}
            </span>
          )}

          {/* Manual refresh button */}
          <button
            onClick={triggerRefresh}
            className="rounded-lg border border-tremor-border dark:border-dark-tremor-border px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
            title="Actualizar datos"
            aria-label="Actualizar"
          >
            Actualizar
          </button>

          {/* Auto-refresh toggle + interval selector */}
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-xs text-tremor-content dark:text-dark-tremor-content cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-tremor-border dark:border-dark-tremor-border"
                data-testid="auto-refresh-toggle"
              />
              Auto
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) =>
                  setRefreshInterval(Number(e.target.value) as RefreshInterval)
                }
                className="text-xs border border-tremor-border dark:border-dark-tremor-border rounded px-1 py-0.5 text-tremor-content dark:text-dark-tremor-content bg-tremor-background dark:bg-dark-tremor-background"
                data-testid="refresh-interval-select"
              >
                {REFRESH_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen((prev) => !prev)}
              className="rounded-lg border border-tremor-border dark:border-dark-tremor-border px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
              aria-label="Exportar"
            >
              {copySuccess ? "Copiado!" : "Exportar"}
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle shadow-lg z-50">
                <button
                  onClick={handleCopyData}
                  className="w-full text-left px-4 py-2 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background dark:hover:bg-dark-tremor-background rounded-t-lg"
                >
                  Copiar datos
                </button>
                <button
                  onClick={handlePrint}
                  className="w-full text-left px-4 py-2 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background dark:hover:bg-dark-tremor-background rounded-b-lg"
                >
                  Imprimir / PDF
                </button>
              </div>
            )}
          </div>

          {/* Glosario button — only shown when glossary has entries */}
          {dashboard.spec.glossary && dashboard.spec.glossary.length > 0 && (
            <button
              onClick={() =>
                setGlossaryOpen((prev) => {
                  const nextOpen = !prev;
                  if (nextOpen) setChatOpen(false);
                  return nextOpen;
                })
              }
              className="rounded-lg border border-tremor-border dark:border-dark-tremor-border px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle transition-colors"
              aria-label={glossaryOpen ? "Cerrar glosario" : "Abrir glosario"}
              data-testid="glossary-button"
            >
              Glosario
            </button>
          )}

          {saving && (
            <span className="text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">Guardando...</span>
          )}
          {saveError && (
            <span className="text-xs text-red-400">
              {typeof saveError === "string" ? saveError : saveError.error}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg border border-tremor-border dark:border-dark-tremor-border px-4 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle disabled:opacity-50 transition-colors"
          >
            Guardar
          </button>
          <button
            onClick={() => setChatOpen((prev) => !prev)}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
          >
            {chatOpen ? "Cerrar chat" : "Modificar"}
          </button>
        </div>
      </div>

      {/* Dashboard renderer */}
      <DashboardRenderer
        spec={dashboard.spec}
        refreshKey={refreshKey}
        dateRange={dateRange}
      />

      {/* Chat sidebar — close glossary panel when opening chat to avoid overlap */}
      <ChatSidebar
        spec={dashboard.spec}
        onSpecUpdate={handleSpecUpdate}
        isOpen={chatOpen}
        onToggle={() =>
          setChatOpen((prev) => {
            const nextOpen = !prev;
            if (nextOpen) setGlossaryOpen(false);
            return nextOpen;
          })
        }
      />

      {/* Glossary panel — close chat sidebar when opening glossary to avoid overlap */}
      {dashboard.spec.glossary && dashboard.spec.glossary.length > 0 && (
        <GlossaryPanel
          glossary={dashboard.spec.glossary}
          isOpen={glossaryOpen}
          onClose={() => setGlossaryOpen(false)}
        />
      )}
    </div>
  );
}
