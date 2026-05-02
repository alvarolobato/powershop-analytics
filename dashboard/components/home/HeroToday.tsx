"use client";

import type { HomeViewModel } from "@/lib/home-types";
import { Delta } from "./Delta";
import { fmtEUR0 } from "@/components/widgets/format";

interface HeroTodayProps {
  hero: HomeViewModel["hero"];
  asOf: string;
}

function statusConfig(status: HomeViewModel["hero"]["status"]) {
  if (status === "on-pace")
    return { color: "var(--up)", bg: "var(--up-bg)", label: "En ritmo previsto" };
  if (status === "above")
    return {
      color: "var(--accent-2)",
      bg: "rgba(34,211,238,0.12)",
      label: "Por encima del previsto",
    };
  return { color: "var(--down)", bg: "var(--down-bg)", label: "Por debajo del previsto" };
}

/**
 * Builds an SVG path from an array of [x, y] points (skipping nulls).
 * Returns empty string if no points.
 */
function buildPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

export function HeroToday({ hero, asOf }: HeroTodayProps) {
  const { color: statusColor, bg: statusBg, label: statusLabel } = statusConfig(hero.status);

  // Chart geometry
  const W = 600;
  const H = 120;
  const padT = 8;
  const padB = 18;

  const allYesterday = hero.hourlyYesterday.filter((v) => typeof v === "number" && v > 0);
  const maxVal =
    Math.max(
      ...(allYesterday.length > 0 ? allYesterday : [0]),
      ...hero.hourly.filter((v): v is number => v !== null),
      hero.forecastEOD > 0 ? hero.forecastEOD : 0
    ) * 1.1 || 1;

  const xForHour = (hour: number) => (hour / 23) * W;
  const yForVal = (val: number) =>
    padT + (1 - val / maxVal) * (H - padT - padB);

  // Last-year line
  const lyPts: [number, number][] = hero.hourlyYesterday.map((v, i) => [
    xForHour(i),
    yForVal(v),
  ]);
  const lyPath = buildPath(lyPts);

  // Today line (only non-null points)
  const todayPts: [number, number][] = hero.hourly
    .map((v, i): [number, number] | null =>
      v !== null ? [xForHour(i), yForVal(v)] : null
    )
    .filter((p): p is [number, number] => p !== null);
  const todayPath = buildPath(todayPts);
  const todayArea =
    todayPts.length > 0
      ? `${todayPath} L${todayPts[todayPts.length - 1][0]},${H - padB} L${todayPts[0][0]},${H - padB} Z`
      : "";
  const lastPt = todayPts.length > 0 ? todayPts[todayPts.length - 1] : null;

  // Current hour index (last non-null hour, or -1 if none)
  const currentHourIdx: number = hero.hourly.reduce<number>(
    (acc, v, i) => (v !== null ? i : acc),
    -1
  );

  // Forecast line
  const forecastEnd: [number, number] | null =
    hero.forecastEOD > 0 && lastPt
      ? [xForHour(23), yForVal(hero.forecastEOD)]
      : null;

  // Hour ticks
  const hourTicks = [0, 4, 8, 12, 16, 20, 23];

  // Pre-9am state: no data
  const isPreOpen = currentHourIdx < 0 || currentHourIdx < 8;

  return (
    <div
      style={{
        margin: "0 24px 18px",
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 24,
        display: "grid",
        gridTemplateColumns: "minmax(280px,1fr) 2.4fr",
        gap: 32,
        alignItems: "stretch",
      }}
      data-testid="hero-today"
    >
      {/* ── Left: number block ── */}
      <div
        style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
      >
        <div>
          {/* Micro header */}
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
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
              Ventas hoy
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--up)",
                animation: "pulse-dot 2s ease-in-out infinite",
                display: "inline-block",
              }}
              aria-hidden="true"
            />
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 10,
                color: "var(--fg-subtle)",
              }}
            >
              EN VIVO
            </span>
          </div>

          {/* Hero number */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: "var(--fg)",
              fontVariantNumeric: "tabular-nums",
            }}
            data-testid="hero-value"
          >
            {isPreOpen ? "0 €" : fmtEUR0(hero.todayValue)}
          </div>

          {/* Status badge */}
          <div
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 4,
              background: isPreOpen ? "var(--bg-3)" : statusBg,
              color: isPreOpen ? "var(--fg-muted)" : statusColor,
              fontSize: 12,
              fontWeight: 600,
            }}
            data-testid="hero-status"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isPreOpen ? "var(--fg-muted)" : statusColor,
              }}
              aria-hidden="true"
            />
            {isPreOpen ? "Sin actividad" : statusLabel}
          </div>
        </div>

        {/* Delta pair */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginTop: 24,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 10,
                color: "var(--fg-subtle)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 4,
              }}
            >
              VS AYER
            </div>
            <Delta value={isPreOpen ? null : hero.vsYesterday} size="lg" />
            <div
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-subtle)",
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtEUR0(hero.yesterday)}
            </div>
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 10,
                color: "var(--fg-subtle)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 4,
              }}
            >
              VS AÑO PASADO
            </div>
            <Delta
              value={
                hero.vsLY !== undefined && hero.vsLY !== null ? hero.vsLY : null
              }
              size="lg"
            />
            <div
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11,
                color: "var(--fg-subtle)",
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtEUR0(hero.lastYear)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: hourly chart ── */}
      <div style={{ position: "relative" }}>
        {/* Chart header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 4,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains, monospace)",
              fontSize: 10,
              color: "var(--fg-subtle)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Ventas por hora · proyección cierre
          </span>
          <div style={{ display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
            <LegendItem
              lineStyle="solid"
              color="var(--accent)"
              label="Hoy"
            />
            <LegendItem
              lineStyle="dashed"
              color="var(--accent-2)"
              label="Mismo lunes 2025"
            />
            <LegendItem
              lineStyle="dotted"
              color="var(--fg-muted)"
              label="Proyección"
            />
          </div>
        </div>

        {/* SVG chart */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 160, display: "block" }}
          role="img"
          aria-label="Gráfico de ventas por hora con proyección de cierre"
        >
          <title>Ventas por hora con proyección de cierre</title>
          <defs>
            <linearGradient id="todayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Gridlines */}
          {[0, 0.5, 1].map((t) => (
            <line
              key={t}
              x1={0}
              y1={padT + t * (H - padT - padB)}
              x2={W}
              y2={padT + t * (H - padT - padB)}
              stroke="var(--grid)"
              strokeWidth="1"
            />
          ))}

          {/* Last year line */}
          {lyPath && (
            <path
              d={lyPath}
              fill="none"
              stroke="var(--accent-2)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.65"
            />
          )}

          {/* Today area + line */}
          {todayArea && <path d={todayArea} fill="url(#todayGrad)" />}
          {todayPath && (
            <path
              d={todayPath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Forecast line */}
          {lastPt && forecastEnd && !isPreOpen && (
            <line
              x1={lastPt[0]}
              y1={lastPt[1]}
              x2={forecastEnd[0]}
              y2={forecastEnd[1]}
              stroke="var(--fg-muted)"
              strokeWidth="1.5"
              strokeDasharray="2 4"
              opacity="0.6"
            />
          )}

          {/* Forecast end dot */}
          {forecastEnd && !isPreOpen && (
            <circle
              cx={forecastEnd[0]}
              cy={forecastEnd[1]}
              r="3"
              fill="var(--fg-muted)"
              stroke="var(--bg-1)"
              strokeWidth="1.5"
            />
          )}

          {/* "Ahora" marker */}
          {lastPt && !isPreOpen && (
            <>
              <line
                x1={lastPt[0]}
                y1={padT}
                x2={lastPt[0]}
                y2={H - padB}
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.4"
              />
              <circle
                cx={lastPt[0]}
                cy={lastPt[1]}
                r="5"
                fill="var(--accent)"
                stroke="var(--bg-1)"
                strokeWidth="2"
                data-testid="ahora-marker"
              />
              <text
                x={lastPt[0]}
                y={padT - 1}
                textAnchor="middle"
                fontSize="9"
                fill="var(--accent)"
                fontFamily="JetBrains Mono, monospace"
              >
                AHORA
              </text>
            </>
          )}

          {/* Hour ticks */}
          {hourTicks.map((hr) => (
            <text
              key={hr}
              x={xForHour(hr)}
              y={H - 4}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-subtle)"
              fontFamily="JetBrains Mono, monospace"
            >
              {String(hr).padStart(2, "0")}:00
            </text>
          ))}
        </svg>

        {/* Chart footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: 11,
          }}
        >
          <span
            style={{
              color: "var(--fg-subtle)",
              fontFamily: "var(--font-jetbrains, monospace)",
            }}
          >
            {asOf} actual
          </span>
          {!isPreOpen && (
            <span style={{ color: "var(--fg-muted)" }}>
              Proyección cierre{" "}
              <span
                style={{
                  fontFamily: "var(--font-jetbrains, monospace)",
                  color: "var(--fg)",
                  fontWeight: 600,
                  marginLeft: 4,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtEUR0(hero.forecastEOD)}
              </span>
              <span style={{ marginLeft: 8 }}>
                <Delta value={hero.todayPace} size="sm" />
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Legend item ─────────────────────────────────────────────────────────────

interface LegendItemProps {
  lineStyle: "solid" | "dashed" | "dotted";
  color: string;
  label: string;
}

function LegendItem({ lineStyle, color, label }: LegendItemProps) {
  const borderTop =
    lineStyle === "dashed"
      ? `1.5px dashed ${color}`
      : lineStyle === "dotted"
        ? `1.5px dotted ${color}`
        : undefined;
  const background = lineStyle === "solid" ? color : undefined;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--fg-muted)",
        fontSize: 11,
      }}
    >
      <span
        style={{
          width: 16,
          height: lineStyle === "solid" ? 2 : 0,
          background,
          borderTop,
          borderRadius: lineStyle === "solid" ? 2 : undefined,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
