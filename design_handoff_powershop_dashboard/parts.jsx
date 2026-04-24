// UI atoms and molecules — header bar, KPI cards, panels, chat sidebar

const { useState: useStateP, useRef: useRefP, useEffect: useEffectP } = React;

// ---------- Brand mark ----------
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4 2 L14 2 L20 11 L10 22 L4 22 L4 13 L11 13 L8 9 L4 9 Z" fill="var(--accent)" />
      </svg>
      <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>Powershop</span>
      <span style={{ fontSize: 11, color: "var(--fg-subtle)", fontFamily: "JetBrains Mono", marginLeft: 2 }}>ANALYTICS</span>
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ onToggleChat, chatOpen, onToggleTweaks }) {
  return (
    <header style={{
      height: 56, borderBottom: "1px solid var(--border)", background: "var(--bg-1)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 20px", position: "sticky", top: 0, zIndex: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Logo />
        <nav style={{ display: "flex", gap: 2, fontSize: 13 }}>
          {["Dashboards", "Revisión", "Glosario"].map((t, i) => (
            <a key={t} href="#" style={{
              padding: "6px 12px", borderRadius: 6, color: i === 0 ? "var(--fg)" : "var(--fg-muted)",
              background: i === 0 ? "var(--bg-2)" : "transparent", textDecoration: "none", fontWeight: i === 0 ? 500 : 400,
            }}>{t}</a>
          ))}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-muted)" }}>
          <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--up)" }} />
          Datos al día · hace 12m
        </div>
        <button onClick={onToggleTweaks} style={btn("ghost")} title="Tweaks">⚙</button>
        <a href="#" title="Administración" style={{ ...btn("ghost"), textDecoration: "none" }}>Admin</a>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background: "var(--accent-soft)",
          color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600,
        }}>AL</div>
      </div>
    </header>
  );
}

