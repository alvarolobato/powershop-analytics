"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConversationsTable } from "@/components/ConversationsTable";
import type { ConversationRow } from "@/app/conversations/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODES = ["generate", "modify", "analyze", "suggest", "gap", "summary", "title"];
const CONTEXT_KINDS = ["dashboard", "home", "admin", "global"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApiUrl(params: {
  q: string;
  modes: string[];
  contextKinds: string[];
  since: string;
  includeArchived: boolean;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  params.modes.forEach((m) => sp.append("mode", m));
  params.contextKinds.forEach((k) => sp.append("context_kind", k));
  if (params.since) sp.set("since", params.since);
  if (params.includeArchived) sp.set("include_archived", "true");
  sp.set("limit", "100");
  const qs = sp.toString();
  return `/api/conversations${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// Filter bar sub-component
// ---------------------------------------------------------------------------

interface FilterBarProps {
  q: string;
  modes: string[];
  contextKinds: string[];
  since: string;
  includeArchived: boolean;
  onQChange: (v: string) => void;
  onModesChange: (v: string[]) => void;
  onContextKindsChange: (v: string[]) => void;
  onSinceChange: (v: string) => void;
  onIncludeArchivedChange: (v: boolean) => void;
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function FilterBar({
  q,
  modes,
  contextKinds,
  since,
  includeArchived,
  onQChange,
  onModesChange,
  onContextKindsChange,
  onSinceChange,
  onIncludeArchivedChange,
}: FilterBarProps) {
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--fg)",
    fontSize: 12,
    padding: "5px 10px",
    outline: "none",
    fontFamily: "inherit",
    height: 30,
  };

  const pillBtn = (
    label: string,
    active: boolean,
    onClick: () => void,
    testId?: string
  ) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        background: active ? "var(--accent)" : "var(--bg-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        color: active ? "var(--accent-fg, #fff)" : "var(--fg-muted)",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
        padding: "10px 20px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
      data-testid="filter-bar"
    >
      {/* Search */}
      <input
        type="search"
        placeholder="Buscar…"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        style={{ ...inputStyle, width: 180 }}
        data-testid="search-input"
        aria-label="Buscar conversaciones"
      />

      {/* Mode multi-select */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}
        data-testid="mode-filter"
      >
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Tipo:</span>
        {MODES.map((m) =>
          pillBtn(m, modes.includes(m), () => onModesChange(toggleArrayItem(modes, m)), `mode-filter-${m}`)
        )}
      </div>

      {/* Context kind multi-select */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}
        data-testid="context-kind-filter"
      >
        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Contexto:</span>
        {CONTEXT_KINDS.map((k) =>
          pillBtn(k, contextKinds.includes(k), () => onContextKindsChange(toggleArrayItem(contextKinds, k)), `context-kind-filter-${k}`)
        )}
      </div>

      {/* Since date */}
      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--fg-muted)" }}
      >
        Desde:
        <input
          type="date"
          value={since}
          onChange={(e) => onSinceChange(e.target.value)}
          style={{ ...inputStyle, width: 130 }}
          data-testid="since-input"
          aria-label="Desde fecha"
        />
      </label>

      {/* Mostrar archivadas toggle */}
      <label
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--fg-muted)" }}
        data-testid="archived-toggle-label"
      >
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => onIncludeArchivedChange(e.target.checked)}
          data-testid="archived-toggle"
          style={{ cursor: "pointer" }}
        />
        Mostrar archivadas
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ConversationsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read filter state from URL
  const [q, setQ] = useState(() => searchParams?.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(() => searchParams?.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [modes, setModes] = useState<string[]>(() =>
    searchParams?.getAll("mode") ?? []
  );
  const [contextKinds, setContextKinds] = useState<string[]>(() =>
    searchParams?.getAll("context_kind") ?? []
  );
  const [since, setSince] = useState(() => searchParams?.get("since") ?? "");
  const [includeArchived, setIncludeArchived] = useState(
    () => searchParams?.get("archived") === "1"
  );

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persist filter state to URL
  const persistFilters = useCallback(
    (next: {
      q: string;
      modes: string[];
      contextKinds: string[];
      since: string;
      includeArchived: boolean;
    }) => {
      const params = new URLSearchParams();
      if (next.q) params.set("q", next.q);
      next.modes.forEach((m) => params.append("mode", m));
      next.contextKinds.forEach((k) => params.append("context_kind", k));
      if (next.since) params.set("since", next.since);
      if (next.includeArchived) params.set("archived", "1");
      router.replace(`/conversations?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  // Setters that also persist to URL
  const handleQChange = useCallback(
    (v: string) => {
      setQ(v);
      persistFilters({ q: v, modes, contextKinds, since, includeArchived });
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setDebouncedQ(v), 350);
    },
    [modes, contextKinds, since, includeArchived, persistFilters]
  );
  const handleModesChange = useCallback(
    (v: string[]) => {
      setModes(v);
      persistFilters({ q, modes: v, contextKinds, since, includeArchived });
    },
    [q, contextKinds, since, includeArchived, persistFilters]
  );
  const handleContextKindsChange = useCallback(
    (v: string[]) => {
      setContextKinds(v);
      persistFilters({ q, modes, contextKinds: v, since, includeArchived });
    },
    [q, modes, since, includeArchived, persistFilters]
  );
  const handleSinceChange = useCallback(
    (v: string) => {
      setSince(v);
      persistFilters({ q, modes, contextKinds, since: v, includeArchived });
    },
    [q, modes, contextKinds, includeArchived, persistFilters]
  );
  const handleIncludeArchivedChange = useCallback(
    (v: boolean) => {
      setIncludeArchived(v);
      persistFilters({ q, modes, contextKinds, since, includeArchived: v });
    },
    [q, modes, contextKinds, since, persistFilters]
  );

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = buildApiUrl({ q: debouncedQ, modes, contextKinds, since, includeArchived });
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          // API not yet available (Task 2 not merged)
          setConversations([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : data.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar conversaciones");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, modes, contextKinds, since, includeArchived]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Archive toggle
  const handleArchiveToggle = useCallback(
    async (id: string, currentlyArchived: boolean) => {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: !currentlyArchived }),
        });
        if (res.ok) {
          // Update local state
          setConversations((prev) =>
            prev.map((c) =>
              c.id === id
                ? {
                    ...c,
                    archived_at: currentlyArchived
                      ? null
                      : new Date().toISOString(),
                  }
                : c
            )
          );
          // If not showing archived, remove the row from view when archiving
          if (!includeArchived && !currentlyArchived) {
            setConversations((prev) => prev.filter((c) => c.id !== id));
          }
        }
      } catch {
        // Ignore network errors — local state was already updated above if res.ok
      }
    },
    [includeArchived]
  );

  // Rename
  const handleRename = useCallback(async (id: string, title: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title } : c))
        );
      }
    } catch {
      // Ignore
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--fg)",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Conversaciones
          </h1>
          <p style={{ marginTop: 3, fontSize: 12, color: "var(--fg-muted)", margin: "3px 0 0" }}>
            Historial de todas las interacciones con la IA
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        q={q}
        modes={modes}
        contextKinds={contextKinds}
        since={since}
        includeArchived={includeArchived}
        onQChange={handleQChange}
        onModesChange={handleModesChange}
        onContextKindsChange={handleContextKindsChange}
        onSinceChange={handleSinceChange}
        onIncludeArchivedChange={handleIncludeArchivedChange}
      />

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 20px 24px" }}>
        {loading && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "48px 0",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "3px solid var(--border)",
                borderTopColor: "var(--accent)",
                animation: "spin 0.8s linear infinite",
              }}
              role="status"
              aria-label="Cargando"
            />
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              padding: "24px",
              color: "var(--down)",
              fontSize: 13,
              background: "var(--down-bg)",
              borderRadius: 6,
            }}
            data-testid="error-message"
          >
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <ConversationsTable
            conversations={conversations}
            onArchiveToggle={handleArchiveToggle}
            onRename={handleRename}
          />
        )}
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense>
      <ConversationsPageContent />
    </Suspense>
  );
}
