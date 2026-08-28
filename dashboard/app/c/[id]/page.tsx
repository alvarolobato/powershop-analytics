import { ConversationPane } from "@/components/ConversationPane";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationChatPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div
      style={{
        // 100dvh, not 100vh (PR #894 review, finding 3): 100vh is iOS
        // Safari's address-bar-collapsed viewport, which never collapses
        // here since this div — not the document — owns the scroll. The
        // stale `vh` left the composer under the fold; same fix as
        // `.app-shell` in globals.css.
        height: "calc(100dvh - 56px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <ConversationPane mode="standalone" conversationId={id} />
    </div>
  );
}