function btn(kind = "outline") {
  const base = {
    height: 32, padding: "0 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
    cursor: "pointer", border: "1px solid transparent", transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: 6,
  };
  if (kind === "primary") return { ...base, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" };
  if (kind === "outline") return { ...base, background: "transparent", color: "var(--fg)", borderColor: "var(--border-strong)" };
  if (kind === "ghost") return { ...base, background: "transparent", color: "var(--fg-muted)" };
  return base;
}

// ---------- Page header: title + date picker + actions ----------
function PageHeader() {
  return (
    <div style={{ padding: "24px 20px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--fg-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            <span>Retail</span>
            <span style={{ color: "var(--fg-subtle)" }}>/</span>
            <span>Ventas</span>
            <span style={{ padding: "2px 6px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 3, fontSize: 10 }}>EN VIVO</span>
          </div>
          <h1 style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            Cuadro de Mandos <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>— Ventas Retail</span>
          </h1>
          <p style={{ color: "var(--fg-muted)", margin: "8px 0 0", fontSize: 13, maxWidth: 680, lineHeight: 1.5 }}>
            Panel para el responsable de ventas retail: KPIs y devoluciones, desglose por tienda,
            tendencia semanal, formas de pago, margen por tienda y top artículos.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <DateSwitcher />
          <button style={btn("outline")}>⟳ Actualizar</button>
          <button style={btn("outline")}>Exportar</button>
          <button style={btn("outline")}>Historial</button>
          <button style={btn("outline")}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function DateSwitcher() {
  const [open, setOpen] = useStateP(false);
  const [current, setCurrent] = useStateP("Mes actual");
  const [previous, setPrevious] = useStateP("Mes anterior");
  const [from, setFrom] = useStateP("2026-04-01");
  const [to, setTo] = useStateP("2026-04-23");
  const ref = useRefP(null);

  useEffectP(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const labelShort = current.toLowerCase().replace("actual", "").trim() || "abril de 2026";
  const displayLabel = current === "Mes actual" ? "abril de 2026"
    : current === "Hoy" ? "23 abr 2026"
    : current === "Semana actual" ? "sem 17 · abr 2026"
    : current === "Trimestre actual" ? "T2 2026"
    : current === "Año actual" ? "2026"
    : `${from} → ${to}`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 0,
        border: "1px solid var(--border-strong)", borderRadius: 6, overflow: "hidden",
        background: "var(--bg-1)", fontSize: 12,
      }}>
        <button style={arrowBtn()} aria-label="Anterior">‹</button>
        <button
          onClick={() => setOpen(!open)}
          style={{
            padding: "7px 12px", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none",
            color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--fg-muted)" }}>
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          <span>{displayLabel}</span>
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            background: "var(--accent-soft)", color: "var(--accent)",
            fontFamily: "JetBrains Mono",
          }}>vs</span>
        </button>
        <button style={arrowBtn()} aria-label="Siguiente">›</button>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
          width: 440, background: "var(--bg-1)", border: "1px solid var(--border-strong)",
          borderRadius: 10, boxShadow: "0 18px 40px -10px rgba(0,0,0,0.5)",
          fontSize: 12, overflow: "hidden",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: "14px 16px", borderRight: "1px solid var(--border)" }}>
              <div style={sectionLabel()}>Período actual</div>
              {["Hoy","Semana actual","Mes actual","Trimestre actual","Año actual"].map((p) => (
                <DateOption key={p} label={p} active={current === p} onClick={() => setCurrent(p)} />
              ))}
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div style={sectionLabel()}>Período anterior</div>
              {["Ayer","Semana anterior","Mes anterior","Trimestre anterior","Año anterior"].map((p) => (
                <DateOption key={p} label={p} active={previous === p} onClick={() => setPrevious(p)} />
              ))}
            </div>
          </div>
          <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
            <div style={sectionLabel()}>Rango personalizado</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <label style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                Desde
                <input type="date" value={from} onChange={(e)=>{ setFrom(e.target.value); setCurrent("Rango personalizado"); }} style={dateInput()} />
              </label>
              <label style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                Hasta
                <input type="date" value={to} onChange={(e)=>{ setTo(e.target.value); setCurrent("Rango personalizado"); }} style={dateInput()} />
              </label>
            </div>
            <button onClick={() => setOpen(false)} style={{
              marginTop: 10, width: "100%", height: 34, background: "var(--accent)",
              color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>Aplicar</button>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-2)" }}>
            <div style={sectionLabel()}>Período de comparación</div>
            <select value={previous} onChange={(e) => setPrevious(e.target.value)} style={{
              width: "100%", marginTop: 4, padding: "8px 10px", background: "var(--bg-1)",
              border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--fg)",
              fontSize: 12, fontFamily: "inherit",
            }}>
              <option>Período anterior</option>
              <option>Año anterior</option>
              <option>Sin comparación</option>
              <option>Personalizado</option>
            </select>
            <div style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 6, fontFamily: "JetBrains Mono" }}>
              1 mar — 31 mar 2026
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function arrowBtn() {
  return { padding: "7px 10px", border: "none", background: "transparent", color: "var(--fg-muted)", cursor: "pointer", fontSize: 14 };
}
function sectionLabel() {
  return {
    fontFamily: "JetBrains Mono", fontSize: 10, textTransform: "uppercase",
    letterSpacing: "0.1em", color: "var(--fg-subtle)", marginBottom: 6,
  };
}
function DateOption({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left", padding: "6px 8px",
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent)" : "var(--fg)",
      border: "none", borderRadius: 4, fontSize: 12, cursor: "pointer",
      fontFamily: "inherit", fontWeight: active ? 600 : 400,
    }}>{label}</button>
  );
}
function dateInput() {
  return {
    display: "block", width: "100%", marginTop: 4,
    padding: "7px 9px", background: "var(--bg-2)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--fg)", fontSize: 12, fontFamily: "inherit",
    colorScheme: "dark",
  };
}

