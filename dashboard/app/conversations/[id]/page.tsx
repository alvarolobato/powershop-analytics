import Link from "next/link";
import { ConversationListSidebar } from "@/components/ConversationListSidebar";
import { ConversationPane } from "@/components/ConversationPane";
import { ConversationDetailActions } from "@/components/ConversationDetailActions";
import { getConversation } from "@/lib/conversations";

// Must be dynamic: data depends on the conversation ID.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationSplitViewPage({ params }: PageProps) {
  const { id } = await params;
  // Scalars for the phone action strip, read server-side. `getConversation`
  // does NOT load messages — the strip needs three fields, and fetching the
  // full conversation client-side doubled the payload of every page load.
  const conv = await getConversation(id);

  return (
    <div
      style={{
        display: "flex",
        // The root layout's <main> has .main-content padding: --pad on all
        // sides, and below 768px only left/right narrow to --pad-x (see
        // globals.css). Negate it so this page is full-bleed and exactly
        // fills the viewport below the 56px TopBar. Mobile item 7: the
        // hardcoded -20/+40 only cancelled correctly at desktop's
        // --pad-x === --pad coincidence — on phone --pad-x is 12 while
        // --pad stays 20, so a flat -20 overshot the actual left/right
        // padding by 8px per side. calc() against the real tokens tracks
        // both breakpoints instead of one.
        marginTop: "calc(-1 * var(--pad, 20px))",
        marginBottom: "calc(-1 * var(--pad, 20px))",
        marginLeft: "calc(-1 * var(--pad-x, 20px))",
        marginRight: "calc(-1 * var(--pad-x, 20px))",
        width: "calc(100% + 2 * var(--pad-x, 20px))",
        // 100dvh, not 100vh (PR #894 review, finding 3): same iOS Safari
        // fix as `.app-shell` in globals.css — this div owns its own
        // scroll, so the stale vh literal under-computed available height
        // and left the composer under the fold when the toolbar collapsed.
        height: "calc(100dvh - 56px)",
        overflow: "hidden",
      }}
    >
      {/* Left panel: conversation list — hidden below md (see
          ConversationListSidebar's own `hidden md:flex`). */}
      <ConversationListSidebar selectedId={id} />

      {/* Right panel: conversation detail */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Mobile item 7: with the sidebar hidden below md there is no way
            back to the list, so a phone-only back-link takes its place —
            `flex md:hidden` (Tailwind owns display, nothing inline on this
            element collides — D-120), 44px min-height tap target. */}
        {/* The strip also carries the per-row actions the list drops below
            `md` (rename / archive / open-in-context) — hence `justify-content:
            space-between` rather than the bare link this used to be. */}
        <div
          className="flex md:hidden"
          style={{
            alignItems: "center",
            gap: 8,
            padding: "0 var(--pad-x, 20px)",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Link
            href="/conversations"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              color: "var(--fg-muted)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: "nowrap",
              // Yields space to the action strip when it needs it (rename mode
              // on a narrow phone); without this the link held its full width
              // and pushed the rename controls off-screen.
              flexShrink: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            ← Conversaciones
          </Link>
          <ConversationDetailActions
            conversationId={id}
            initialTitle={conv?.title ?? null}
            initialArchivedAt={conv?.archived_at ?? null}
            contextKind={conv?.context_kind ?? null}
          />
        </div>
        <ConversationPane mode="standalone" conversationId={id} />
      </div>
    </div>
  );
}
