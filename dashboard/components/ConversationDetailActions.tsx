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

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

interface ConversationDetailActionsProps {
  conversationId: string;
  /** Current title, or null when untitled. */
  initialTitle: string | null;
  /** Non-null when the conversation is archived. */
  initialArchivedAt: string | null;
  /** `"global"` conversations have no native context to open. */
  contextKind: string | null;
}

export function ConversationDetailActions({
  conversationId,
  initialTitle,
  initialArchivedAt,
  contextKind,
}: ConversationDetailActionsProps) {
  const router = useRouter();
  // Props, not a fetch. This component previously fetched
  // `/api/conversations/:id` on mount, which returns the FULL message history
  // — the same payload ConversationPane already loads, so opening any
  // conversation cost it twice, on every viewport. Desktop paid it purely for
  // a strip that `md:hidden` never shows, and the payload scales with
  // conversation length. The page is an async server component that already
  // has the id, so it reads the three scalars once, server-side.
  const [title, setTitle] = useState<string | null>(initialTitle);
  const [archivedAt, setArchivedAt] = useState<string | null>(initialArchivedAt);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const startRename = useCallback(() => {
    // Seed with the real title, NOT the display fallback. Seeding with
    // `getConversationDisplayTitle` put "Sin título" in the box for an
    // untitled conversation, and since "Sin título" !== null the commit guard
    // let it through — so an accidental pencil tap permanently titled the
    // conversation "Sin título".
    setRenameValue(title ?? "");
    setRenaming(true);
  }, [title]);

  const commitRename = useCallback(async () => {
    const next = renameValue.trim();
    if (!next || next === (title ?? "")) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (res.ok) {
        setTitle(next);
      } else {
        // D-047: log the real failure. Swallowing it silently left the user
        // with a control that looked like it had worked.
        console.error(
          `[ConversationDetailActions] rename failed for ${conversationId}: HTTP ${res.status}`,
        );
      }
    } catch (err) {
      console.error(`[ConversationDetailActions] rename error for ${conversationId}:`, err);
    } finally {
      setBusy(false);
      setRenaming(false);
    }
  }, [conversationId, renameValue, title]);

  const toggleArchive = useCallback(async () => {
    const nextArchived = archivedAt === null;
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
        setArchivedAt(null);
      } else {
        console.error(
          `[ConversationDetailActions] archive toggle failed for ${conversationId}: HTTP ${res.status}`,
        );
      }
    } catch (err) {
      console.error(`[ConversationDetailActions] archive error for ${conversationId}:`, err);
    } finally {
      setBusy(false);
    }
  }, [archivedAt, conversationId, router]);

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
            // Was a fixed 150px, which pushed the ✓ button 18px past a 320px
            // viewport — and ✓ was the only way out of rename mode. Flex lets
            // the row fit any width.
            flex: 1,
            minWidth: 0,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="conv-detail-action-btn"
          onClick={commitRename}
          disabled={busy}
          title="Guardar"
          aria-label="Guardar"
          data-testid="conv-detail-rename-save"
        >
          ✓
        </button>
        {/* A phone soft keyboard has no Escape key and there is no onBlur
            handler, so without this the ONLY exit from rename mode was
            committing. */}
        <button
          type="button"
          className="conv-detail-action-btn"
          onClick={() => setRenaming(false)}
          disabled={busy}
          title="Cancelar"
          aria-label="Cancelar"
          data-testid="conv-detail-rename-cancel"
        >
          ✗
        </button>
      </div>
    );
  }

  const isArchived = archivedAt !== null;
  const isGlobal = contextKind === "global";

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
