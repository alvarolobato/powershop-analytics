import { headers } from "next/headers";
import type { ConversationWithMessages } from "@/lib/conversation-types";
import { getAppPublicUrl } from "@/lib/public-urls";

/**
 * Fetches a conversation by ID from the internal API.
 *
 * IMPORTANT: This is a server-to-self call made during SSR. It must use the
 * internal (container-local) base URL — never the public URL — so it works
 * regardless of the external hostname or whether TLS is terminated externally.
 *
 * Internal URL is derived from the incoming request's Host header (which
 * inside Docker is always the container port, e.g. "localhost:4000"), NOT
 * from APP_PUBLIC_URL (which is the public reverse-proxy hostname and would
 * route traffic outside the container network).
 *
 * Returns null for 404 or any fetch error (caller should `notFound()`).
 */
export async function fetchConversation(id: string): Promise<ConversationWithMessages | null> {
  try {
    const headersList = await headers();
    // Use the Host header to get the container-local address. Inside Docker
    // this is always the container's own port (e.g. "localhost:4000"), so
    // the fetch stays on the loopback and never leaves the container.
    // APP_PUBLIC_URL is intentionally NOT used here — it's for external links.
    const host = headersList.get("host") ?? "localhost:4000";
    const proto = "http"; // always http inside the container (TLS is at the proxy)
    const baseUrl = `${proto}://${host}`;
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
