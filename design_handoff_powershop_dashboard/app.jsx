const { useState, useEffect } = React;

function App() {
  const [tweaks, setTweaks] = useTweaks({
    "theme": "dark",
    "accent": "electric",
    "density": "comfort",
    "kpiStyle": "editorial",
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState("analizar");
  const [panelOpen, setPanelOpen] = useState(false);

  // Apply tweaks to root
  useEffect(() => {
    document.body.dataset.theme = tweaks.theme;
    document.body.dataset.accent = tweaks.accent;
    document.body.dataset.density = tweaks.density;
  }, [tweaks]);

  const D = window.DATA;
  const { TopBar, PageHeader, FilterStrip, Panel, KpiCard, InsightsStrip, ArticlesTable, ChatSidebar, AnalyzeLauncher } = window.Parts;
  const { CompareBarChart, RankedBars, LineChart, Donut } = window.Charts;

  const mainPad = chatOpen ? 380 : 0;

  return (
    <div>
      <TopBar
        onToggleChat={() => setChatOpen(!chatOpen)}
        chatOpen={chatOpen}
        onToggleTweaks={() => setPanelOpen(!panelOpen)}
      />

      <main style={{ marginRight: mainPad, transition: "margin 0.2s" }}>
        <PageHeader />
        <FilterStrip />

        <div style={{ padding: "20px 20px 40px", display: "flex", flexDirection: "column", gap: "var(--gap)" }}>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--gap)" }}>
            {D.SALES_KPIS.map((k) => (
              <KpiCard key={k.id} kpi={k} style={tweaks.kpiStyle} />
            ))}
          </div>

          {/* Insights strip */}
          <InsightsStrip insights={D.INSIGHTS} />

          {/* Row 1: Trend (wide) + Payment mix */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--gap)" }}>
            <Panel
              title="Tendencia Semanal"
              subtitle="Ventas netas diarias · Actual vs período anterior"
              right={<Legend items={[
                { label: "Actual", color: "var(--accent)" },
                { label: "Anterior", color: "var(--accent-2)", dashed: true },
              ]} />}
              tall
            >
              <LineChart data={D.WEEKLY_TREND} height={280} />
            </Panel>

            <Panel
              title="Mix Formas de Pago"
              subtitle="% sobre ventas netas"
              tall
            >
              <Donut data={D.PAYMENT_MIX} size={160} primary={D.PAYMENT_MIX[0]} />
            </Panel>
          </div>

          {/* Row 2: Store sales + Margin */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap)" }}>
            <Panel
              title="Ventas por Tienda"
              subtitle="Actual vs anterior · ordenado por volumen"
              right={<Legend items={[
                { label: "Actual", color: "var(--accent)" },
                { label: "Anterior", color: "var(--accent-2)" },
              ]} />}
              tall
            >
              <CompareBarChart
                data={D.SALES_BY_STORE.map((s, i) => ({
                  ...s,
                  actual: s.value,
                  previous: s.value * (0.9 + Math.sin(i) * 0.15 + 0.2),
                }))}
                height={280}
              />
            </Panel>

            <Panel
              title="Margen Bruto % por Tienda"
              subtitle="Top/bottom · umbral alerta < 50%"
              right={<Legend items={[
                { label: "Alerta", color: "var(--down)" },
                { label: "Medio", color: "var(--accent)" },
              ]} />}
              tall
            >
              <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 6 }}>
                <RankedBars data={D.MARGIN_BY_STORE} format="pct" max={100} />
              </div>
            </Panel>
          </div>

          {/* Top articles */}
          <Panel
            title="Top 10 Artículos"
            subtitle="Período seleccionado · ordenado por ventas netas"
            right={<button style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "transparent",
              border: "1px solid var(--border-strong)", color: "var(--fg-muted)", cursor: "pointer",
            }}>Ver todos →</button>}
            padded={false}
          >
            <ArticlesTable rows={D.TOP_ARTICLES} />
          </Panel>

        </div>
      </main>

      <ChatSidebar open={chatOpen} onClose={() => setChatOpen(false)} mode={chatMode} />
      {!chatOpen && <AnalyzeLauncher onOpen={() => { setChatMode("analizar"); setChatOpen(true); }} />}

      <TweaksPanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Tweaks">
        <TweakSection title="Aspecto">
          <TweakRadio label="Tema" value={tweaks.theme} onChange={(v) => setTweaks({ theme: v })}
                      options={[{ value: "dark", label: "Oscuro" }, { value: "light", label: "Claro" }]} />
          <TweakRadio label="Acento" value={tweaks.accent} onChange={(v) => setTweaks({ accent: v })}
                      options={[
                        { value: "electric", label: "Eléctrico" },
                        { value: "citrus",   label: "Cítrico" },
                        { value: "magenta",  label: "Magenta" },
                        { value: "mono",     label: "Mono" },
                      ]} />
          <TweakRadio label="Densidad" value={tweaks.density} onChange={(v) => setTweaks({ density: v })}
                      options={[
                        { value: "compact",  label: "Compacto" },
                        { value: "comfort",  label: "Cómodo" },
                        { value: "spacious", label: "Amplio" },
                      ]} />
          <TweakRadio label="Estilo KPI" value={tweaks.kpiStyle} onChange={(v) => setTweaks({ kpiStyle: v })}
                      options={[
                        { value: "editorial", label: "Editorial" },
                        { value: "bold",      label: "Destacado" },
                        { value: "minimal",   label: "Mínimo" },
                      ]} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--fg-muted)" }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: it.dashed ? 14 : 10, height: it.dashed ? 0 : 10,
            borderRadius: 2, background: it.dashed ? "transparent" : it.color,
            borderTop: it.dashed ? `1.5px dashed ${it.color}` : "none",
          }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
