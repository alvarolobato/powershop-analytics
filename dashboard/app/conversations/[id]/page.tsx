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
