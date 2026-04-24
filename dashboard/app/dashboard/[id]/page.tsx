"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DashboardRenderer } from "@/components/DashboardRenderer";
import { DashboardFiltersBar } from "@/components/DashboardFiltersBar";
import type { GlobalFilterValues } from "@/lib/sql-filters";
import type { WidgetState } from "@/components/DashboardRenderer";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import ChatSidebar from "@/components/ChatSidebar";
import type { ChatMessage } from "@/components/ChatSidebar";
import AnalyzeLauncher from "@/components/AnalyzeLauncher";
import {
  DateRangePicker,
  computeComparisonRange,
  startOfDay,
  endOfDay,
} from "@/components/DateRangePicker";
import type { DateRange, ComparisonRange } from "@/components/DateRangePicker";
import { GlossaryPanel } from "@/components/GlossaryPanel";
import { VersionHistory } from "@/components/VersionHistory";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { DashboardSpec } from "@/lib/schema";
import type { ApiErrorResponse } from "@/lib/errors";
import type { DrillDownContext } from "@/components/widgets/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardRecord {
  id: number;
  name: string;
  description: string | null;
  spec: DashboardSpec;
  chat_messages_analyze?: ChatMessage[];
  chat_messages_modify?: ChatMessage[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Auto-refresh intervals (in minutes)
// ---------------------------------------------------------------------------

const REFRESH_INTERVALS = [5, 15, 30] as const;
type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

function getDefaultDashboardDateRange(): DateRange {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    23,
    59,
    59,
    999,
  );
  return { from, to };
}

