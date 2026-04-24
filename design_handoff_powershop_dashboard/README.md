# Handoff: Powershop Analytics — Dashboard Redesign

## Overview

This handoff covers a **visual + interaction redesign** of the Powershop Analytics dashboard view (the "Cuadro de Mandos — Ventas Retail" page at `/dashboard/[id]`). The original app is functional but visually flat: a generic Tremor layout with thin borders, grey-on-grey widgets, no semantic color for up/down deltas, and no information hierarchy. This redesign turns the dashboard into a **colorful, hierarchy-driven "data newsroom"** where the most important numbers and anomalies stand out immediately, while keeping every feature of the original (date range + comparison, filters, auto-refresh, AI chat sidebar for Modificar/Analizar, glossary, version history, etc.).

The target user is the retail sales manager who opens this panel each morning and needs to know in under 5 seconds:
1. Did sales move? (KPI row with deltas, sparklines, semantic color)
2. What's anomalous and needs my attention? (anomaly-highlighted KPI + insights strip)
3. Which stores / products drove the change? (store comparison chart, margin chart, ranked articles table)
4. What happened over time? (weekly trend line with comparison period overlay)

## About the Design Files

The files in this bundle are **design references created in HTML** — a React-in-Babel prototype demonstrating the intended look, layout, and interactions. **They are not production code to copy directly.** The task is to **recreate this design inside the existing Powershop Analytics codebase** — a Next.js 14 App Router app using Tremor, Tailwind, and TypeScript — following the project's established patterns:

- Pages in `dashboard/app/dashboard/[id]/page.tsx` and `dashboard/app/dashboard/new/page.tsx`
- Shared widgets in `dashboard/components/widgets/`
- Chart color palette in `dashboard/components/widgets/chart-colors.ts`
- Tremor's `<Card>`, `<Metric>`, `<BarChart>`, `<LineChart>`, `<DonutChart>` etc. — but augmented / replaced where the redesign calls for it
- All copy is in **Spanish (es-ES)** and must remain so
- All monetary values formatted as `es-ES` EUR, integers as `es-ES` locale with `.` thousands separator

Tremor's built-in charts cover most cases, but a few visuals in this redesign need work beyond Tremor defaults (the editorial KPI card, the dual-bar store comparison with tooltip, the horizontal ranked margin bars with threshold coloring, the table heat cells). Decide per-widget whether to extend the existing Tremor component with Tailwind overrides or build a small custom SVG chart inside `components/widgets/` following the pattern of the existing widget files.

## Fidelity

**High-fidelity.** Every color, type size, spacing value, border radius, and interaction state is specified. Recreate pixel-close — the redesign's impact comes from the tight control of contrast and hierarchy, not from loose interpretation.

One caveat: the prototype uses CSS variables for theming (`--bg`, `--fg`, `--accent`, etc.) directly on `<body data-theme data-accent data-density>`. In the real codebase you should map these to your Tailwind `dark:` variant + a CSS-variables layer in `globals.css`, not re-create the data-attribute system (unless you want to expose all four tweak axes to end users, which is optional).

---

## Design Tokens

### Color system — Dark theme (default)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0b0c0f` | Page background |
| `--bg-1` | `#111317` | Cards, sticky header, chat sidebar |
| `--bg-2` | `#161920` | Input fields, filter pills, code blocks, sub-surfaces |
| `--bg-3` | `#1d2029` | Extra-sunken (heat-bar track) |
| `--border` | `#23262f` | Default hairline border |
| `--border-strong` | `#2f3340` | Hover border, focused inputs, dropdown chrome |
| `--fg` | `#eceff4` | Primary text |
| `--fg-muted` | `#9aa0ab` | Labels, subtitles |
| `--fg-subtle` | `#5d626c` | Mono tags, axis labels, timestamps |
| `--up` | `#34d399` | Positive delta, good margin |
| `--up-bg` | `rgba(52, 211, 153, 0.12)` | Positive chip background |
| `--down` | `#fb7185` | Negative delta, anomaly, low margin |
| `--down-bg` | `rgba(251, 113, 133, 0.12)` | Negative chip / anomaly ring |
| `--warn` | `#fbbf24` | Warning (returns, alerts, margin < threshold) |
| `--warn-bg` | `rgba(251, 191, 36, 0.12)` | Warning chip background |
| `--grid` | `rgba(255,255,255,0.04)` | Chart gridlines |

### Color system — Light theme

| Token | Hex |
|---|---|
| `--bg` | `#fafaf7` |
| `--bg-1` | `#ffffff` |
| `--bg-2` | `#f4f4ef` |
| `--bg-3` | `#ebebe5` |
| `--border` | `#e4e4de` |
| `--border-strong` | `#d4d4cc` |
| `--fg` | `#1a1a1a` |
| `--fg-muted` | `#5f5f5f` |
| `--fg-subtle` | `#9a9a9a` |
| `--up` | `#059669` |
| `--down` | `#dc2626` |
| `--warn` | `#d97706` |

### Accents (4 options — Tweaks panel)

The accent drives ~80% of chart color use. Default is `electric`.

