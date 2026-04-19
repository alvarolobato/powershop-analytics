"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@tremor/react";
import { RunList } from "@/components/etl/RunList";
import { EvolutionCharts } from "@/components/etl/EvolutionCharts";
import type { EtlSyncRun } from "@/components/etl/RunList";
import type { EtlStatsData } from "@/components/etl/EvolutionCharts";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { isApiErrorResponse } from "@/lib/errors";
import type { ApiErrorResponse } from "@/lib/errors";
import { formatDuration, formatNumber } from "@/lib/etl-format";

const PER_PAGE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(isoStr: string): string {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return "hace un momento";
    if (mins < 60) return `hace ${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)} días`;
  } catch {
    return isoStr;
  }
}

function formatSuccessRate(rate: EtlStatsData["success_rate"]): string {
  if (rate.total === 0) return "—";
  return `${Math.round((rate.success / rate.total) * 100)}%`;
}

// ─── Loading skeletons ────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-pulse" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="h-3 w-24 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
          <div className="mt-2 h-7 w-32 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        </Card>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 animate-pulse" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="h-4 w-40 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle mb-4" />
          <div className="h-40 rounded bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle" />
        </Card>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EtlMonitorPage() {
  const [runs, setRuns] = useState<EtlSyncRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<ApiErrorResponse | string | null>(null);

  const [stats, setStats] = useState<EtlStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<ApiErrorResponse | string | null>(null);

  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async (p: number, silent = false) => {
    if (!silent) setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await fetch(`/api/etl/runs?page=${p}&per_page=${PER_PAGE}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRunsError(
          isApiErrorResponse(body) ? body : "Error al cargar las ejecuciones"
        );
        return;
      }
      const data = await res.json();
      setRuns(data.runs as EtlSyncRun[]);
      setTotal(data.total as number);
    } catch (err) {
      setRunsError(
        err instanceof Error ? err.message : "Error al cargar las ejecuciones"
      );
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/etl/stats");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStatsError(
          isApiErrorResponse(body) ? body : "Error al cargar estadísticas"
        );
        return;
      }
      const data: EtlStatsData = await res.json();
      setStats(data);
    } catch (err) {
      setStatsError(
        err instanceof Error ? err.message : "Error al cargar estadísticas"
      );
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns(1);
    fetchStats();
  }, [fetchRuns, fetchStats]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchRuns(newPage);
  };

  const isRunning = runs.some((r) => r.status === "running");

  // Poll every 5 s while a run is active; stop when none are running
  useEffect(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (isRunning) {
      pollingRef.current = setInterval(() => { void fetchRuns(page, true); }, 5_000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [isRunning, fetchRuns, page]);

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await fetch("/api/etl/run", { method: "POST" });
      if (res.status === 409) {
        // already running — let polling pick it up
      } else if (!res.ok) {
        setTriggerError("Error al iniciar la sincronización");
      }
      await fetchRuns(page, true);
    } catch {
      setTriggerError("Error al iniciar la sincronización");
    } finally {
      setTriggering(false);
    }
  }, [fetchRuns, page]);

  // Last non-running run for KPI row
  const lastRun = runs.find((r) => r.status !== "running") ?? null;
  const successRateStr = stats ? formatSuccessRate(stats.success_rate) : null;

  return (
    <div className="space-y-6" data-testid="etl-monitor-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Monitor ETL
          </h1>
          <p className="mt-1 text-sm text-tremor-content dark:text-dark-tremor-content">
            Historial y estadísticas de sincronización de datos
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => { void handleTrigger(); }}
            disabled={triggering || isRunning}
            data-testid="sync-now-button"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {(triggering || isRunning) && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden="true"
              />
            )}
            {triggering ? "Iniciando…" : isRunning ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          {triggerError && (
            <p className="text-xs text-red-600 dark:text-red-400">{triggerError}</p>
          )}
        </div>
      </div>

      {/* KPI summary row — last completed run */}
      {runsLoading && !runs.length ? (
        <KpiSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="kpi-row">
          <Card className="p-4">
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">
              Última sincronización
            </p>
            <p className="mt-1 text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong truncate">
              {lastRun ? formatRelativeTime(lastRun.started_at) : "—"}
            </p>
            {lastRun && (
              <p className="mt-0.5 text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                {new Date(lastRun.started_at).toLocaleDateString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">Duración</p>
            <p className="mt-1 text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              {lastRun ? formatDuration(lastRun.duration_ms) : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">
              Filas sincronizadas
            </p>
            <p className="mt-1 text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              {lastRun ? formatNumber(lastRun.total_rows_synced) : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">
              Tasa de éxito (últ. 30)
            </p>
            <p className="mt-1 text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              {statsLoading ? "..." : (successRateStr ?? "—")}
            </p>
          </Card>
        </div>
      )}

      {/* Errors */}
      {runsError && (
        <ErrorDisplay error={runsError} onRetry={() => fetchRuns(page)} />
      )}
      {statsError && (
        <ErrorDisplay error={statsError} onRetry={fetchStats} />
      )}

      {/* Evolution charts */}
      {statsLoading ? (
        <ChartSkeleton />
      ) : stats ? (
        <EvolutionCharts stats={stats} />
      ) : null}

      {/* Run list */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Historial de ejecuciones
        </h2>
        <RunList
          runs={runs}
          total={total}
          page={page}
          perPage={PER_PAGE}
          loading={runsLoading}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  );
}
