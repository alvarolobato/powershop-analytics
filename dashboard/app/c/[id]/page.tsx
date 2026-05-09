import { notFound } from "next/navigation";
import { ConversationViewer } from "@/components/ConversationViewer";
import type { ConversationWithMessages } from "@/lib/conversation-types";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchConversation(id: string): Promise<ConversationWithMessages | null> {
  try {
    // Use absolute URL for server-side fetch in Next.js
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000";
    const res = await fetch(`${baseUrl}/api/conversations/${id}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as ConversationWithMessages;
  } catch {
    return null;
  }
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