| Accent | `--accent` | `--accent-2` |
|---|---|---|
| Electric (default) | `#7c5cff` violet | `#22d3ee` cyan |
| Citrus | `#f59e0b` amber | `#10b981` emerald |
| Magenta | `#ec4899` pink | `#8b5cf6` violet |
| Mono | `#e5e5e5` light grey | `#a3a3a3` grey |

`--accent-soft` in each case is the accent at ~14% alpha, used for pill backgrounds, avatar chips, and "vs" badges.

### Typography

**Fonts:**
- **Inter** (Google Fonts) — all UI, headings, and numbers. Weights used: 400, 500, 600, 700, 800.
- **JetBrains Mono** (Google Fonts) — section labels, timestamps, store codes, article refs, breadcrumbs, chart axis labels, tags. Weights: 400, 500, 600.
- No serif is used in the final design (the `Instrument Serif` preconnect in the HTML head is unused — can be removed).

**Type scale:**
| Usage | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| Page title (H1) | 30px | 700 | -0.02em | 1.1 |
| Page title muted suffix | 30px | 500 | -0.02em | 1.1 |
| KPI number (editorial) | 34px | 600 | -0.02em | 1.05 |
| KPI number (bold) | 42px | 700 | -0.03em | 1.05 |
| KPI number (minimal) | 28px | 600 | -0.005em | 1.1 |
| Panel title (H3) | 13px | 600 | -0.005em | — |
| Panel subtitle | 11px | 400 | — | — |
| Body / table cell | 12px | 400 | — | 1.5 |
| KPI label, meta | 11px | 400 | 0.08em | — |
| Mono labels (uppercase) | 10–11px | 400 | 0.08–0.1em (uppercase) | — |

**Numeric styling:** all numbers must have `font-variant-numeric: tabular-nums` so digits align in columns. The prototype applies this globally via `font-feature-settings: "tnum"` on `body`, and reinforces with a `.num` utility class.

### Spacing & radii

Density tokens (Tweaks panel exposes 3 modes; default is `comfort`):

| Token | Compact | Comfort | Spacious |
|---|---|---|---|
| `--gap` | 12px | 18px | 26px |
| `--pad` | 14px | 20px | 28px |
| `--kpi-pad` | 16px | 22px | 30px |

Fixed radii: cards `10px`, buttons/inputs `6px`, pills `20px` (filter pills) / `14px` (suggestion chips), chips/badges `3–4px`, heat bars `2–3px`.

**Shadows:**
- Cards: no default shadow in dark; anomaly cards use `0 0 0 3px var(--down-bg)` (outer glow ring).
- Dropdown popovers: `0 18px 40px -10px rgba(0,0,0,0.5)`.
- Floating "Analizar con IA" rail: `0 8px 24px -6px rgba(0,0,0,0.4)`.

### Icons

No icon library. SVGs are hand-drawn inline (logo bolt) or are Unicode characters: `▲ ▼ ⚠ ✦ ⌬ ✓ · ⟳ ‹ › ✕ ⚙ ←`. Keep this minimal approach.

---

## Screens / Views

This redesign is a **single screen** — the dashboard view. It has several major regions, described top-to-bottom.

### 1. Top bar (sticky, 56px)

- Full-width, `background: var(--bg-1)`, `border-bottom: 1px solid var(--border)`, sticks to top, `z-index: 20`, `padding: 0 20px`.
- **Left side:**
  - **Logo**: 22×22 SVG lightning bolt filled with `var(--accent)`, followed by the word `Powershop` (Inter 700, 14px, letter-spacing -0.01em) + the word `ANALYTICS` in JetBrains Mono 11px `var(--fg-subtle)`, 2px left margin.
  - **Primary nav**: three links — `Dashboards` (active), `Revisión`, `Glosario`. Active link has `var(--bg-2)` background, `border-radius: 6px`, `padding: 6px 12px`, weight 500, color `var(--fg)`. Inactive links: transparent background, `var(--fg-muted)`, weight 400.
  - **Note: ETL was removed from the nav.** In the original codebase the ETL link was a main nav item; it's now consolidated into the `Admin` link on the right side of the top bar.
- **Right side:**
  - A live status indicator: pulsing 6×6 dot in `var(--up)` (CSS animation `pulse-dot` — 2s ease-in-out infinite, scales 1→1.3 and fades to 0.5 opacity), followed by text `Datos al día · hace 12m` in `var(--fg-muted)` 11px. Wire this up to the existing `<DataFreshnessBanner>` signal.
  - **Cog button** (`⚙`) — opens Tweaks panel. `btn("ghost")` style: 32px tall, transparent, `var(--fg-muted)`.
  - **`Admin` link** — takes over the role of ETL/settings. Same ghost button styling.
  - **Avatar** — 28×28 circle, `var(--accent-soft)` background, accent-colored initials, 11px weight 600.

### 2. Page header (below top bar, `padding: 24px 20px 14px`)

Flex row, `justify-content: space-between`, wraps on narrow widths.

