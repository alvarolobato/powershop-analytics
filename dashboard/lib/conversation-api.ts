import { headers } from "next/headers";
import type { ConversationWithMessages } from "@/lib/conversation-types";

/**
 * Fetches a conversation by ID from the internal API.
 *
 * Derives the base URL from the incoming request headers so it works in any
 * environment (local Docker, preview, production) without relying on a
 * hardcoded NEXT_PUBLIC_APP_URL fallback.
 *
 * Returns null for 404 or any fetch error (caller should `notFound()`).
 */
export async function fetchConversation(id: string): Promise<ConversationWithMessages | null> {
  try {
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:4000";
    const proto = headersList.get("x-forwarded-proto") ?? "http";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
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
