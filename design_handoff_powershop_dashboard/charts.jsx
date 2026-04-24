// Chart primitives — custom SVG, no libraries. Each chart uses semantic color
// and breathes properly with hover interactions.

const { useState, useMemo, useRef, useEffect } = React;

// ---------- Formatters ----------
const fmtEUR = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
const fmtInt = (n) => new Intl.NumberFormat("es-ES").format(Math.round(n));
const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtDelta = (n) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

window.fmt = { fmtEUR, fmtInt, fmtPct, fmtDelta };

// ---------- Sparkline ----------
function Sparkline({ data, width = 100, height = 28, color = "currentColor", fill = false }) {
  const { path, area } = useMemo(() => {
    if (!data || data.length === 0) return { path: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const dx = width / (data.length - 1);
    const pts = data.map((v, i) => [i * dx, height - ((v - min) / range) * (height - 4) - 2]);
    const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
    const area = `${path} L${width},${height} L0,${height} Z`;
    return { path, area };
  }, [data, width, height]);
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={color} opacity="0.15" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- Comparison bar chart ----------
function CompareBarChart({ data, height = 240 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...data.map((d) => Math.max(d.actual || 0, d.previous || d.value || 0))) * 1.1;
  const bw = 100 / data.length;
  const barW = bw * 0.38;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none"
           style={{ width: "100%", height, display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1="0" y1={height * t} x2="100" y2={height * t}
                stroke="var(--grid)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          const x = i * bw + bw * 0.08;
          const hActual = ((d.actual || d.value) / max) * height;
          const hPrev = d.previous ? (d.previous / max) * height : 0;
          return (
            <g key={i} onMouseEnter={() => setHover({ i, ...d })} onMouseLeave={() => setHover(null)}>
              <rect x={i * bw} y="0" width={bw} height={height} fill="transparent" />
              {d.previous !== undefined && (
                <rect x={x} y={height - hPrev} width={barW} height={hPrev}
                      fill="var(--accent-2)" opacity="0.55" rx="1" />
              )}
              <rect x={x + barW + bw * 0.04} y={height - hActual} width={barW} height={hActual}
                    fill={d.flag === "top" ? "var(--up)" : d.flag === "low" ? "var(--down)" : "var(--accent)"} rx="1" />
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--fg-subtle)", fontFamily: "JetBrains Mono, monospace" }}>
        {data.filter((_, i) => i % Math.ceil(data.length / 12) === 0).map((d, i) => (
          <span key={i}>{d.store || d.date || d.label}</span>
        ))}
      </div>
      {hover && (
        <div style={{
          position: "absolute", top: 8, right: 8, background: "var(--bg-2)",
          border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px",
          fontSize: 11, pointerEvents: "none", minWidth: 140
        }}>
          <div style={{ color: "var(--fg-muted)", fontSize: 10, marginBottom: 4 }}>
            {hover.store || hover.date || hover.label}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "var(--accent)" }}>● Actual</span>
            <span className="mono">{fmtInt(hover.actual || hover.value)}</span>
          </div>
          {hover.previous !== undefined && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
              <span style={{ color: "var(--accent-2)", opacity: 0.7 }}>● Anterior</span>
              <span className="mono">{fmtInt(hover.previous)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Horizontal ranked bars ----------
function RankedBars({ data, max, format = "int", accent = "var(--accent)", showValue = true }) {
  const m = max || Math.max(...data.map((d) => d.value || d.pct));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map((d, i) => {
        const v = d.value ?? d.pct;
        const pct = (v / m) * 100;
        const color = d.flag === "low" ? "var(--down)" : d.flag === "top" ? "var(--up)" : accent;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", alignItems: "center", gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{d.store || d.label}</span>
            <div style={{ height: 18, background: "var(--bg-2)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
              <div style={{
                width: `${pct}%`, height: "100%", background: color, borderRadius: 3,
                transition: "width 0.5s cubic-bezier(.2,.8,.2,1)",
              }} />
            </div>
            {showValue && (
              <span className="mono num" style={{ fontSize: 11, color: "var(--fg)", minWidth: 60, textAlign: "right" }}>
                {format === "pct" ? `${v.toFixed(1)}%` : fmtInt(v)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Line chart with comparison ----------
function LineChart({ data, height = 240 }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const w = 800;
  const h = height;
  const pad = { t: 10, r: 12, b: 24, l: 44 };
  const max = Math.max(...data.map((d) => Math.max(d.actual, d.previous || 0))) * 1.1;
  const min = 0;
  const xStep = (w - pad.l - pad.r) / (data.length - 1);
  const yScale = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const actualPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${pad.l + i * xStep},${yScale(d.actual)}`).join(" ");
  const prevPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${pad.l + i * xStep},${yScale(d.previous)}`).join(" ");
  const actualArea = `${actualPath} L${pad.l + (data.length - 1) * xStep},${h - pad.b} L${pad.l},${h - pad.b} Z`;

  const handleMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round((x - pad.l) / xStep)));
    setHover({ idx, ...data[idx] });
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * (1 - t));

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height, display: "block" }}
           onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={yScale(t)} x2={w - pad.r} y2={yScale(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.l - 6} y={yScale(t) + 3} textAnchor="end" fontSize="10"
                  fill="var(--fg-subtle)" fontFamily="JetBrains Mono">
              {t >= 1000 ? `${(t / 1000).toFixed(0)}k` : t.toFixed(0)}
            </text>
          </g>
        ))}
        <path d={actualArea} fill="url(#lineGrad)" />
        <path d={prevPath} fill="none" stroke="var(--accent-2)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
        <path d={actualPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {hover && (
          <>
            <line x1={pad.l + hover.idx * xStep} y1={pad.t} x2={pad.l + hover.idx * xStep} y2={h - pad.b}
                  stroke="var(--fg-muted)" strokeDasharray="2 2" strokeWidth="1" />
            <circle cx={pad.l + hover.idx * xStep} cy={yScale(hover.actual)} r="4" fill="var(--accent)" stroke="var(--bg-1)" strokeWidth="2" />
            <circle cx={pad.l + hover.idx * xStep} cy={yScale(hover.previous)} r="3" fill="var(--accent-2)" stroke="var(--bg-1)" strokeWidth="2" />
          </>
        )}
        {data.map((d, i) => i % Math.ceil(data.length / 6) === 0 && (
          <text key={i} x={pad.l + i * xStep} y={h - 6} textAnchor="middle" fontSize="10"
                fill="var(--fg-subtle)" fontFamily="JetBrains Mono">{d.date}</text>
        ))}
      </svg>
      {hover && (
        <div style={{
          position: "absolute", top: 4, right: 12, background: "var(--bg-2)",
          border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 12px",
          fontSize: 11, minWidth: 150
        }}>
          <div style={{ color: "var(--fg-muted)", fontSize: 10, marginBottom: 4 }}>{hover.date}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "var(--accent)" }}>● Actual</span>
            <span className="mono num">{fmtEUR(hover.actual)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
            <span style={{ color: "var(--accent-2)", opacity: 0.7 }}>● Anterior</span>
            <span className="mono num">{fmtEUR(hover.previous)}</span>
          </div>
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)", fontSize: 10 }}>
            <span style={{ color: hover.actual < hover.previous ? "var(--down)" : "var(--up)" }}>
              {fmtDelta((hover.actual - hover.previous) / hover.previous)}
            </span>
            <span style={{ color: "var(--fg-subtle)", marginLeft: 6 }}>vs período anterior</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Donut ----------
function Donut({ data, size = 180, primary }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const stroke = 22;

  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const dash = frac * 2 * Math.PI * (r - stroke / 2);
    const arc = { ...d, i, offset, dash, color: d.color };
    offset += dash;
    return arc;
  });
  const circ = 2 * Math.PI * (r - stroke / 2);

  const display = hover !== null ? data[hover] : primary;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r - stroke / 2} fill="none" stroke="var(--bg-2)" strokeWidth={stroke} />
        {arcs.map((a) => (
          <circle key={a.i} cx={cx} cy={cy} r={r - stroke / 2} fill="none"
                  stroke={a.color} strokeWidth={hover === a.i ? stroke + 3 : stroke}
                  strokeDasharray={`${a.dash} ${circ}`} strokeDashoffset={-a.offset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{ transition: "stroke-width 0.2s", cursor: "pointer" }}
                  onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--fg)" className="num">
          {display ? `${display.value.toFixed(1)}%` : `${total.toFixed(0)}%`}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--fg-subtle)"
              fontFamily="JetBrains Mono" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {display ? display.label : "Total"}
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {data.map((d, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", alignItems: "center", gap: 10, cursor: "pointer",
                        opacity: hover !== null && hover !== i ? 0.5 : 1, transition: "opacity 0.2s" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
            <span style={{ fontSize: 12, color: "var(--fg)" }}>{d.label}</span>
            <span className="mono num" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{d.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

window.Charts = { Sparkline, CompareBarChart, RankedBars, LineChart, Donut };