// ---------- Filter strip ----------
function FilterStrip() {
  const [tienda, setTienda] = useStateP("Todas");
  const [familia, setFamilia] = useStateP("Todas");
  const [canal, setCanal] = useStateP("Retail");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg-1)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--fg-subtle)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 4 }}>Filtros</span>
      <Pill label="Tienda" value={tienda} options={["Todas","611","622","608","637","606"]} onChange={setTienda} />
      <Pill label="Familia" value={familia} options={["Todas","Americana","Pantalón","Vestido","Accesorios"]} onChange={setFamilia} />
      <Pill label="Canal" value={canal} options={["Retail","Mayorista","Ambos"]} onChange={setCanal} />
      <div style={{ flex: 1 }} />
      <button style={{ ...btn("ghost"), fontSize: 11 }}>Limpiar filtros</button>
    </div>
  );
}

function Pill({ label, value, options, onChange }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 10px 4px 12px", fontSize: 12,
    }}>
      <span style={{ color: "var(--fg-muted)", fontSize: 11 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        background: "transparent", border: "none", color: "var(--fg)", fontSize: 12, cursor: "pointer", outline: "none",
        fontFamily: "inherit", paddingRight: 14,
      }}>
        {options.map((o) => <option key={o} value={o} style={{ background: "var(--bg-1)" }}>{o}</option>)}
      </select>
    </label>
  );
}

// ---------- Panel container ----------
function Panel({ title, subtitle, right, children, span = 1, accent = false, padded = true, tall = false }) {
  return (
    <section style={{
      gridColumn: `span ${span}`, background: "var(--bg-1)",
      border: `1px solid ${accent ? "var(--accent)" : "var(--border)"}`,
      borderRadius: 10, overflow: "hidden",
      boxShadow: accent ? "0 0 0 3px var(--accent-soft)" : "none",
      display: "flex", flexDirection: "column",
      minHeight: tall ? 380 : undefined,
    }}>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</h3>
          {subtitle && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--fg-muted)" }}>{subtitle}</p>}
        </div>
        {right}
      </header>
      <div style={{ padding: padded ? "var(--pad)" : 0, flex: 1 }}>{children}</div>
    </section>
  );
}

// ---------- KPI card (3 styles) ----------
function KpiCard({ kpi, style = "editorial" }) {
  const { label, value, format, delta, comparison, spark, anomaly, inverted, warn } = kpi;
  const formatted = format === "eur" ? window.fmt.fmtEUR(value) : window.fmt.fmtInt(value);
  const deltaPos = inverted ? delta <= 0 : delta >= 0;
  const deltaColor = warn ? "var(--warn)" : deltaPos ? "var(--up)" : "var(--down)";
  const deltaBg = warn ? "var(--warn-bg)" : deltaPos ? "var(--up-bg)" : "var(--down-bg)";

  const formattedComp = format === "eur" ? window.fmt.fmtEUR(comparison) : window.fmt.fmtInt(comparison);

  if (style === "editorial") {
    return (
      <div style={kpiCardBase(anomaly)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {label}
            </div>
            {anomaly && (
              <div style={{ fontSize: 10, color: "var(--down)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--down)" }} />
                ANOMALÍA DETECTADA
              </div>
            )}
          </div>
          <span style={chip(deltaColor, deltaBg)}>
            {delta > 0 ? "▲" : "▼"} {window.fmt.fmtDelta(delta).replace("+","")}
          </span>
        </div>
        <div className="num" style={{
          fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em",
          marginTop: 12, lineHeight: 1.05,
        }}>
          {formatted}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--fg-subtle)" }}>
            vs <span className="num">{formattedComp}</span>
          </div>
          <div style={{ color: deltaColor }}>
            <window.Charts.Sparkline data={spark} width={90} height={24} fill />
          </div>
        </div>
      </div>
    );
  }

  if (style === "bold") {
    return (
      <div style={{ ...kpiCardBase(anomaly), background: anomaly ? "var(--down-bg)" : "var(--bg-1)" }}>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        <div className="num" style={{ fontSize: 42, fontWeight: 700, marginTop: 8, letterSpacing: "-0.03em", color: anomaly ? "var(--down)" : "var(--fg)" }}>{formatted}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={chip(deltaColor, deltaBg)}>{delta > 0 ? "▲" : "▼"} {window.fmt.fmtDelta(delta).replace("+","")}</span>
          <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>vs anterior</span>
        </div>
      </div>
    );
  }

  // minimal
  return (
    <div style={kpiCardBase(anomaly)}>
      <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>{label}</div>
      <div className="num" style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>{formatted}</div>
      <div style={{ fontSize: 11, color: deltaColor, marginTop: 2 }}>
        {delta > 0 ? "↑" : "↓"} {window.fmt.fmtDelta(delta).replace("+","")} ({formattedComp})
      </div>
    </div>
  );
}

