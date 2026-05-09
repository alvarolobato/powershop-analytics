import { notFound } from "next/navigation";
import { ConversationViewer } from "@/components/ConversationViewer";
import { fetchConversation } from "@/lib/conversation-api";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationChatPage({ params }: PageProps) {
  const { id } = await params;
  const conv = await fetchConversation(id);
  if (!conv) notFound();

  return (
    <div
      style={{
        height: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <ConversationViewer initial={conv} />
    </div>
  );
}
