"use client";

import { useState, useEffect } from "react";

interface SlowQuery {
  query: string;
  calls: number;
  mean_exec_time_ms: number;
  max_exec_time_ms: number;
  total_exec_time_ms: number;
  rows: number;
  cache_hit_ratio: number | null;
}

interface SlowQueriesData {
  queries: SlowQuery[];
  error?: string;
}

const fmtMs = (v: number) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(v);

const fmtInt = (v: number) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(v);

export default function AdminSlowQueriesPage() {
  const [data, setData] = useState<SlowQueriesData | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    void fetch("/api/admin/slow-queries")
      .then((r) => r.json())
      .then((d) => setData(d as SlowQueriesData))
      .catch((e) =>
        setData({ queries: [], error: e instanceof Error ? e.message : "Error" }),
      );
  }, []);

  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: "var(--fg)",
          margin: 0,
        }}
      >
        Consultas lentas (pg_stat_statements)
      </h1>

      {data?.error && (
        <p
          style={{
            borderRadius: 6,
            border: "1px solid var(--warn)",
            background: "var(--warn-bg, rgba(245,158,11,0.08))",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--warn)",
          }}
        >
          {data.error}
        </p>
      )}

      {!data && (
        <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>Cargando…</p>
      )}

      {data && (
        <div
          style={{
            overflowX: "auto",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg-2)" }}>
                {["Consulta", "Llamadas", "Media ms", "Máx ms", "Total ms", "Filas", "Cache %"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "9px 12px",
                        fontWeight: 500,
                        fontFamily: "var(--font-inter, sans-serif)",
                        fontSize: 11,
                        letterSpacing: "0.04em",
                        color: "var(--fg-subtle)",
                        textAlign: h === "Consulta" ? "left" : "right",
                        whiteSpace: "nowrap",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(data?.queries ?? []).map((q, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 1 ? "var(--bg-2)" : undefined,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <td
                    style={{
                      padding: "9px 12px",
                      maxWidth: 420,
                      verticalAlign: "top",
                    }}
                  >
                    <div
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                        WebkitLineClamp: expanded.has(i) ? undefined : 2,
                        overflow: expanded.has(i) ? "visible" : "hidden",
                        fontFamily: "var(--font-jetbrains, monospace)",
                        fontSize: 11,
                        color: "var(--fg)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {q.query}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleExpand(i)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        color: "var(--accent)",
                        padding: "2px 0",
                        fontFamily: "inherit",
                      }}
                    >
                      {expanded.has(i) ? "contraer" : "ver completa"}
                    </button>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtInt(q.calls)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMs(q.mean_exec_time_ms)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMs(q.max_exec_time_ms)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMs(q.total_exec_time_ms)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtInt(q.rows)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {q.cache_hit_ratio != null
                      ? `${(q.cache_hit_ratio * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