function kpiCardBase(anomaly) {
  return {
    background: "var(--bg-1)",
    border: `1px solid ${anomaly ? "var(--down)" : "var(--border)"}`,
    borderRadius: 10, padding: "var(--kpi-pad)",
    position: "relative", overflow: "hidden",
    boxShadow: anomaly ? "0 0 0 3px var(--down-bg)" : "none",
    transition: "all 0.2s",
  };
}

function chip(color, bg) {
  return {
    fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4,
    color, background: bg, fontFamily: "JetBrains Mono",
    display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap",
  };
}

// ---------- Insights strip ----------
function InsightsStrip({ insights }) {
  const iconFor = (k) => k === "up" ? "▲" : k === "down" ? "▼" : "⚠";
  const colorFor = (k) => k === "up" ? "var(--up)" : k === "down" ? "var(--down)" : "var(--warn)";
  const bgFor = (k) => k === "up" ? "var(--up-bg)" : k === "down" ? "var(--down-bg)" : "var(--warn-bg)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${insights.length}, 1fr)`, gap: "var(--gap)" }}>
      {insights.map((ins, i) => (
        <div key={i} style={{
          background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
          display: "flex", gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: bgFor(ins.kind), color: colorFor(ins.kind),
            display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0, fontWeight: 700,
          }}>{iconFor(ins.kind)}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.005em" }}>{ins.title}</div>
            <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 3, lineHeight: 1.45 }}>{ins.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Top articles table with heat bars ----------
function toTitleCase(s) {
  if (!s) return s;
  const lowers = new Set(["de","la","el","y","en","con","c/","m/","del","los","las"]);
  return s.toLowerCase().split(/(\s+|\/)/).map((w, i) => {
    if (!w.trim() || w === "/") return w;
    if (i > 0 && lowers.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join("");
}
function ArticlesTable({ rows }) {
  const maxNet = Math.max(...rows.map((r) => r.net));
  const maxUnits = Math.max(...rows.map((r) => r.units));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "var(--fg-subtle)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
            <th style={th()}>Rank</th>
            <th style={th()}>Referencia</th>
            <th style={th()}>Descripción</th>
            <th style={th()}>Familia</th>
            <th style={{ ...th(), textAlign: "right" }}>Unidades</th>
            <th style={{ ...th(), textAlign: "right" }}>Ventas Netas</th>
            <th style={{ ...th(), textAlign: "right" }}>Margen %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ref} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={td()}>
                <span className="mono" style={{ color: "var(--fg-subtle)", fontSize: 11 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              </td>
              <td style={td()}>
                <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>{r.ref}</span>
              </td>
              <td style={td()}>{toTitleCase(r.desc)}</td>
              <td style={td()}>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--bg-2)", color: "var(--fg-muted)", fontFamily: "JetBrains Mono" }}>{toTitleCase(r.family)}</span>
              </td>
              <td style={{ ...td(), textAlign: "right" }}>
                <HeatCell value={r.units} max={maxUnits} format="int" color="var(--accent-2)" />
              </td>
              <td style={{ ...td(), textAlign: "right" }}>
                <HeatCell value={r.net} max={maxNet} format="eur" color="var(--accent)" />
              </td>
              <td style={{ ...td(), textAlign: "right" }}>
                <span className="num mono" style={{ color: r.margin > 60 ? "var(--up)" : r.margin > 50 ? "var(--fg)" : "var(--warn)" }}>
                  {r.margin.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatCell({ value, max, format, color }) {
  const pct = (value / max) * 100;
  const display = format === "eur" ? window.fmt.fmtEUR(value) : window.fmt.fmtInt(value);
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end", minWidth: 140 }}>
      <div style={{
        position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
        width: `${pct}%`, maxWidth: 80, height: 14, background: color, opacity: 0.15, borderRadius: 2, zIndex: 0,
      }} />
      <span className="num mono" style={{ position: "relative", zIndex: 1 }}>{display}</span>
    </div>
  );
}

const th = () => ({ textAlign: "left", padding: "10px 12px", fontWeight: 500, borderBottom: "1px solid var(--border)" });
const td = () => ({ padding: "10px 12px", color: "var(--fg)" });

// ---------- LogBlock: shows LLM conversation logs (streaming or collapsed) ----------
function LogBlock({ lines, collapsed, onToggle, streaming }) {
  const iconFor = (k) =>
    k === "tool"   ? "⌬" :
    k === "reason" ? "✦" :
    k === "done"   ? "✓" : "·";
  const colorFor = (k) =>
    k === "tool"   ? "var(--accent-2)" :
    k === "reason" ? "var(--accent)"   :
    k === "done"   ? "var(--up)"       : "var(--fg-subtle)";

  // Streaming: fixed expanded, no toggle, subtle pulse on last line
  if (streaming) {
    return (
      <div style={{
        maxWidth: "86%", width: "100%", background: "var(--bg-2)",
        border: "1px dashed var(--border-strong)", borderRadius: 8,
        padding: "8px 10px", fontFamily: "JetBrains Mono", fontSize: 10.5,
        color: "var(--fg-muted)", display: "flex", flexDirection: "column", gap: 3,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--fg-subtle)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
          <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />
          Procesando · {lines.length} paso{lines.length !== 1 ? "s" : ""}
        </div>
        {lines.map((ln, i) => (
          <LogLine key={i} ln={ln} iconFor={iconFor} colorFor={colorFor} last={i === lines.length - 1} />
        ))}
      </div>
    );
  }

  // Post-delivery: collapsed by default, click to expand
  return (
    <div style={{ maxWidth: "86%", width: "100%" }}>
      <button onClick={onToggle} style={{
        background: "transparent", border: "none", padding: "2px 0",
        color: "var(--fg-subtle)", fontFamily: "JetBrains Mono", fontSize: 10,
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
        textTransform: "uppercase", letterSpacing: "0.08em",
      }}>
        <span style={{ transition: "transform 0.15s", display: "inline-block", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}>▸</span>
        {collapsed ? `Ver logs (${lines.length})` : `Ocultar logs`}
      </button>
      {!collapsed && (
        <div style={{
          marginTop: 4, background: "var(--bg-2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "8px 10px", fontFamily: "JetBrains Mono", fontSize: 10.5,
          color: "var(--fg-muted)", display: "flex", flexDirection: "column", gap: 3,
        }}>
          {lines.map((ln, i) => (
            <LogLine key={i} ln={ln} iconFor={iconFor} colorFor={colorFor} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogLine({ ln, iconFor, colorFor, last }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "42px 14px 1fr", gap: 6, alignItems: "start", lineHeight: 1.45 }}>
      <span style={{ color: "var(--fg-subtle)" }}>{ln.t}</span>
      <span style={{ color: colorFor(ln.kind), textAlign: "center" }}>{iconFor(ln.kind)}</span>
      <span>
        <span style={{ color: "var(--fg)" }}>{ln.label}</span>
        {ln.detail && <span style={{ color: "var(--fg-subtle)" }}> · {ln.detail}</span>}
        {last && <span className="pulse-dot" style={{ marginLeft: 4, display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />}
      </span>
    </div>
  );
}

// ---------- AI chat sidebar ----------
function ChatSidebar({ open, onClose, mode: initialMode = "analizar" }) {
  const [mode, setMode] = useStateP(initialMode);
  useEffectP(() => { setMode(initialMode); }, [initialMode]);
  const [messagesAnalizar, setMessagesAnalizar] = useStateP([
    {
      from: "ai",
      text: "He analizado los datos del período. Detecté 2 anomalías y 1 alerta de margen. ¿Sobre qué te gustaría profundizar?",
      logs: [
        { t: "+0.0s", kind: "tool",   label: "fetch_widget_data", detail: "6 widgets · 2.3 MB" },
        { t: "+0.4s", kind: "tool",   label: "detect_anomalies",  detail: "zscore > 2.5 · 2 hits" },
        { t: "+1.1s", kind: "reason", label: "Razonando",          detail: "comparando con semana santa 2025" },
        { t: "+1.8s", kind: "done",   label: "Respuesta lista",    detail: "1.742 tokens · claude-sonnet-4.5" },
      ],
    },
  ]);
  const [messagesModificar, setMessagesModificar] = useStateP([
    {
      from: "ai",
      text: "Puedo modificar este panel: añadir widgets, cambiar comparaciones, filtrar por tienda… dime qué necesitas.",
      logs: [],
    },
  ]);
  const [input, setInput] = useStateP("");
  const [streamingLog, setStreamingLog] = useStateP(null); // { messageIdx, lines:[], done:false }
  const [expandedLogs, setExpandedLogs] = useStateP({});   // { [globalMsgIdx]: true }

  const messages = mode === "analizar" ? messagesAnalizar : messagesModificar;
  const setMessages = mode === "analizar" ? setMessagesAnalizar : setMessagesModificar;

  const suggestionsAnalizar = [
    "¿Por qué cayeron las ventas?",
    "Tiendas con mayor bajada",
    "Comparar con Semana Santa 2025",
  ];
  const suggestionsModificar = [
    "Añade widget de margen por familia",
    "Cambia comparativa a año anterior",
    "Filtra solo tiendas TOP 10",
  ];
  const suggestions = mode === "analizar" ? suggestionsAnalizar : suggestionsModificar;

  const send = (text) => {
    if (!text.trim()) return;
    setMessages((m) => [...m, { from: "user", text }]);
    setInput("");

    // Start streaming log
    const logSequence = mode === "analizar"
      ? [
          { t: "+0.0s", kind: "tool",   label: "parse_intent",       detail: "intent=why_drop · scope=tickets" },
          { t: "+0.3s", kind: "tool",   label: "fetch_widget_data",  detail: "6 widgets · 2.3 MB" },
          { t: "+0.9s", kind: "tool",   label: "run_sql",            detail: "SELECT store, SUM(net) FROM sales …" },
          { t: "+1.4s", kind: "reason", label: "Razonando",           detail: "Semana Santa desplazada · ajustar comparable" },
          { t: "+2.1s", kind: "tool",   label: "detect_anomalies",   detail: "z > 2.5 · tiendas 804, 159" },
          { t: "+2.7s", kind: "done",   label: "Respuesta lista",     detail: "1.984 tokens · claude-sonnet-4.5" },
        ]
      : [
          { t: "+0.0s", kind: "tool",   label: "parse_request",      detail: "op=add_widget · target=margen" },
          { t: "+0.4s", kind: "tool",   label: "lookup_schema",      detail: "table=sales · col=margin_pct" },
          { t: "+1.0s", kind: "reason", label: "Generando spec",      detail: "bar_chart · groupBy=familia" },
          { t: "+1.6s", kind: "tool",   label: "validate_sql",       detail: "OK · 0 errors" },
          { t: "+2.0s", kind: "done",   label: "Dashboard modificado",detail: "+1 widget · persistido" },
        ];

    const finalMsgIdx = messages.length + 1; // after user message
    setStreamingLog({ messageIdx: finalMsgIdx, lines: [], done: false });

    logSequence.forEach((line, i) => {
      setTimeout(() => {
        setStreamingLog((cur) => cur ? { ...cur, lines: [...cur.lines, line] } : cur);
      }, (i + 1) * 420);
    });

    setTimeout(() => {
      const reply = mode === "analizar"
        ? "La caída de tickets coincide con el desplazamiento de Semana Santa. Ajustando el comparable con año anterior natural, las ventas netas bajan solo 4,2%. Tiendas 804 y 159 siguen siendo las más afectadas."
        : "Dashboard actualizado. Se ha añadido 1 widget y ajustado la comparativa.";
      setMessages((m) => [...m, { from: "ai", text: reply, logs: logSequence }]);
      setStreamingLog({ messageIdx: finalMsgIdx, lines: logSequence, done: true });
      setTimeout(() => setStreamingLog(null), 400);
    }, (logSequence.length + 1) * 420);
  };

  const toggleLog = (idx) => setExpandedLogs((e) => ({ ...e, [idx]: !e[idx] }));

  if (!open) return null;
  return (
    <aside style={{
      position: "fixed", top: 56, right: 0, bottom: 0, width: 380, background: "var(--bg-1)",
      borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", zIndex: 15,
    }}>
      <header style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Asistente IA</div>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: 6 }}>
              <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--up)" }} />
              Conectado · claude-sonnet
            </div>
          </div>
          <button onClick={onClose} style={{ ...btn("ghost"), height: 28 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 0, marginTop: 6 }}>
          {[{id:"modificar",label:"Modificar"},{id:"analizar",label:"Analizar"}].map((t) => (
            <button key={t.id} onClick={() => setMode(t.id)} style={{
              flex: 1, padding: "10px 0", background: "transparent", border: "none",
              color: mode === t.id ? "var(--accent)" : "var(--fg-muted)",
              borderBottom: `2px solid ${mode === t.id ? "var(--accent)" : "transparent"}`,
              fontSize: 12, fontWeight: mode === t.id ? 600 : 500, cursor: "pointer", fontFamily: "inherit",
            }}>{t.label}</button>
          ))}
        </div>
      </header>
      <div style={{ padding: "10px 16px 0", fontSize: 11, color: "var(--fg-subtle)" }}>
        {mode === "modificar" ? "Pide cambios al dashboard." : "Pregunta sobre los datos."}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.from === "user" ? "flex-end" : "flex-start", gap: 4 }}>
            {m.from === "ai" && m.logs && m.logs.length > 0 && (
              <LogBlock
                lines={m.logs}
                collapsed={!expandedLogs[i]}
                onToggle={() => toggleLog(i)}
                streaming={false}
              />
            )}
            <div style={{
              maxWidth: "86%",
              background: m.from === "user" ? "var(--accent)" : "var(--bg-2)",
              color: m.from === "user" ? "#fff" : "var(--fg)",
              padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
            }}>{m.text}</div>
          </div>
        ))}
        {streamingLog && !streamingLog.done && streamingLog.lines.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            <LogBlock lines={streamingLog.lines} collapsed={false} streaming={true} />
          </div>
        )}
      </div>
      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 14, background: "var(--bg-2)",
              border: "1px solid var(--border)", color: "var(--fg-muted)", cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && send(input)}
                 placeholder={mode === "modificar" ? "Pide un cambio…" : "Pregunta sobre los datos…"}
                 style={{
                   flex: 1, background: "var(--bg-2)", border: "1px solid var(--border)",
                   borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "var(--fg)", outline: "none", fontFamily: "inherit",
                 }} />
          <button onClick={() => send(input)} style={btn("primary")}>Enviar</button>
        </div>
      </div>
    </aside>
  );
}

// ---------- Floating right-rail "Analizar con IA" launcher ----------
function AnalyzeLauncher({ onOpen }) {
  return (
    <button onClick={onOpen} title="Analizar con IA" style={{
      position: "fixed", right: 0, top: "42%", zIndex: 14,
      background: "var(--accent)", color: "#fff", border: "none",
      padding: "16px 12px", borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
      cursor: "pointer", writingMode: "vertical-rl", transform: "rotate(180deg)",
      fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
      boxShadow: "0 8px 24px -6px rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit",
    }}>
      <span style={{ transform: "rotate(180deg)" }}>✦</span>
      <span>Analizar con IA</span>
    </button>
  );
}

window.Parts = { TopBar, PageHeader, FilterStrip, Panel, KpiCard, InsightsStrip, ArticlesTable, ChatSidebar, AnalyzeLauncher };
