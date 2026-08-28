import Link from "next/link";
import { ConversationListSidebar } from "@/components/ConversationListSidebar";
import { ConversationPane } from "@/components/ConversationPane";

// Must be dynamic: data depends on the conversation ID.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationSplitViewPage({ params }: PageProps) {
  const { id } = await params;

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
        height: "calc(100vh - 56px)",
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
        <Link
          href="/conversations"
          className="flex md:hidden"
          style={{
            alignItems: "center",
            gap: 6,
            minHeight: 44,
            padding: "0 var(--pad-x, 20px)",
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            color: "var(--fg-muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ← Conversaciones
        </Link>
        <ConversationPane mode="standalone" conversationId={id} />
      </div>
    </div>
  );
}
