import { headers } from "next/headers";
import type { ConversationWithMessages } from "@/lib/conversation-types";
import { getAppPublicUrl } from "@/lib/public-urls";

/**
 * Fetches a conversation by ID from the internal API.
 *
 * Uses APP_PUBLIC_URL (runtime env) when set, so reverse-proxy deployments
 * with a custom hostname work without rebuilding the image. Falls back to
 * deriving the base URL from the incoming request's Host + x-forwarded-proto
 * headers, which covers local dev and plain Docker without extra config.
 *
 * Returns null for 404 or any fetch error (caller should `notFound()`).
 */
export async function fetchConversation(id: string): Promise<ConversationWithMessages | null> {
  try {
    const headersList = await headers();
    // Prefer the configured public URL; fall back to host-header derivation.
    const configuredUrl = process.env.APP_PUBLIC_URL?.trim();
    const baseUrl = configuredUrl
      ? configuredUrl.replace(/\/$/, "")
      : (() => {
          const host = headersList.get("host") ?? "localhost:4000";
          const proto = headersList.get("x-forwarded-proto") ?? "http";
          return `${proto}://${host}`;
        })();
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

// Re-export for convenience — callers that need the public URL for other
// purposes can import it from here instead of lib/public-urls directly.
export { getAppPublicUrl };
