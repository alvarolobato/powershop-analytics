"use client";

import { Card, LineChart, AreaChart, BarChart, DonutChart } from "@tremor/react";

// ─── Types (matching /api/etl/stats response) ───────────────────────────────────────────

export interface DurationTrendPoint {
  started_at: string;
  duration_ms: number | null;
  status: string;
}

export interface RowsTrendPoint {
  started_at: string;
  total_rows_synced: number | null;
}

export interface TableDuration {
  table_name: string;
  avg_duration_ms: number;
  last_duration_ms: number | null;
}

export interface SuccessRate {
  total: number;
  success: number;
  partial: number;
  failed: number;
}

export interface EtlStatsData {
  duration_trend: DurationTrendPoint[];
  rows_trend: RowsTrendPoint[];
  table_durations: TableDuration[];
  success_rate: SuccessRate;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Empty state placeholder ───────────────────────────────────────────────────────────

function EmptyChart({ title }: { title: string }) {
  return (
    <Card className="p-4">
      <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
        {title}
      </h3>
      <p className="py-8 text-center text-sm text-tremor-content dark:text-dark-tremor-content">
        Sin datos disponibles
      </p>
    </Card>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────────────────

interface EvolutionChartsProps {
  stats: EtlStatsData;
}

export function EvolutionCharts({ stats }: EvolutionChartsProps) {
  // 1. Duration trend — X=date, Y=duration in minutes
  const durationData = stats.duration_trend
    .filter((p) => p.duration_ms !== null)
    .map((p) => ({
      Fecha: formatShortDate(p.started_at),
      "Duración (min)": Math.round((p.duration_ms ?? 0) / 60000),
    }));

  // 2. Rows synced per run — exclude runs where total_rows_synced is null
  const rowsData = stats.rows_trend
    .filter((p) => p.total_rows_synced !== null)
    .map((p) => ({
      Fecha: formatShortDate(p.started_at),
      Filas: p.total_rows_synced as number,
    }));

  // 3. Top 10 slowest tables by average duration (explicit sort guards against unsorted API responses)
  const topTables = [...stats.table_durations]
    .sort((a, b) => b.avg_duration_ms - a.avg_duration_ms)
    .slice(0, 10)
    .map((t) => ({
      Tabla: t.table_name.replace(/^ps_/, ""),
      "Duración media (seg)": Math.round(t.avg_duration_ms / 1000),
    }));

  // 4. Run outcomes donut
  const outcomeData = [
    { name: "Exitoso", value: stats.success_rate.success },
    { name: "Parcial", value: stats.success_rate.partial },
    { name: "Error", value: stats.success_rate.failed },
  ].filter((d) => d.value > 0);

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      data-testid="evolution-charts"
    >
      {/* Chart 1: Duration trend */}
      {durationData.length === 0 ? (
        <EmptyChart title="Tendencia de duración (últimas 30 ejecuciones)" />
      ) : (
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
            Tendencia de duración (últimas 30 ejecuciones)
          </h3>
          <LineChart
            data={durationData}
            index="Fecha"
            categories={["Duración (min)"]}
            colors={["indigo"]}
            valueFormatter={(v: number) => `${v}m`}
            yAxisWidth={55}
            showLegend={false}
          />
        </Card>
      )}

      {/* Chart 2: Rows synced per run */}
      {rowsData.length === 0 ? (
        <EmptyChart title="Filas sincronizadas por ejecución" />
      ) : (
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
            Filas sincronizadas por ejecución
          </h3>
          <AreaChart
            data={rowsData}
            index="Fecha"
            categories={["Filas"]}
            colors={["cyan"]}
            valueFormatter={(v: number) => v.toLocaleString("es-ES")}
            yAxisWidth={65}
            showLegend={false}
          />
        </Card>
      )}

      {/* Chart 3: Top 10 slowest tables */}
      {topTables.length === 0 ? (
        <EmptyChart title="Top 10 tablas más lentas (duración media)" />
      ) : (
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
            Top 10 tablas más lentas (duración media)
          </h3>
          <BarChart
            data={topTables}
            index="Tabla"
            categories={["Duración media (seg)"]}
            colors={["amber"]}
            valueFormatter={(v: number) => v + "s"}
            yAxisWidth={55}
            showLegend={false}
          />
        </Card>
      )}

      {/* Chart 4: Run outcomes donut */}
      {outcomeData.length === 0 || stats.success_rate.total === 0 ? (
        <EmptyChart title="Resultados de ejecuciones (últimas 30)" />
      ) : (
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
            Resultados de ejecuciones (últimas 30)
          </h3>
          <DonutChart
            data={outcomeData}
            category="value"
            index="name"
            colors={["emerald", "amber", "red"]}
            showLabel
            showAnimation
            valueFormatter={(v: number) => String(v)}
          />
        </Card>
      )}
    </div>
  );
}
