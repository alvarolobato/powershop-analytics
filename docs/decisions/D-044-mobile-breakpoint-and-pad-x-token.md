---
id: D-044
title: Mobile breakpoint is Tailwind md (768px); horizontal padding shrink goes through one --pad-x token
date: 2026-08-28
---

# D-044: Mobile breakpoint is Tailwind md (768px); horizontal padding shrink goes through one `--pad-x` token

*Decided: 2026-08-28*

**Context**: The dashboard had zero width breakpoints (`globals.css` had
exactly one media query, `@media print`) and `TopBar.tsx` had no responsive
treatment at all — at 390px the header overflowed by roughly 264px and
`ConversationsTable`'s `table-layout: fixed` columns collapsed Título to
near-nothing. This PR (mobile-improvements batch, PR 5 of 7) makes the
dashboard shell, the conversations list/detail, and the wide-content
widgets usable on a phone. The design and its traps are carried over from
the sibling `inmo-tool` project, which hit and documented the same shape of
bugs first — see `docs/decisions/D-120-mobile-breakpoint-inline-style-
precedence.md`, `D-121-inline-style-phone-breakpoint-css-vars.md`,
`D-123-fixed-overlay-dvh-safe-area.md`, `D-124-flexwrap-basis-zero-inert.md`
and `D-129-pad-x-horizontal-padding-token.md` in that repo (not copied
here — this project's decisions live under its own IDs).

**Decision**:

1. **Breakpoint**: Tailwind's unmodified default `md:` (`min-width: 768px`)
   is the app's one mobile/desktop split. No `tailwind.config` override.
2. **Inline-style components** (this codebase's dominant pattern —
   `TopBar.tsx`, `ConversationsTable.tsx`, `ConversationRowActions.tsx`,
   `ConversationListSidebar.tsx`, ...): Tailwind's responsive display
   utilities (`hidden`, `md:flex`, `md:inline`, `md:table-cell`, `md:table-
   column`, ...) are the ONLY Tailwind usage for toggling an element across
   the breakpoint, and that element must never also set `display` inline —
   the inline style wins on that property and silently defeats the class
   (hit and fixed twice while building this PR: the hamburger button and
   the avatar both had a stray inline `display: "flex"` alongside their new
   `md:hidden`/`hidden md:flex` classes).
3. **A value that must differ below 768px but isn't display/visibility**
   (padding, a `<col>` width, a tap-target floor): if it's a static literal
   with no prop/state dependency, delete it from the inline `style` object
   and let a class in `globals.css` own it (base rule + `@media (max-width:
   767px)` override) — no specificity fight, no `!important`. This is how
   `.conv-row-action-btn`, `.conv-col-acciones`, `.conv-bulk-btn` and
   `.conv-bulk-cancel` give the conversations list its 44px tap targets
   without costing desktop density (unconditional 44px measured 46→61px
   row height and 90→116px on the Acciones column before being scoped to
   the media query).
4. **`--pad-x` horizontal-padding token**: declared unconditionally on a
   bare `:root { --pad-x: var(--pad); }` rule (so it resolves correctly at
   every width, not just inside a phone media query), then narrowed under
   `@media (max-width: 767px)`. Every shared horizontal-padding layer reads
   it for left/right — `.main-content`, `.admin-chrome-content`
   (`AdminChrome.tsx`'s content div), `.conv-page-header` /
   `.conv-page-content` (`app/conversations/page.tsx`), `.paneles-page`
   (`app/paneles/page.tsx`) — never just the one page a bug report happens
   to name. A single nested card's own padding is not a `--pad-x` consumer
   (trimming those individually doesn't survive the next card that adds
   padding on top of it).
5. **`!important` is reserved for competing against inline styles the app
   doesn't own the call sites of** — used exactly once, for `input, select,
   textarea { font-size: 16px !important }` below 768px, to stop iOS
   Safari's auto-zoom-on-focus (confirmed sub-16px inline `fontSize` on
   live form controls: `NewConversationDialog`'s textarea at 13px,
   `ConversationListSidebar`'s search input at 12px). Never the mechanism
   for ordinary breakpoint divergence (rung 3 supersedes rung 4 there).
6. **A full-screen `position: fixed` overlay** uses `top/left/right: 0` +
   `height: "100dvh"`, never `inset: 0` (behaves like `100vh`, doesn't
   track a dynamic mobile toolbar on some browsers) —
   `NewConversationDialog`'s backdrop. The app shell's own root height
   (`layout.tsx`'s `<body>`) gets the same `100vh; height: 100dvh;` pair
   via a new `.app-shell` class, because `<main>` — not the document —
   scrolls, so `100vh` alone leaves the last ~55px of every screen below
   the fold on iOS Safari.
7. **`viewportFit: "cover"`** is added to the app's `viewport` export
   (`layout.tsx`) — the prerequisite for `env(safe-area-inset-*)` to
   resolve to anything but 0, should a future overlay need it.
8. **Wide SVG-viewBox-scaled charts** (`BarChartWidget`, `LineChartWidget`)
   get a `.scroll-x-wrapper` / `.scroll-x-inner` (480px floor) pair instead
   of shrinking 10px axis labels to ~4px at phone widths — a scrollbar is a
   strictly better failure mode than unreadable text. Applied only where it
   helps: `DonutChartWidget`'s SVG is fixed-pixel-sized (not
   viewBox-scaled) and already wraps its legend; `AreaChartWidget` and
   `etl/EvolutionCharts.tsx` render through Tremor/Recharts, which size
   text independently of container width; `home/DailyTrendChart.tsx`
   already renders its labels as HTML overlays specifically so they aren't
   stretched by the SVG's `preserveAspectRatio="none"` scaling —
   duplicating the fix there would fight an existing, working mitigation.
   `TableWidget.tsx` already had its own `overflowX: "auto"` wrapper.
9. **Every raw `max-width` media query in `globals.css` uses
   `767.98px`, never a bare `767px`** — Tailwind's `md:` utilities are
   `min-width: 768px` with no explicit upper bound, so at a fractional
   viewport (browser zoom, fractional device-pixel scaling) a bare
   `max-width: 767px` can miss a width where `md:hidden`/`md:flex` already
   resolved to the mobile side, letting the display toggle and this file's
   own padding/sizing rules disagree for that one width.

**Alternatives rejected**: a project-specific breakpoint value (no
evidence any screen needs a split other than phone-vs-everything-else);
`--pad-x` defined only inside its own media query (leaves it unresolved at
desktop width, so every call site would need a fallback that is silently
the phone value if a future one forgets it — the same trap D-129 in
`inmo-tool` already documented); duplicating markup behind a display
toggle instead of `hidden`/`md:*` classes (breaks single-match `data-
testid` assumptions in existing e2e specs).

**Rationale**: This project's dashboard shares its shell architecture
(inline-style-first components, the same `.main-content`/density-token
system) with `inmo-tool`, which hit this exact class of bug first and
recorded the fixes as five separate decisions. Following the same
convention here — one breakpoint, Tailwind owns display/visibility only,
static values move to classes, `--pad-x` as the one horizontal-padding
token — means the next mobile-aware screen in this app recognizes the
pattern instead of re-deriving it, and the traps (inline `display`
collisions, a phone-only-scoped custom property, `flex: 1` never wrapping)
don't have to be rediscovered here too.

**See**: `dashboard/app/globals.css`, `dashboard/app/layout.tsx`,
`dashboard/components/TopBar.tsx`, `dashboard/components/ConversationsTable.tsx`,
`dashboard/components/ConversationRowActions.tsx`,
`dashboard/components/ConversationListSidebar.tsx`,
`dashboard/components/NewConversationDialog.tsx`,
`dashboard/app/conversations/[id]/page.tsx`,
`dashboard/e2e/mobile-topbar.spec.ts`, `dashboard/e2e/mobile-conversations.spec.ts`.
