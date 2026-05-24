"use client";

import type { HomeViewModel } from "@/lib/home-types";
import { Delta } from "./Delta";
import { HomeSparkline } from "./Sparkline";
import { SectionHeader } from "./SectionHeader";
import { fmtEUR0, fmtPct } from "@/components/widgets/format";

type Period = HomeViewModel["periods"][number];

interface PeriodCardProps {
  period: Period;
  format?: "eur" | "pct";
}

function PeriodCard({ period, format = "eur" }: PeriodCardProps) {
  const sparkColor = period.deltaPrev >= 0 ? "var(--up)" : "var(--down)";
  const yoyIsNull = period.deltaYoY === undefined || period.deltaYoY === null;
  const formattedValue = format === "pct" ? fmtPct(period.value) : fmtEUR0(period.value);

  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 168,
      }}
      data-testid={`period-card-${period.id}`}
    >
      {/* Label + sparkline */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span
          style={{
            fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 10,
            color: "var(--fg-subtle)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {period.label}
        </span>
        {period.spark && period.spark.length > 0 && (
          <HomeSparkline
            data={period.spark}
            color={sparkColor}
            width={70}
            height={20}
            label={`Tendencia ${period.label}`}
          />
        )}
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg)",
        }}
      >
        {formattedValue}
      </div>

      {/* Delta pair */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginTop: "auto",
          paddingTop: 8,
          borderTop: "1px dashed var(--border)",
        }}
      >
        <div>
          <Delta value={period.deltaPrev} size="sm" />
          <div
            style={{
              fontFamily: "var(--font-jetbrains, monospace)",
              fontSize: 10,
              color: "var(--fg-subtle)",
              marginTop: 3,
            }}
          >
            {period.prevLabel}
          </div>
        </div>
        <div>
          {yoyIsNull ? (
            <span
              style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 10,
                color: "var(--fg-subtle)",
              }}
            >
              —
            </span>
          ) : (
            <Delta value={period.deltaYoY} size="sm" />
          )}
          <div
            style={{
              fontFamily: "var(--font-jetbrains, monospace)",
              fontSize: 10,
              color: "var(--fg-subtle)",
              marginTop: 3,
            }}
          >
            vs año pasado
          </div>
        </div>
      </div>
    </div>
  );
}

interface PeriodGridProps {
  periods: HomeViewModel["periods"] | HomeViewModel["marginPeriods"];
  title?: string;
  subtitle?: string;
  format?: "eur" | "pct";
}

export function PeriodGrid({
  periods,
  title = "Comparativa por periodo",
  subtitle = "Ventas netas — actual vs periodo anterior y vs año pasado",
  format = "eur",
}: PeriodGridProps) {
  return (
    <section style={{ padding: "0 24px 18px" }} data-testid="period-grid">
      <SectionHeader title={title} subtitle={subtitle} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        {periods.map((p) => (
          <PeriodCard key={p.id} period={p as Period} format={format} />
        ))}
      </div>
    </section>
  );
}