function defaultComparisonRangeFor(
  primary: DateRange,
): ComparisonRange | undefined {
  const r = computeComparisonRange(primary, "previous_period");
  if (!r) return undefined;
  return { type: "previous_period", ...r };
}

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
    } else if (widget.type === "insights_strip") {
      lines.push(`[insights_strip]: [static widget]`);
    } else if (widget.type === "ranked_bars") {
      lines.push(`${widget.title}: [static widget]`);
    } else {
      lines.push(`${widget.title}: [SQL: ${widget.sql}]`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function parseIsoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export default function ViewDashboard() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id;

  const [dashboard, setDashboard] = useState<DashboardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorResponse | string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialMode, setChatInitialMode] = useState<"modificar" | "analizar" | undefined>(undefined);
  const [pendingModify, setPendingModify] = useState<{ prompt: string; id: number } | null>(null);
  const drillDownIdRef = useRef(0);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [widgetData, setWidgetData] = useState<Map<number, WidgetState>>(new Map());
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

  // Date range filter
  const [dateRange, setDateRange] = useState<DateRange>(() => getDefaultDashboardDateRange());
  const [comparisonRange, setComparisonRange] = useState<ComparisonRange | undefined>(() =>
    defaultComparisonRangeFor(getDefaultDashboardDateRange()),
  );
  const [globalFilterValues, setGlobalFilterValues] = useState<GlobalFilterValues>({});
  const appliedUrlRange = useRef(false);

  const handleDateRangeChange = useCallback(
    ({ primary, comparison }: { primary: DateRange; comparison?: ComparisonRange }) => {
      setDateRange(primary);
      setComparisonRange(comparison);
      setRefreshKey((k) => k + 1);
    },
    [],
  );

  const handleGlobalFilterChange = useCallback((next: GlobalFilterValues) => {
    setGlobalFilterValues(next);
    setRefreshKey((k) => k + 1);
  }, []);

  // Export dropdown state
  const [exportOpen, setExportOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Toast
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

  useEffect(() => {
    appliedUrlRange.current = false;
  }, [id]);

  // Deep-link from weekly review
  useEffect(() => {
    if (appliedUrlRange.current) return;
    const cf = searchParams.get("curr_from");
    const ct = searchParams.get("curr_to");
    const pf = searchParams.get("comp_from");
    const pt = searchParams.get("comp_to");
    if (!cf || !ct || !pf || !pt) return;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(cf) || !iso.test(ct) || !iso.test(pf) || !iso.test(pt)) return;
    appliedUrlRange.current = true;
    const primary: DateRange = {
      from: startOfDay(parseIsoToLocalDate(cf)),
      to: endOfDay(parseIsoToLocalDate(ct)),
    };
    const comparison: ComparisonRange = {
      type: "custom",
      from: startOfDay(parseIsoToLocalDate(pf)),
      to: endOfDay(parseIsoToLocalDate(pt)),
    };
    setDateRange(primary);
    setComparisonRange(comparison);
    setRefreshKey((k) => k + 1);
  }, [searchParams, id]);

  useEffect(() => {
    setGlobalFilterValues({});
  }, [id]);

  useEffect(() => {
    if (dashboard) latestSpecRef.current = dashboard.spec;
  }, [dashboard]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

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

  useEffect(() => {
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

  // Export: close dropdown on outside click
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
      // Fallback not available
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

  const handlePendingModifyInputConsumed = useCallback(() => {
    setPendingModify(null);
  }, []);

  const handleDataPointClick = useCallback((ctx: DrillDownContext) => {
    let prompt: string;
    if (ctx.widgetType === "bar_chart" || ctx.widgetType === "donut_chart") {
      prompt = `Detalle de ${ctx.label} en ${ctx.widgetTitle}: desglose por categoría, top artículos y tendencia`;
    } else if (ctx.widgetType === "line_chart" || ctx.widgetType === "area_chart") {
      prompt = `¿Qué ocurrió en ${ctx.label} en ${ctx.widgetTitle}? Detalle por tienda y categoría`;
    } else {
      prompt = `Más información sobre ${ctx.label}`;
    }
    setGlossaryOpen(false);
    setHistoryOpen(false);
    drillDownIdRef.current += 1;
    setPendingModify({ prompt, id: drillDownIdRef.current });
    setChatOpen(true);
  }, []);

  const handleChatToggle = useCallback(() => {
    setChatOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setGlossaryOpen(false);
        setHistoryOpen(false);
      } else {
        setChatInitialMode(undefined);
      }
      return nextOpen;
    });
  }, []);

  const handleOpenChatSidebar = useCallback(() => {
    setGlossaryOpen(false);
    setHistoryOpen(false);
    setChatOpen(true);
  }, []);

  /** Opens the sidebar in analizar mode — called by AnalyzeLauncher */
  const handleOpenAnalyze = useCallback(() => {
    setGlossaryOpen(false);
    setHistoryOpen(false);
    setChatInitialMode("analizar");
    setChatOpen(true);
  }, []);

  const handleSpecUpdate = useCallback(
    (newSpec: DashboardSpec, prompt: string) => {
      setDashboard((prev) =>
        prev ? { ...prev, spec: newSpec } : prev,
      );
      saveSpec(newSpec, prompt);
    },
    [saveSpec],
  );

  const modifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modifyCounterRef = useRef(0);
  const analyzeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzeCounterRef = useRef(0);

  const handleAnalyzeMessagesChange = useCallback(
    (messages: ChatMessage[]) => {
      if (!dashboard) return;
      if (analyzeDebounceRef.current) {
        clearTimeout(analyzeDebounceRef.current);
      }
      analyzeDebounceRef.current = setTimeout(() => {
        const thisCount = ++analyzeCounterRef.current;
        fetch(`/api/dashboard/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec: latestSpecRef.current ?? dashboard.spec,
            chat_messages_analyze: messages,
            skipVersion: true,
          }),
        })
          .then((res) => {
            if (thisCount !== analyzeCounterRef.current) return;
            if (!res.ok) {
              console.error("Error guardando mensajes de análisis:", res.status);
            }
          })
          .catch((err) => {
            if (thisCount !== analyzeCounterRef.current) return;
            console.error("Error guardando mensajes de análisis:", err);
          });
      }, 800);
    },
    [dashboard, id],
  );

  useEffect(() => {
    return () => {
      if (analyzeDebounceRef.current) {
        clearTimeout(analyzeDebounceRef.current);
      }
    };
  }, [id]);

  const handleModifyMessagesChange = useCallback(
    (messages: ChatMessage[]) => {
      if (!dashboard) return;
      if (modifyDebounceRef.current) {
        clearTimeout(modifyDebounceRef.current);
      }
      modifyDebounceRef.current = setTimeout(() => {
        const thisCount = ++modifyCounterRef.current;
        fetch(`/api/dashboard/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spec: latestSpecRef.current ?? dashboard.spec,
            chat_messages_modify: messages,
            skipVersion: true,
          }),
        })
          .then((res) => {
            if (thisCount !== modifyCounterRef.current) return;
            if (!res.ok) {
              console.error("Error guardando mensajes de modificar:", res.status);
            }
          })
          .catch((err) => {
            if (thisCount !== modifyCounterRef.current) return;
            console.error("Error guardando mensajes de modificar:", err);
          });
      }, 800);
    },
    [dashboard, id],
  );

  useEffect(() => {
    return () => {
      if (modifyDebounceRef.current) {
        clearTimeout(modifyDebounceRef.current);
      }
    };
  }, [id]);

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

  // Outline button style (B1)
  const outlineBtn: React.CSSProperties = {
    height: 32,
    background: "transparent",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    color: "var(--fg)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "inherit",
  };

  // Breadcrumbs from spec (B1)
  const breadcrumbs = dashboard.spec.breadcrumbs ?? ["Retail", "Ventas"];

  // Title split at em-dash
  const titleParts = dashboard.name.split(/\s*—\s*/);
  const titleMain = titleParts[0] ?? dashboard.name;
  const titleSub = titleParts.length > 1 ? titleParts.slice(1).join(" — ") : null;

  return (
    <div
      data-no-main-padding
      style={{
        marginRight: chatOpen ? 380 : 0,
        transition: "margin 0.2s ease",
      }}
    >
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

      {/* ------------------------------------------------------------------ */}
      {/* Page header — B1 design                                             */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="no-print"
        style={{ padding: "24px 20px 14px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          {/* Left: breadcrumb + title + description */}
          <div>
            {/* Breadcrumb row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--fg-muted)",
                fontFamily: "var(--font-jetbrains, monospace)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              {breadcrumbs.map((crumb, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {i > 0 && <span style={{ color: "var(--fg-subtle)" }}>/</span>}
                  {crumb}
                </span>
              ))}
              <span
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  borderRadius: 3,
                  padding: "2px 6px",
                  fontSize: 10,
                  marginLeft: 2,
                }}
              >
                EN VIVO
              </span>
            </div>

            {/* H1 — editable name */}
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
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                  background: "transparent",
                  border: "none",
                  borderBottom: "2px solid var(--accent)",
                  outline: "none",
                  color: "var(--fg)",
                  fontFamily: "inherit",
                  width: "100%",
                  maxWidth: 600,
                }}
              />
            ) : (
              <h1
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                  margin: 0,
                  cursor: "pointer",
                  fontFamily: "var(--font-inter, sans-serif)",
                }}
                onClick={() => setEditingName(true)}
                title="Haz clic para editar el nombre"
              >
                {titleMain}
                {titleSub && (
                  <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
                    {" — "}{titleSub}
                  </span>
                )}
              </h1>
            )}

            {/* Description */}
            {dashboard.spec.description && (
              <p
                style={{
                  color: "var(--fg-muted)",
                  margin: "8px 0 0",
                  fontSize: 13,
                  maxWidth: 680,
                  lineHeight: 1.5,
                }}
              >
                {dashboard.spec.description}
              </p>
            )}
          </div>

          {/* Right: date picker + action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Date range picker */}
            <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />

            {/* Auto-refresh controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  style={{ width: 12, height: 12 }}
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
                  style={{
                    fontSize: 11,
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "2px 4px",
                    background: "var(--bg-1)",
                    color: "var(--fg-muted)",
                  }}
                  data-testid="refresh-interval-select"
                >
                  {REFRESH_INTERVALS.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              )}
              {autoRefresh && (
                <span
                  style={{ fontSize: 11, color: "var(--accent)" }}
                  data-testid="countdown"
                >
                  {formatCountdown(secondsUntilRefresh)}
                </span>
              )}
            </div>

            {/* Manual refresh */}
            <button
              onClick={triggerRefresh}
              style={outlineBtn}
              title={`Última actualización: ${formatTime(lastRefreshed)}`}
              aria-label="Actualizar"
              data-testid="last-refreshed"
            >
              ⟳ Actualizar
            </button>

            {/* Export dropdown */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((prev) => !prev)}
                style={outlineBtn}
                aria-label="Exportar"
              >
                {copySuccess ? "Copiado!" : "Exportar"}
              </button>
              {exportOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    marginTop: 4,
                    width: 180,
                    background: "var(--bg-1)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px -6px rgba(0,0,0,0.4)",
                    zIndex: 50,
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={handleCopyData}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      fontSize: 12,
                      background: "none",
                      border: "none",
                      color: "var(--fg)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Copiar datos
                  </button>
                  <button
                    onClick={handlePrint}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      fontSize: 12,
                      background: "none",
                      border: "none",
                      color: "var(--fg)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    Imprimir / PDF
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                setHistoryOpen((prev) => {
                  const nextOpen = !prev;
                  if (nextOpen) {
                    setChatOpen(false);
                    setGlossaryOpen(false);
                  }
                  return nextOpen;
                })
              }
              style={outlineBtn}
              aria-label={historyOpen ? "Cerrar historial" : "Abrir historial"}
              data-testid="history-button"
            >
              Historial
            </button>

            {/* Glosario button */}
            {dashboard.spec.glossary && dashboard.spec.glossary.length > 0 && (
              <button
                onClick={() =>
                  setGlossaryOpen((prev) => {
                    const nextOpen = !prev;
                    if (nextOpen) {
                      setChatOpen(false);
                      setHistoryOpen(false);
                    }
                    return nextOpen;
                  })
                }
                style={outlineBtn}
                aria-label={glossaryOpen ? "Cerrar glosario" : "Abrir glosario"}
                data-testid="glossary-button"
              >
                Glosario
              </button>
            )}

            {saving && (
              <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>Guardando...</span>
            )}
            {saveError && (
              <span style={{ fontSize: 11, color: "var(--down)" }}>
                {typeof saveError === "string" ? saveError : saveError.error}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...outlineBtn, opacity: saving ? 0.5 : 1 }}
            >
              Guardar
            </button>
          </div>
        </div>
      </div>

      {/* Data freshness banner — loads independently, does not block dashboard */}
      <DataFreshnessBanner />

      {dashboard.spec.filters && dashboard.spec.filters.length > 0 && (
        <DashboardFiltersBar
          dashboardId={dashboard.id}
          spec={dashboard.spec}
          dateRange={dateRange}
          value={globalFilterValues}
          onChange={handleGlobalFilterChange}
        />
      )}

      {/* Dashboard renderer */}
      <DashboardRenderer
        spec={dashboard.spec}
        refreshKey={refreshKey}
        dateRange={dateRange}
        comparisonRange={comparisonRange}
        globalFilterValues={globalFilterValues}
        onWidgetDataChange={setWidgetData}
        onDataPointClick={handleDataPointClick}
      />

      {/* Floating rail launcher — hidden when sidebar is open */}
      <AnalyzeLauncher
        onOpen={handleOpenAnalyze}
        hidden={chatOpen}
      />

      {/* Chat sidebar */}
      <ChatSidebar
        spec={dashboard.spec}
        onSpecUpdate={handleSpecUpdate}
        isOpen={chatOpen}
        dashboardId={dashboard.id}
        onToggle={handleChatToggle}
        onOpenSidebar={handleOpenChatSidebar}
        widgetData={widgetData}
        initialAnalyzeMessages={dashboard.chat_messages_analyze ?? []}
        onAnalyzeMessagesChange={handleAnalyzeMessagesChange}
        initialModifyMessages={dashboard.chat_messages_modify ?? []}
        onModifyMessagesChange={handleModifyMessagesChange}
        pendingModifyInput={pendingModify?.prompt}
        pendingModifyTriggerId={pendingModify?.id}
        onPendingModifyInputConsumed={handlePendingModifyInputConsumed}
        initialMode={chatInitialMode}
      />

      {/* Glossary panel */}
      {dashboard.spec.glossary && dashboard.spec.glossary.length > 0 && (
        <GlossaryPanel
          glossary={dashboard.spec.glossary}
          isOpen={glossaryOpen}
          onClose={() => setGlossaryOpen(false)}
        />
      )}

      <VersionHistory
        dashboardId={dashboard.id}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={(spec) => {
          setDashboard((prev) => (prev ? { ...prev, spec } : prev));
          setHistoryOpen(false);
        }}
      />
    </div>
  );
}