- **Left (title block):**
  - **Breadcrumb row** above the H1: JetBrains Mono 11px uppercase `var(--fg-muted)`, letter-spacing 0.08em, gap 10px — `Retail` / `Ventas` / `EN VIVO`. The separator `/` is `var(--fg-subtle)`. The `EN VIVO` item is a tag: `padding: 2px 6px`, `background: var(--accent-soft)`, color `var(--accent)`, `border-radius: 3px`, size 10px.
  - **H1**: `Cuadro de Mandos — Ventas Retail` (the em-dash suffix is `var(--fg-muted)` weight 500 while the start is weight 700). Inter, 30px, letter-spacing -0.02em, line-height 1.1. Margin: 0.
  - **Description**: 13px `var(--fg-muted)`, `max-width: 680px`, `line-height: 1.5`, 8px top margin. Describes which KPIs and panels are on this dashboard.

- **Right (actions), gap 8px, wraps:**
  - **Date switcher** (see §3 below) — the centerpiece.
  - `⟳ Actualizar`, `Exportar`, `Historial`, `Guardar` — all `btn("outline")`: 32px, transparent bg, `var(--fg)` color, `1px solid var(--border-strong)` border, `border-radius: 6px`, `padding: 0 12px`, 12px weight 500.

### 3. Date switcher (custom dropdown)

A single pill-shaped control with three segments: prev arrow `‹`, clickable center label, next arrow `›`. Center label is:

- 13px calendar icon (inline SVG stroke-width 2, color `var(--fg-muted)`)
- The current-period label (e.g., `abril de 2026`, `23 abr 2026`, `sem 17 · abr 2026`, `T2 2026`, `2026`, or `{from} → {to}`)
- A small accent badge `vs` (10px JetBrains Mono, `--accent-soft` bg, `--accent` fg, `padding: 2px 6px`, radius 3)

On click the center button opens a **440px-wide popover**, positioned below-right, with this layout:
- **Top: two columns side by side** (grid 1fr/1fr, divider between them):
  - **Left — "Período actual":** options `Hoy`, `Semana actual`, `Mes actual`, `Trimestre actual`, `Año actual`. Each is a left-aligned button; active one has `var(--accent-soft)` background, `var(--accent)` text, weight 600, radius 4.
  - **Right — "Período anterior":** options `Ayer`, `Semana anterior`, `Mes anterior`, `Trimestre anterior`, `Año anterior`.
- **Middle — "Rango personalizado":** two native `<input type="date">` fields side-by-side (`Desde` / `Hasta`). Inputs have `var(--bg-2)` background, `var(--border)` border, `color-scheme: dark`.
- **Bottom — full-width `Aplicar` button:** `background: var(--accent)`, white text, `height: 34`, `border-radius: 6`.
- **Footer — "Período de comparación":** inset with `var(--bg-2)` background. A `<select>` with options `Período anterior`, `Año anterior`, `Sin comparación`, `Personalizado`. Below, a mono caption showing the resolved comparison range in light grey (`var(--fg-subtle)`), e.g., `1 mar — 31 mar 2026`.

Section labels inside the popover are 10px uppercase JetBrains Mono, letter-spacing 0.1em, `var(--fg-subtle)`.

Click-outside closes the popover.

### 4. Filter strip

Below the page header, bordered top + bottom. `background: var(--bg-1)`, `padding: 10px 20px`, flex row, wraps.

- Starts with a mono label `FILTROS` (11px, `var(--fg-subtle)`, uppercase, letter-spacing 0.08em).
- Three **filter pills**: `Tienda`, `Familia`, `Canal`. Each pill is a `<label>` wrapping a `<select>`:
  - `background: var(--bg-2)`, `border: 1px solid var(--border)`, `border-radius: 20px`, `padding: 4px 10px 4px 12px`.
  - Inner: small label (11px `--fg-muted`) + native `<select>` (transparent, no border, inherits font). Include `padding-right: 14px` on the select for the dropdown arrow.
  - Options use dashboard-relevant values: `Tienda` defaults `Todas`, options `611 / 622 / 608 / 637 / 606`. `Familia` defaults `Todas`, options `Americana / Pantalón / Vestido / Accesorios`. `Canal` defaults `Retail`, options `Retail / Mayorista / Ambos`.
- On the right (flex: 1 spacer first), a ghost-button `Limpiar filtros` at 11px.

Wire these to the existing `globalFilterValues` state and `<DashboardFiltersBar>` handling in `dashboard/app/dashboard/[id]/page.tsx`.

### 5. KPI row (4 cards, equal columns, gap: `var(--gap)`)

The four primary KPIs — mirror real Powershop values for the current default period:

| # | Label | Value | Format | Delta | vs | Flags |
|---|---|---|---|---|---|---|
| 1 | Ventas Netas | 134.802,42 | EUR | **−18,9%** | 166.217,09 | **anomaly: true** |
| 2 | Tickets | 5.077 | int | **−28,7%** | 7.119 | **anomaly: true** |
| 3 | Ticket Medio | 26,55 | EUR | **+13,8%** | 23,33 | — |
| 4 | Devoluciones | 12.522,50 | EUR | **+8,3%** | 11.563,21 | **warn: true, inverted: true** (rising returns are bad) |

Each card includes a 14-point sparkline embedded in the layout. The `editorial` style (default) is:

