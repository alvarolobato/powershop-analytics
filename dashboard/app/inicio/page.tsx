"use client";

import { useState, useCallback } from "react";
import { DashboardRenderer } from "@/components/DashboardRenderer";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import { spec } from "@/lib/templates/inicio";

// ---------------------------------------------------------------------------
// InicioPage — read-only dashboard
//
// Renders the home template spec directly. No chat sidebar, no save flow,
// no date-picker (all date ranges are implicit via CURRENT_DATE in the SQL).
// ---------------------------------------------------------------------------

export default function InicioPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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

  return (
    <div data-no-main-padding>
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ padding: "24px 20px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          {/* Left: breadcrumb + title */}
          <div>
            {/* Breadcrumb */}
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
              <span>Inicio</span>
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

            {/* Title */}
            <h1
              style={{
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                margin: 0,
                fontFamily: "var(--font-inter, sans-serif)",
              }}
            >
              Estado del Negocio
            </h1>

            {/* Description */}
            <p
              style={{
                color: "var(--fg-muted)",
                margin: "8px 0 0",
                fontSize: 13,
                maxWidth: 680,
                lineHeight: 1.5,
              }}
            >
              {spec.description}
            </p>
          </div>

          {/* Right: refresh button */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={handleRefresh}
              style={outlineBtn}
              aria-label="Actualizar datos"
              data-testid="inicio-refresh-btn"
            >
              ⟳ Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Data freshness banner */}
      <DataFreshnessBanner />

      {/* Dashboard renderer — read-only, no chat, no save */}
      <DashboardRenderer
        spec={spec}
        refreshKey={refreshKey}
      />
    </div>
  );
}
