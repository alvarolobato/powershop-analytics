"use client";

/**
 * OpenRouterModelCombobox — searchable picker for the OpenRouter model
 * catalog, used by the admin /config form for `dashboard.llm_model_openrouter`.
 *
 * UX:
 *  - Closed: shows the current model id (or "Selecciona modelo") with a chevron.
 *  - Opens on click → search input + filtered list of model rows.
 *  - "Populares" section is pinned at the top (curated by the API). The
 *    rest are shown alphabetically by id.
 *  - Each row shows: human name (`name`), id, context window, $/M prompt
 *    and completion, modality, and a "Tools" badge when supported (the
 *    agentic dashboard flows require tool calling).
 *  - Keyboard: ArrowUp/ArrowDown move highlight, Enter selects, Esc closes.
 *  - Outside click closes without saving.
 *
 * Catalog data is fetched once per mount from `/api/admin/openrouter-models`
 * (cached server-side for an hour). If the fetch fails, the component
 * degrades to a plain text input so saving still works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  prompt_price_per_1m: number | null;
  completion_price_per_1m: number | null;
  modality: string;
  supports_tools: boolean;
  popular: boolean;
}

interface CatalogResponse {
  models: OpenRouterModel[];
  cached_at: string;
  source: "openrouter" | "cache";
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUSD(n: number | null): string {
  if (n == null) return "–";
  if (n === 0) return "gratis";
  // Use enough decimals to show small models meaningfully (e.g. $0.06/M).
  const fixed = n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3);
  return `$${fixed}`;
}

function fmtCtx(n: number): string {
  if (n <= 0) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function matches(model: OpenRouterModel, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    model.id.toLowerCase().includes(needle) ||
    model.name.toLowerCase().includes(needle) ||
    model.description.toLowerCase().includes(needle)
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OpenRouterModelCombobox({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Fetch the catalog on first mount. Keep the result for the page lifetime.
  useEffect(() => {
    if (models !== null || error !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/openrouter-models");
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as CatalogResponse;
        if (!cancelled) setModels(json.models);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [models, error]);

  // Outside-click closes without saving.
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Auto-focus the search input when the panel opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    if (!models) return { popular: [], rest: [] };
    const popular: OpenRouterModel[] = [];
    const rest: OpenRouterModel[] = [];
    for (const m of models) {
      if (!matches(m, query)) continue;
      if (m.popular) popular.push(m);
      else rest.push(m);
    }
    // Popular order: keep API order (curated). Rest: alphabetical by id.
    rest.sort((a, b) => a.id.localeCompare(b.id));
    return { popular, rest };
  }, [models, query]);

  // Flat list for keyboard navigation (popular first).
  const flat = useMemo(
    () => [...filtered.popular, ...filtered.rest],
    [filtered],
  );

  // Reset highlight when filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, models]);

  const onPick = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const m = flat[highlight];
      if (m) onPick(m.id);
    }
  }

  // If the catalog failed to load, fall back to a plain text input — saving
  // a custom model id is still possible.
  if (error) {
    return (
      <div className="space-y-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="anthropic/claude-sonnet-4"
          className="w-full rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No se pudo cargar el catálogo de OpenRouter ({error}). Introduce el id manualmente.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative" data-testid="or-model-combobox">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-1.5 text-sm text-left focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-mono text-xs">
          {value || <span className="italic text-tremor-content-subtle">Selecciona modelo</span>}
        </span>
        <span aria-hidden className="text-tremor-content-subtle">▾</span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-30 mt-1 max-h-[420px] overflow-hidden rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background shadow-lg"
          role="listbox"
        >
          <div className="border-b border-tremor-border dark:border-dark-tremor-border p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Buscar por nombre, id o descripción…"
              className="w-full rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              data-testid="or-model-combobox-search"
            />
            {models === null && (
              <p className="mt-1 text-xs text-tremor-content-subtle">Cargando catálogo…</p>
            )}
            {models !== null && (
              <p className="mt-1 text-xs text-tremor-content-subtle">
                {filtered.popular.length + filtered.rest.length} modelos · precios en USD por 1M de tokens
              </p>
            )}
          </div>

          <div ref={listRef} className="max-h-[340px] overflow-y-auto">
            {filtered.popular.length > 0 && (
              <Section title="Populares" rows={filtered.popular} indexBase={0} value={value} highlight={highlight} onPick={onPick} />
            )}
            {filtered.rest.length > 0 && (
              <Section
                title="Todos"
                rows={filtered.rest}
                indexBase={filtered.popular.length}
                value={value}
                highlight={highlight}
                onPick={onPick}
              />
            )}
            {models !== null && filtered.popular.length + filtered.rest.length === 0 && (
              <p className="px-3 py-4 text-sm text-tremor-content-subtle">
                Ningún modelo coincide con la búsqueda.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  rows: OpenRouterModel[];
  indexBase: number;
  value: string;
  highlight: number;
  onPick: (id: string) => void;
}

function Section({ title, rows, indexBase, value, highlight, onPick }: SectionProps) {
  return (
    <div>
      <div className="sticky top-0 bg-tremor-background dark:bg-dark-tremor-background px-3 py-1 text-xs font-semibold uppercase tracking-wider text-tremor-content-subtle">
        {title}
      </div>
      {rows.map((m, i) => {
        const flatIndex = indexBase + i;
        const isCurrent = m.id === value;
        const isHighlight = flatIndex === highlight;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m.id)}
            className={
              "block w-full px-3 py-2 text-left text-sm hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle " +
              (isHighlight
                ? "bg-tremor-background-subtle dark:bg-dark-tremor-background-subtle "
                : "") +
              (isCurrent ? "ring-1 ring-blue-500 ring-inset" : "")
            }
            data-testid={`or-model-row-${m.id}`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium">{m.name}</span>
              <span className="font-mono text-xs text-tremor-content-subtle">{m.id}</span>
              {m.supports_tools && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  tools
                </span>
              )}
              {isCurrent && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0 text-[10px] text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  actual
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-tremor-content-subtle">
              <span>ctx {fmtCtx(m.context_length)}</span>
              <span>
                in {fmtUSD(m.prompt_price_per_1m)} / out {fmtUSD(m.completion_price_per_1m)}
              </span>
              <span>{m.modality}</span>
            </div>
            {m.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-tremor-content-subtle">{m.description}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
