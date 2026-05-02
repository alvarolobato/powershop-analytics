"use client";

import type { HomeViewModel } from "@/lib/home-types";
import { SectionHeader } from "./SectionHeader";

interface DailyTrendChartProps {
  dailyTrend: HomeViewModel["dailyTrend"];
  /** ISO date or display string ("lun 04 may · 11:42") for the chart's "as of" moment.
   *  Used to derive the legend labels ("Mayo 2026" / "Mayo 2025"). */
  asOf?: string;
}

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function deriveLegendLabels(asOf?: string): { current: string; previous: string } {
  // Try to parse asOf as a Date first; fall back to current real time.
  let date: Date;
  if (asOf) {
    const maybe = new Date(asOf);
    date = isNaN(maybe.getTime()) ? new Date() : maybe;
  } else {
    date = new Date();
  }
  const month = MONTH_NAMES_ES[date.getMonth()] ?? "";
  const year = date.getFullYear();
  return { current: `${month} ${year}`, previous: `${month} ${year - 1}` };
}

export function DailyTrendChart({ dailyTrend, asOf }: DailyTrendChartProps) {
  const { current: currentLabel, previous: previousLabel } = deriveLegendLabels(asOf);

  const W = 1000;
  const H = 220;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 24;

  const allValues = dailyTrend.flatMap((d) =>
    [d.actual, d.ly].filter((v): v is number => v !== null && v !== undefined)
  );
  const maxVal = allValues.length > 0 ? Math.max(...allValues) * 1.1 : 1;

  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const xStep = dailyTrend.length > 1 ? chartW / (dailyTrend.length - 1) : chartW;
  const xForIdx = (i: number) => padL + i * xStep;
  const yForVal = (v: number) => padT + (1 - v / maxVal) * chartH;

  // LY path
  const lyPts = dailyTrend.map((d, i) => [xForIdx(i), yForVal(d.ly)] as [number, number]);
  const lyPath = lyPts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  // Actual path (only non-null days)
  const actualPts = dailyTrend
    .map((d, i): [number, number, number] | null =>
      d.actual !== null && d.actual !== undefined
        ? [xForIdx(i), yForVal(d.actual), d.day]
        : null
    )
    .filter((p): p is [number, number, number] => p !== null);
  const actualPath = actualPts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const actualArea =
    actualPts.length > 0
      ? `${actualPath} L${actualPts[actualPts.length - 1][0].toFixed(1)},${H - padB} L${actualPts[0][0].toFixed(1)},${H - padB} Z`
      : "";

  // Grid ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    val: maxVal * (1 - t),
    y: yForVal(maxVal * (1 - t)),
  }));

  // X axis ticks every 5 days
  const xTicks = dailyTrend.filter((_, i) => i % 5 === 0);

  const lastActual = actualPts.length > 0 ? actualPts[actualPts.length - 1] : null;

  return (
    <div
      style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 10 }}
      data-testid="daily-trend-chart"
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <SectionHeader
          title="Tendencia mes en curso"
          subtitle="Ventas diarias — actual vs mismo mes 2025"
        />
        <div style={{ display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-muted)" }}
          >
            <span
              style={{ width: 16, height: 2, background: "var(--accent)", borderRadius: 2 }}
              aria-hidden="true"
            />
            {currentLabel}
          </span>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-muted)" }}
          >
            <span
              style={{ width: 16, height: 0, borderTop: "1.5px dashed var(--accent-2)" }}
              aria-hidden="true"
            />
            {previousLabel}
          </span>
        </div>
      </div>

      {/* Chart body */}
      <div style={{ padding: 16 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: 220, display: "block" }}
          role="img"
          aria-label="Tendencia de ventas diarias: mes actual vs mismo mes del año anterior"
        >
          <title>Tendencia de ventas diarias</title>
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines with labels */}
          {yTicks.map(({ val, y }, i) => (
            <g key={i}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--fg-subtle)"
                fontFamily="JetBrains Mono, monospace"
              >
                {(val / 1000).toFixed(0)}k€
              </text>
            </g>
          ))}

          {/* LY line */}
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

          {/* Actual area + line */}
          {actualArea && <path d={actualArea} fill="url(#trendGrad)" />}
          {actualPath && (
            <path
              d={actualPath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* "HOY · DÍA N" marker */}
          {lastActual && (
            <g>
              <circle
                cx={lastActual[0]}
                cy={lastActual[1]}
                r="4.5"
                fill="var(--accent)"
                stroke="var(--bg-1)"
                strokeWidth="2"
              />
              <line
                x1={lastActual[0]}
                y1={padT}
                x2={lastActual[0]}
                y2={H - padB}
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.35"
              />
              <text
                x={lastActual[0]}
                y={padT - 2}
                textAnchor="middle"
                fontSize="9"
                fill="var(--accent)"
                fontFamily="JetBrains Mono, monospace"
              >
                HOY · DÍA {lastActual[2]}
              </text>
            </g>
          )}

          {/* X ticks every 5 days */}
          {xTicks.map((d, idx) => {
            const origIdx = dailyTrend.indexOf(d);
            return (
              <text
                key={idx}
                x={xForIdx(origIdx).toFixed(1)}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                fill="var(--fg-subtle)"
                fontFamily="JetBrains Mono, monospace"
              >
                {d.day}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
