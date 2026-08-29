"use client";

/**
 * Phone-only action strip for `/conversations/[id]`.
 *
 * The conversations list drops its per-row controls below `md` — the
 * checkbox column, the ✎ rename glyph and the Acciones column together ate
 * ~190px of a 390px viewport for targets that were either too small to tap
 * (the 12px pencil) or duplicated navigation the title already does. This
 * is where those actions live instead, reachable once you are inside the
 * conversation.
 *
 * Desktop renders nothing: the caller wraps this in `md:hidden` and the
 * list's own Acciones column is still there.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getConversationDisplayTitle } from "@/lib/conversation-types";
import type { ConversationRow } from "@/app/conversations/types";

interface ConversationDetailActionsProps {
  conversationId: string;
}

export function ConversationDetailActions({
  conversationId,
}: ConversationDetailActionsProps) {
  const router = useRouter();
  const [conv, setConv] = useState<ConversationRow | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setConv(body as ConversationRow);
      } catch {
        // Non-fatal: the strip simply doesn't render. The conversation
        // itself is already on screen and unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const startRename = useCallback(() => {
    if (!conv) return;
    setRenameValue(getConversationDisplayTitle(conv));
    setRenaming(true);
  }, [conv]);

  const commitRename = useCallback(async () => {
    const title = renameValue.trim();
    if (!conv || !title || title === conv.title) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) setConv((prev) => (prev ? { ...prev, title } : prev));
    } catch {
      // Leave the old title in place; nothing destructive happened.
    } finally {
      setBusy(false);
      setRenaming(false);
    }
  }, [conv, conversationId, renameValue]);

  const toggleArchive = useCallback(async () => {
    if (!conv) return;
    const nextArchived = conv.archived_at === null;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      });
      if (res.ok) {
        // Archiving removes it from the default list view, so going back to
        // a list that no longer contains it is the honest destination.
        if (nextArchived) {
          router.push("/conversations");
          return;
        }
        setConv((prev) => (prev ? { ...prev, archived_at: null } : prev));
      }
    } catch {
      // Ignore — the button simply appears not to have worked.
    } finally {
      setBusy(false);
    }
  }, [conv, conversationId, router]);

  if (!conv) return null;

  if (renaming) {
    return (
      <div className="conv-detail-actions" data-testid="conv-detail-renaming">
        <input
          type="text"
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          aria-label="Nuevo título"
          data-testid="conv-detail-rename-input"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            color: "var(--fg)",
            fontSize: 16, // 16px avoids iOS's focus zoom
            padding: "0 8px",
            minHeight: 44,
            width: 150,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="conv-detail-action-btn"
          onClick={commitRename}
          disabled={busy}
          data-testid="conv-detail-rename-save"
        >
          ✓
        </button>
      </div>
    );
  }

  const isArchived = conv.archived_at !== null;
  const isGlobal = conv.context_kind === "global";

  return (
    <div className="conv-detail-actions" data-testid="conv-detail-actions">
      <button
        type="button"
        className="conv-detail-action-btn"
        onClick={startRename}
        disabled={busy}
        title="Renombrar"
        aria-label="Renombrar"
        data-testid="conv-detail-rename-btn"
      >
        ✎
      </button>

      <button
        type="button"
        className="conv-detail-action-btn"
        onClick={toggleArchive}
        disabled={busy}
        title={isArchived ? "Desarchivar" : "Archivar"}
        aria-label={isArchived ? "Desarchivar" : "Archivar"}
        data-testid="conv-detail-archive-btn"
      >
        {isArchived ? "↩" : "🗄"}
      </button>

      <button
        type="button"
        className="conv-detail-action-btn"
        onClick={() => router.push(`/k/${conversationId}`)}
        disabled={isGlobal || busy}
        title={isGlobal ? "Sin contexto nativo para esta conversación" : "Abrir en contexto"}
        aria-label="Abrir en contexto"
        data-testid="conv-detail-context-btn"
      >
        ⊞
      </button>
    </div>
  );
}