```
┌───────────────────────────────────────┐
│ VENTAS NETAS          [▼ 18,9%]       │   ← mono uppercase label · delta chip right
│ ● ANOMALÍA DETECTADA                  │   ← only if anomaly: red pulsing dot + text
│                                       │
│                                       │
│ 134.802,42 €                          │   ← 34px 600 weight number
│                                       │
│ vs 166.217,09         ⎓⎓⎓⎓⎓⎓⎓ (spark) │   ← comparison + sparkline right-aligned
└───────────────────────────────────────┘
```

- **Card chrome:** `background: var(--bg-1)`, `border: 1px solid var(--border)`, `border-radius: 10px`, `padding: var(--kpi-pad)`. **If anomaly**, border becomes `var(--down)` and the card gets `box-shadow: 0 0 0 3px var(--down-bg)` (outer ring).
- **Delta chip:** 11px 600 weight, JetBrains Mono, `padding: 3px 8px`, radius 4. Color + bg depend on polarity: positive = `--up/--up-bg`, negative = `--down/--down-bg`, warn (inverted + going up) = `--warn/--warn-bg`. Prefix arrow: `▲` if positive, `▼` if negative. **Use the `inverted` flag** on a KPI to mean "rising is bad" (applies to Devoluciones).
- **Value:** 34px, weight 600, letter-spacing -0.02em. Tabular numbers. Use `Intl.NumberFormat('es-ES', {style:'currency',currency:'EUR'})` with `maximumFractionDigits: 2` when value < 100 else 0.
- **Sparkline:** 90×24 SVG, single stroke at 1.5px (stroke-linecap round, stroke-linejoin round), with a filled area beneath at 0.15 opacity. Stroke color = delta color (up/down/warn). No axes, no points.
- **Comparison value:** 11px `--fg-subtle`, prefixed "vs".

Two alternate KPI styles exposed via Tweaks:
- **Bold:** 42px number, anomaly cards fill with `--down-bg` and tint the number red. No sparkline shown; only label + number + delta chip + "vs anterior".
- **Minimal:** 28px number, one-line delta + comparison below, no chip or sparkline.

### 6. Insights strip (3 cards, equal columns, gap: `var(--gap)`)

Auto-generated narrative callouts below the KPI row.

- Grid: `repeat(${n}, 1fr)`; default n=3.
- Each card: `padding: 14px 16px`, card chrome as above (no anomaly ring).
- Inside, flex row gap 12:
  - **Icon tile:** 28×28, `border-radius: 6px`. Background tinted by `kind`, icon glyph colored accordingly:
    - `up` → `▲` on `--up-bg`, `--up`
    - `down` → `▼` on `--down-bg`, `--down`
    - `warn` → `⚠` on `--warn-bg`, `--warn`
  - **Text block:** 13px weight 600 title, then 12px `--fg-muted` body, `line-height: 1.45`, 3px gap.

Default insights for current period:
1. **down** — "Tickets cayeron 28,7%" — "Mayor caída en tiendas 804, 159, 97 — coincide con Semana Santa fuera de calendario este año."
2. **up** — "Ticket medio +13,8%" — "Subida del ticket compensa parcialmente la caída de afluencia. AMERICANA y ABRIGO lideran."
3. **warn** — "Margen 601 en alerta" — "27,8% vs media 61,5%. Revisar descuentos aplicados en PANTALON."

These strings are narrative copy — fine to keep as authored until an insight-generator backend exists.

### 7. Charts row 1 — Weekly trend (2/3) + Payment mix (1/3)

Grid `2fr 1fr`, gap `var(--gap)`. Both panels are `tall` (min-height 380px).

**Panel chrome (reused for all panels):**
- `background: var(--bg-1)`, `border: 1px solid var(--border)`, `border-radius: 10px`, `overflow: hidden`, flex-column.
- Header row: `padding: 12px 16px`, bottom border hairline. Title 13px weight 600, subtitle below at 11px `--fg-muted` with 2px top margin. Optional right slot (legend or button).
- Body: `padding: var(--pad)`, `flex: 1`.

**Weekly trend line chart:**
- Title: "Tendencia Semanal" · Subtitle: "Ventas netas diarias · Actual vs período anterior".
- Legend (right slot): two 11px items — `● Actual` (solid 10×10, `--accent`), `Anterior` (14px dashed line, `--accent-2`).
- The SVG is 800 wide, `height: 280`, `viewBox` preserves aspect. Padding: top 10, right 12, bottom 24, left 44.
- Data: 12 dates from `30 mar` to `21 abr`, each with `actual` and `previous` numeric values. The actual line **dips sharply** in the final days (reflecting the −18.9% KPI).
- **Rendering:**
  - 5 horizontal gridlines at 0/25/50/75/100% of y-range, `stroke: var(--grid)`, `stroke-width: 1`.
  - Y-axis ticks at the same 5 positions, JetBrains Mono 10px `--fg-subtle`, right-aligned, values formatted as `{k}k` if ≥1000 else integer. Put them 6px left of the chart.
  - **Previous line**: dashed (`stroke-dasharray: 3 3`), `stroke: var(--accent-2)`, `stroke-width: 1.5`, `opacity: 0.7`. No area fill.
  - **Actual line**: solid, `stroke: var(--accent)`, `stroke-width: 2.5`, stroke-linecap/join round.
  - **Actual area fill**: `<linearGradient>` from `--accent` at 0.35 alpha (top) to 0 (bottom), applied to the area under the actual path.
  - X-axis: every ~6th data point gets a JetBrains Mono 10px `--fg-subtle` label centered on its x.
