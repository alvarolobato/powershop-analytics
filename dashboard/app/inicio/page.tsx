"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { HomeViewModel } from "@/lib/home-types";
import { HeroToday } from "@/components/home/HeroToday";
import { PeriodGrid } from "@/components/home/PeriodGrid";
import { DailyTrendChart } from "@/components/home/DailyTrendChart";
import { AlertsPanel } from "@/components/home/AlertsPanel";
import { OperationsRow } from "@/components/home/OperationsRow";
import { TopStoresTable } from "@/components/home/TopStoresTable";
import { HealthFooter } from "@/components/home/HealthFooter";

// ---------------------------------------------------------------------------
// Skeleton shimmer card
// ---------------------------------------------------------------------------
function SkeletonBlock({ height = 120 }: { height?: number }) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        height,
        animation: "shimmer 1.5s ease-in-out infinite",
        backgroundImage:
          "linear-gradient(90deg, var(--bg-1) 25%, var(--bg-2) 50%, var(--bg-1) 75%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Page buttons style
// ---------------------------------------------------------------------------
const outlineBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--fg)",
  fontSize: 12,
  fontWeight: 500,
  padding: "0 12px",
  borderRadius: 6,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  fontFamily: "inherit",
};

const primaryBtn: React.CSSProperties = {
  ...outlineBtn,
  background: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#fff",
};

// ---------------------------------------------------------------------------
// InicioPage
// ---------------------------------------------------------------------------

export default function InicioPage() {
  const [data, setData] = useState<HomeViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/home");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HomeViewModel = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Check wholesale toggle via env-equivalent flag in response
  const showWholesale =
    !data || (data.opsWholesale && data.opsWholesale.length > 0);

  return (
    <div data-no-main-padding data-testid="inicio-page">
      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Page header                                                       */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "24px 24px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
        data-testid="page-header"
      >
        {/* Left block */}
        <div style={{ flex: "1 1 480px" }}>
          {/* Breadcrumb + chip */}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Inicio
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-subtle)",
              }}
            >
              /
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Estado del negocio
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                padding: "2px 6px",
                background: "var(--accent-soft)",
                color: "var(--accent)",
                borderRadius: 3,
                fontSize: 10,
                letterSpacing: "0.05em",
              }}
            >
              EN VIVO
            </span>
          </div>

          {/* H1 */}
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              fontFamily: "var(--font-inter, sans-serif)",
              color: "var(--fg)",
            }}
          >
            Hola
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
              {" "}— esto es lo que pasa hoy
            </span>
          </h1>

          {/* Description */}
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--fg-muted)",
              fontSize: 13,
              maxWidth: 680,
              lineHeight: 1.5,
            }}
          >
            Resumen del estado del negocio: ventas en curso, comparativa
            multi-periodo, tiendas top, alertas y operativa retail + mayorista.
          </p>
        </div>

        {/* Right block: timestamp + buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {data && (
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-subtle)",
                marginRight: 4,
              }}
            >
              {data.asOf}
            </span>
          )}
          <button
            type="button"
            style={outlineBtn}
            onClick={load}
            aria-label="Actualizar datos"
            data-testid="refresh-btn"
          >
            ⟳ Actualizar
          </button>
          <button
            type="button"
            style={{ ...outlineBtn, opacity: 0.5, cursor: "not-allowed" }}
            aria-label="Exportar datos (próximamente)"
            title="Próximamente"
            disabled
          >
            Exportar
          </button>
          <Link
            href="/dashboard/new"
            style={primaryBtn}
            aria-label="Crear nuevo panel"
          >
            + Nuevo panel
          </Link>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Loading skeleton                                                  */}
      {/* ──────────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <SkeletonBlock height={200} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} height={168} />)}
          </div>
          <SkeletonBlock height={120} />
          <SkeletonBlock height={300} />
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Error state                                                       */}
      {/* ──────────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div
          style={{
            margin: "24px",
            background: "var(--down-bg)",
            border: "1px solid var(--down)",
            borderRadius: 10,
            padding: 20,
            color: "var(--down)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Error al cargar los datos</div>
          <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>{error}</div>
          <button
            type="button"
            onClick={load}
            style={{ ...outlineBtn, marginTop: 12 }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Main content — all 8 regions                                     */}
      {/* ──────────────────────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <>
          {/* 2. Hero */}
          <HeroToday hero={data.hero} asOf={data.asOf} />

          {/* 3. Period grid */}
          <PeriodGrid periods={data.periods} />

          {/* 4. Trend + Alerts */}
          <section
            style={{
              padding: "0 24px 18px",
              display: "grid",
              gridTemplateColumns: "1.6fr 1fr",
              gap: 18,
            }}
            data-testid="trend-alerts-row"
          >
            <DailyTrendChart dailyTrend={data.dailyTrend} asOf={data.asOf} />
            <AlertsPanel alerts={data.alerts} />
          </section>

          {/* 5. Operations rows */}
          <section
            style={{ padding: "0 24px 18px", display: "grid", gap: 18 }}
            data-testid="operations-section"
          >
            <OperationsRow
              sectionLabel="RETAIL"
              title="Operativa retail"
              subtitle="hoy · vs ayer mismo tramo"
              metrics={data.opsRetail}
            />
            {showWholesale && data.opsWholesale.length > 0 && (
              <OperationsRow
                sectionLabel="MAYORISTA"
                title="Operativa mayorista"
                subtitle="mes en curso · vs mes anterior"
                metrics={data.opsWholesale}
              />
            )}
          </section>

          {/* 6. Top 10 tiendas */}
          <section style={{ padding: "0 24px 18px" }} data-testid="top-stores-section">
            <TopStoresTable stores={data.topStores} />
          </section>

          {/* 7. Health footer */}
          <HealthFooter health={data.health} />
        </>
      )}
    </div>
  );
}
