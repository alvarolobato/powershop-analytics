import { notFound } from "next/navigation";
import { ConversationViewer } from "@/components/ConversationViewer";
import { ConversationListSidebar } from "@/components/ConversationListSidebar";
import { fetchConversation } from "@/lib/conversation-api";

// Must be dynamic: data depends on the conversation ID and search params.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}

export default async function ConversationSplitViewPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { q } = await searchParams;

  const conv = await fetchConversation(id);
  if (!conv) notFound();

  const autoSendPrompt = typeof q === "string" && q.trim() ? q : undefined;

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
        <ConversationViewer initial={conv} autoSendPrompt={autoSendPrompt} />
      </div>
    </div>
  );
}