- **Hover:** tracks mouse X, snaps to nearest index. Draws a vertical dashed line `--fg-muted` `stroke-dasharray: 2 2` at that index. Puts a 4px radius circle on the actual line (fill `--accent`, stroke `--bg-1` width 2) and a 3px radius on the previous. Shows a tooltip card in the top-right: date label, two `● label value` rows for actual (accent) and previous (accent-2), and a delta row below a 1px top-border: colored delta percentage + `vs período anterior` in subtle.

**Payment mix donut:**
- Title: "Mix Formas de Pago" · Subtitle: "% sobre ventas netas".
- Donut 160px, stroke 22px, rendered as 5 arcs using stroke-dasharray on overlaid `<circle>` elements. Legend right-of-donut in a flex column.
- Data, fixed colors:
  - Tarjeta — 62,4% — `var(--accent)`
  - Efectivo — 18,1% — `var(--accent-2)`
  - Bizum — 11,3% — `#f59e0b`
  - Financ. — 5,2% — `#ec4899`
  - Vale — 3,0% — `#34d399`
- **Center readout:** shows 22px weight 600 percentage of the currently-focused segment, then a 10px uppercase mono label below. Defaults to the primary (largest) segment — Tarjeta 62,4%.
- **Hover:** widen the hovered arc by 3px (`stroke-width: stroke + 3`), fade non-hovered legend rows to 0.5 opacity, show hovered segment in the center readout.

### 8. Charts row 2 — Store sales compare (1/2) + Margin ranked (1/2)

Grid `1fr 1fr`, gap `var(--gap)`. Both panels are `tall`.

**Ventas por Tienda (compare bar chart):**
- Title: "Ventas por Tienda" · Subtitle: "Actual vs anterior · ordenado por volumen".
- Legend: `● Actual` (`--accent`), `● Anterior` (`--accent-2`).
- Data: 20 stores (`611` top at 10.492, descending through `97` at 3.480) with `actual` + `previous` (synthesized: `value * (0.9 + sin(i)*0.15 + 0.2)`).
- For each store: two adjacent vertical bars sharing a group. Previous is `--accent-2` at 0.55 opacity behind, Actual is `--accent` in front. Stores with `flag: "top"` get `--up`, `flag: "low"` get `--down`.
- 5 horizontal gridlines. X-axis shows every ceil(n/12)th store code in JetBrains Mono 10px `--fg-subtle`.
- Hover group (invisible rect spanning full bar width) shows a tooltip card top-right: store code, actual (accent ●), previous (accent-2 ●).

**Margen Bruto % por Tienda (ranked horizontal bars, scrollable):**
- Title: "Margen Bruto % por Tienda" · Subtitle: "Top/bottom · umbral alerta < 50%".
- Legend: `● Alerta` (`--down`), `● Medio` (`--accent`).
- The panel body has `max-height: 320px, overflow-y: auto, padding-right: 6px`.
- Each row is a 3-column grid `36px 1fr auto` gap 10, align center:
  - Store code (mono, 11px `--fg-muted`)
  - Bar: 18px tall, `background: var(--bg-2)`, `border-radius: 3px`, `overflow: hidden`. Inside, a width `pct%` filled div. Color = `--down` if `flag:"low"`, `--up` if `flag:"top"`, else `--accent`. Add `transition: width 0.5s cubic-bezier(.2,.8,.2,1)` for a smooth load animation.
  - Right value: mono 11px, "XX.X%".
- Data: 20 stores; `601` at 27.8% is flagged low (the only alert); `159` tops at 85.2%.

### 9. Top articles table

Full-width panel, **not padded** (`padded: false` — the table flows edge-to-edge inside). Panel header right slot has a ghost button: `Ver todos →`, 11px, `border: 1px solid var(--border-strong)`, radius 4, transparent.

**Table:**
- Header row: JetBrains Mono 10px uppercase `--fg-subtle`, letter-spacing 0.08em, padding 10px 12px, bottom border.
- Columns: `Rank`, `Referencia`, `Descripción`, `Familia`, `Unidades` (right-aligned), `Ventas Netas` (right-aligned), `Margen %` (right-aligned).
- Body rows: 12px, padding 10px 12px, top border hairline.
  - **Rank:** zero-padded 2-digit number in mono `--fg-subtle`.
  - **Referencia:** mono 11px `--accent`.
  - **Descripción:** Title Case (the data is stored all-caps, **convert in render** using a helper that lowercases common Spanish connectors — `de la el y en con c/ m/ del los las`).
  - **Familia:** small tag — `padding: 2px 6px`, radius 3, `background: var(--bg-2)`, `color: --fg-muted`, mono 10px, Title Case.
  - **Unidades / Ventas Netas:** **heat cells**. Each is a relative-positioned inline-flex right-aligned, `min-width: 140px`. Behind the number, a right-anchored horizontal bar: width `pct%` of the column max, `max-width: 80px`, `height: 14px`, background `--accent-2` (units) or `--accent` (net), `opacity: 0.15`, `border-radius: 2px`. Number sits on top (`z-index: 1`, mono tabular).
  - **Margen %:** mono, tabular. Color by threshold: `> 60` → `--up`, `> 50` → `--fg`, else `--warn`.

