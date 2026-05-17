import { notFound } from "next/navigation";
import { ConversationViewer } from "@/components/ConversationViewer";
import { ConversationListSidebar } from "@/components/ConversationListSidebar";
import { fetchConversation } from "@/lib/conversation-api";

// Must be dynamic: data depends on the conversation ID and search params.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationSplitViewPage({ params }: PageProps) {
  const { id } = await params;

  const conv = await fetchConversation(id);
  if (!conv) notFound();

  return (
    <div
      style={{
        display: "flex",
        // The root layout's <main> has .main-content padding: 20px on all sides.
        // Negate it so this page is full-bleed and exactly fills the viewport
        // below the 56px TopBar. Without this, height: calc(100vh - 56px) makes
        // the content 40px taller than the available space and the page scrolls.
        margin: -20,
        width: "calc(100% + 40px)",
        height: "calc(100vh - 56px)",
        overflow: "hidden",
      }}
    >
      {/* Left panel: conversation list */}
      <ConversationListSidebar selectedId={id} />

      {/* Right panel: conversation detail */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ConversationViewer initial={conv} />
      </div>
    </div>
  );
}