**Data (8 rows):** see `data.jsx` `TOP_ARTICLES` — `V26100765 Americana 2 Buttons` down through `V26200311 Camiseta Estampada Motos`.

### 10. AI chat sidebar (right drawer)

Fixed `top: 56px, right: 0, bottom: 0, width: 380px`, `background: var(--bg-1)`, `border-left: 1px solid var(--border)`, `z-index: 15`. When open, the main content gets `margin-right: 380px` with `transition: margin 0.2s`.

**Header:**
- Title "Asistente IA" 13px weight 600. Subtitle below: pulsing green dot + `Conectado · claude-sonnet` in 11px `--fg-muted`.
- Close button (`✕`) right-aligned, ghost style.
- **Tabs**: `Modificar` / `Analizar`. Equal flex, 10px top/bottom padding, 12px, 2px accent-colored bottom border on the active tab. Active color `--accent` weight 600; inactive `--fg-muted` weight 500.

**Mode hint:** just below header, `padding: 10px 16px 0`, 11px `--fg-subtle`: "Pide cambios al dashboard." (modificar) or "Pregunta sobre los datos." (analizar).

**Messages area:** flex-column gap 10, padding 16, overflow-y auto.
- User messages right-aligned, background `--accent`, white text, radius 10, padding 10px 12px, 12.5px, line-height 1.5, `max-width: 86%`.
- AI messages left-aligned, background `--bg-2`, color `--fg`, same padding/radius.
- **Above every AI message with logs, render a LogBlock** — a collapsible panel listing the agent's tool/reason/done steps. See §11.
- Each mode has its own message history — switching tabs swaps histories; user messages don't cross-contaminate.

**Initial messages:**
- Analizar: "He analizado los datos del período. Detecté 2 anomalías y 1 alerta de margen. ¿Sobre qué te gustaría profundizar?" with 4 log lines (fetch_widget_data → detect_anomalies → reason → done).
- Modificar: "Puedo modificar este panel: añadir widgets, cambiar comparaciones, filtrar por tienda… dime qué necesitas."

**Suggestion chips above the input** — mode-specific, wrapping, 11px, `padding: 4px 10px`, radius 14, `background: var(--bg-2)`, `border: 1px solid var(--border)`, clickable (sends chip text as input):
- Analizar: `¿Por qué cayeron las ventas?`, `Tiendas con mayor bajada`, `Comparar con Semana Santa 2025`
- Modificar: `Añade widget de margen por familia`, `Cambia comparativa a año anterior`, `Filtra solo tiendas TOP 10`

**Input row:**
- Text input: `background: var(--bg-2)`, `border: 1px solid var(--border)`, radius 6, padding 8px 10px, 12px. Placeholder depends on mode.
- `Enviar` primary button: `btn("primary")` — `background: var(--accent)`, white, radius 6, padding 0 12px, 32px tall.
- Enter key sends.

### 11. LogBlock (agent-run transparency)

Every AI response is accompanied by a log of what the agent did. There are **two display states** — they must behave differently:

**While streaming (before the reply text arrives):**
- Mount a standalone "pending" LogBlock just below the user's message (no text bubble yet).
- Fixed-expanded, dashed border (`border: 1px dashed var(--border-strong)`), `background: var(--bg-2)`, radius 8, padding 8px 10px, JetBrains Mono 10.5px `--fg-muted`.
- Header row: 10px uppercase `--fg-subtle` letter-spacing 0.08em, pulsing accent dot + `Procesando · {n} paso{s}`.
- Lines appear one-by-one every ~420ms (simulate agentic work). Latest line gets a trailing pulsing accent dot.

**After streaming completes:**
- Replaces the pending block with a final LogBlock **collapsed by default**, placed immediately *above* the AI message bubble.
- Collapsed state is just a single toggle: `▸ VER LOGS (N)` — JetBrains Mono 10px `--fg-subtle`, uppercase, letter-spacing 0.08em, transparent button.
- Expanded: same dashed-look panel, toggle rotates 90° to point down, text changes to `OCULTAR LOGS`.

**Log line format:** grid `42px 14px 1fr` gap 6, line-height 1.45.
- Column 1: timestamp `+N.Ns` in `--fg-subtle`.
- Column 2: a 14px centered icon, colored by kind:
  - `tool` → `⌬` in `--accent-2`
  - `reason` → `✦` in `--accent`
  - `done` → `✓` in `--up`
  - fallback `·` in `--fg-subtle`
- Column 3: `label` in `--fg` + `· detail` in `--fg-subtle`.

**Log sequences** per mode (use as starting scripts — the real backend will stream genuine tool calls):

Analizar:
1. `+0.0s tool parse_intent · intent=why_drop · scope=tickets`
2. `+0.3s tool fetch_widget_data · 6 widgets · 2.3 MB`
3. `+0.9s tool run_sql · SELECT store, SUM(net) FROM sales …`
4. `+1.4s reason Razonando · Semana Santa desplazada · ajustar comparable`
5. `+2.1s tool detect_anomalies · z > 2.5 · tiendas 804, 159`
6. `+2.7s done Respuesta lista · 1.984 tokens · claude-sonnet-4.5`

Modificar:
1. `+0.0s tool parse_request · op=add_widget · target=margen`
2. `+0.4s tool lookup_schema · table=sales · col=margin_pct`
3. `+1.0s reason Generando spec · bar_chart · groupBy=familia`
4. `+1.6s tool validate_sql · OK · 0 errors`
5. `+2.0s done Dashboard modificado · +1 widget · persistido`

### 12. "Analizar con IA" floating launcher

When the chat sidebar is closed, a vertical tab clings to the right edge of the viewport:

- Position `fixed, right: 0, top: 42%`, `z-index: 14`.
- `background: var(--accent)`, white, `padding: 16px 12px`, `border-radius: 10px 0 0 10px` (top-left + bottom-left rounded).
- Text runs vertical: `writing-mode: vertical-rl; transform: rotate(180deg)` on the container, then an inner span `transform: rotate(180deg)` unrotates the ✦ glyph so it reads naturally.
- Content: `✦ Analizar con IA` (12px weight 600, letter-spacing 0.04em).
- Shadow: `0 8px 24px -6px rgba(0,0,0,0.4)`.
- Click → opens sidebar in `analizar` mode.

When the sidebar is open, this rail is hidden (the sidebar itself provides the close affordance).

### 13. Tweaks panel (floating, optional exposure to end users)

Opened via the top-bar cog. Uses the project's existing `<TweaksPanel>` pattern. Four controls, all radio-style:

1. **Tema**: Oscuro / Claro (sets `body[data-theme]`)
2. **Acento**: Eléctrico / Cítrico / Magenta / Mono (sets `body[data-accent]`)
3. **Densidad**: Compacto / Cómodo / Amplio (sets `body[data-density]`)
4. **Estilo KPI**: Editorial / Destacado / Mínimo (local to the KpiCard component)

Defaults: dark / electric / comfort / editorial.

You can decide whether to expose all four in production or lock them behind an admin flag. At minimum, the light/dark toggle should stay.

---

## Interactions & Behavior

- **Date switcher**: the popover is the full interaction — preset buttons set the active state but don't auto-close; custom-range inputs switch the active to "Rango personalizado"; the `Aplicar` button closes and emits the change. Click-outside closes without applying. Wire up to existing `handleDateRangeChange` / `handleGlobalFilterChange` in `dashboard/app/dashboard/[id]/page.tsx`, including the `curr_from/curr_to/comp_from/comp_to` URL deep-link support.
- **Filter pills**: each `<select>` change fires the existing `handleGlobalFilterChange`.
- **KPI hover**: no special interaction required. Anomaly cards already draw the eye with their red ring + pulsing dot.
- **Line chart hover**: mousemove over the SVG snaps to nearest data index, draws the crosshair, shows tooltip. Leave clears.
- **Bar chart hover**: per-group invisible hitbox, tooltip top-right of panel.
- **Donut hover**: arc widens +3px, legend fades non-hovered to 0.5, center readout swaps.
- **Articles table**: hover row could add `background: var(--bg-2)` (not in prototype; add for polish). Click on a row should fire `onDataPointClick` with a drill-down context — see `handleDataPointClick` in the original page.tsx.
- **Chat sidebar open/close**: animated `margin-right` 200ms on main. Sidebar tabs swap message histories. Sending a message streams the log lines, then replaces the pending log block with the final collapsed one + text bubble.
- **Log blocks**: collapsed → expanded smoothly (the toggle arrow rotates via `transition: transform 0.15s`).
- **Auto-refresh**: keep the existing interval logic (`autoRefreshRef`, `countdownRef`). The "Datos al día · hace Nm" text in the top bar replaces the former "Última actualización" / countdown mini-UI. A small countdown can appear next to the status dot when auto-refresh is on.
- **Tab accessibility**: all buttons are `<button type="button">` with readable text content. Preserve the `aria-label`s from the original `page.tsx` (they're in Spanish).

## State Management

Carry over everything from the original `page.tsx` — the redesign doesn't change the data model. New or reshaped state:

- `chatOpen: boolean` — drawer open state.
- `chatMode: "modificar" | "analizar"` — which tab is active. `"analizar"` on first open from the floating rail; last-used after that.
- `messagesByMode: Record<Mode, Message[]>` — separate histories per tab (or keep two arrays as in the prototype). Persist to the same `chat_messages_analyze` storage as today; add `chat_messages_modificar` if you want persistent Modificar history too (optional).
- `streamingLog: { messageIdx, lines, done } | null` — drives the pending LogBlock while the agent works.
- `expandedLogs: Record<number, boolean>` — which post-delivery log blocks are expanded.
- `tweaks: { theme, accent, density, kpiStyle }` — localStorage-backed preferences.

## Screenshots

Four reference captures in `screenshots/` (dark theme, 1000×~620):

| File | Shows |
|---|---|
| `01-overview-dark.png` | Top bar, page header, filter strip, KPI row (two anomaly cards + two normal), insights strip |
| `02-charts-and-table.png` | Weekly trend line chart with comparison overlay, payment-mix donut, store comparison bars, margin ranked bars, top articles table with heat cells |
| `03-chat-sidebar-open.png` | AI chat sidebar with Modificar / Analizar tabs, collapsed log block above initial AI message, suggestion chips, input row |
| `04-date-picker-popover.png` | Date switcher popover: Período actual / Período anterior presets, custom range inputs, Aplicar, Período de comparación select |

The prototype also supports a light theme (via `body[data-theme="light"]`) and four accent variants (electric / citrus / magenta / mono) — not shown in screenshots but fully spec'd in the tokens section above.

## Files

Design reference files in this bundle:

| File | What it contains |
|---|---|
| `Powershop Redesign.html` | Entry HTML, font loads, CSS variables + theme definitions, mounts the React app |
| `app.jsx` | Top-level `<App>` — layout grid, tweak wiring |
| `parts.jsx` | `TopBar`, `PageHeader`, `DateSwitcher`, `FilterStrip`, `Panel`, `KpiCard` (3 styles), `InsightsStrip`, `ArticlesTable`, `ChatSidebar`, `LogBlock`, `AnalyzeLauncher` |
| `charts.jsx` | `Sparkline`, `CompareBarChart`, `RankedBars`, `LineChart`, `Donut`, formatters (`fmtEUR`, `fmtInt`, `fmtPct`, `fmtDelta`) |
| `data.jsx` | Realistic mock data mirroring the real dashboard values |
| `tweaks-panel.jsx` | Starter tweaks panel scaffolding (can be dropped in production) |

Real codebase files you'll be editing:

| File | Change |
|---|---|
| `dashboard/app/dashboard/[id]/page.tsx` | Top bar, page header (H1 + breadcrumbs + description), filter strip wiring, chat sidebar trigger/launcher, removal of top-bar chat button in favor of floating rail |
| `dashboard/app/layout.tsx` or `globals.css` | Add Inter + JetBrains Mono from Google Fonts; add the CSS variables layer; set `font-variant-numeric: tabular-nums` on body |
| `dashboard/components/DateRangePicker.tsx` | Rebuild popover as specified (two-column preset grid + custom range + comparison footer) |
| `dashboard/components/DashboardFiltersBar.tsx` | Restyle as pill-group |
| `dashboard/components/DashboardRenderer.tsx` + `dashboard/components/widgets/*` | Re-skin KPI widget (editorial + two alternates), line chart, bar chart, donut, ranked bars; add heat-bar support in the articles table widget |
| `dashboard/components/ChatSidebar.tsx` | Two-tab header with distinct suggestion chips; integrate LogBlock (streaming + collapsed); wire streaming from the existing `runDashboardGenerateStream` helper |
| New: `dashboard/components/LogBlock.tsx` | Render streaming and post-delivery log variants |
| New: `dashboard/components/AnalyzeLauncher.tsx` | Floating right-edge rail |
| `dashboard/components/widgets/chart-colors.ts` | Replace the current Tremor-name palette with the accent-driven palette (accent, accent-2, amber, pink, emerald for categorical; `--up`, `--down`, `--warn` for semantic) |
| Navigation (wherever the main nav is defined) | Remove `ETL` from the primary nav; add `Admin` in the top bar right cluster |

## Assets

No external image assets. The only bespoke SVG is the **Powershop logo** — a 24×24 lightning bolt at `M4 2 L14 2 L20 11 L10 22 L4 22 L4 13 L11 13 L8 9 L4 9 Z`, filled with the current `--accent`. The electrical-bolt icon doubles as a reminder that `Powershop` is a retail-power-brand, not an invented name.

## Notes on Spanish copy

All visible strings in the prototype are production-ready Spanish. Do not translate. Key strings:

- H1 suffix: `— Ventas Retail` (em-dash, not hyphen)
- `EN VIVO` badge
- `Datos al día · hace 12m` (connect to real freshness timestamp)
- `Analizar con IA` (vertical rail)
- Anomaly badge: `ANOMALÍA DETECTADA`
- Section labels are JetBrains Mono uppercase and keep their accents: `FILTROS`, `RANK`, `REFERENCIA`, `DESCRIPCIÓN`, etc.

## Things intentionally *not* in this design

- No emoji in production UI (only the Unicode arrow/symbol set listed).
- No gradient backgrounds on cards (only the single `<linearGradient>` under the line chart).
- No rounded-corner-with-left-border-accent pattern.
- No hand-drawn illustration SVGs.
- No additional content / filler sections beyond what's listed.

If the existing codebase has widgets not covered here (scatter plot, pivot table, etc.), apply the same token system and Panel chrome; ask for specific redesign direction before inventing new visuals.
