/**
 * Conversations data layer — CRUD-without-D.
 *
 * Every function in this module is intentionally non-destructive: conversations
 * can only be archived, never deleted. This is enforced at the data layer level.
 * See parent issue #503 for the rationale (audit / reproducibility).
 *
 * Structural contract: this module must never export a delete function nor issue
 * direct row removal on the conversations table. Only archive/unarchive is permitted.
 */

import crypto from "crypto";
import { sql } from "@/lib/db-write";
import { llmComplete } from "@/lib/llm-client";
import type { ChatTurn } from "@/lib/llm-client";

// ── ID generation ─────────────────────────────────────────────────────────────

/** Generate a 12-character hex conversation id (6 random bytes). */
export function generateConversationId(): string {
  return crypto.randomBytes(6).toString("hex");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  mode: string;
  title: string | null;
  first_user_prompt: string | null;
  context_url: string | null;
  context_kind: string | null;
  context_ref: string | null;
  created_at: string;
  last_interaction_at: string;
  archived_at: string | null;
  last_status: string | null;
  llm_provider: string | null;
  llm_driver: string | null;
  initial_context: unknown | null;
  created_by: string | null;
}

export interface CreateConversationParams {
  mode: string;
  context_url?: string | null;
  context_kind?: string | null;
  context_ref?: string | null;
  seed_prompt?: string | null;
  first_user_prompt?: string | null;
}

export interface CreateConversationResult {
  id: string;
  c_url: string;
  k_url: string;
}

// ── CRUD (no delete) ─────────────────────────────────────────────────────────

/**
 * Create a new conversation row. Returns the id and both viewer URLs.
 * The server generates the 12-hex-char id via `randomBytes(6).toString('hex')`.
 */
export async function createConversation(
  params: CreateConversationParams,
): Promise<CreateConversationResult> {
  const firstUserPrompt =
    params.first_user_prompt ?? params.seed_prompt ?? null;

  // One retry on the (astronomically unlikely) PK collision so the caller
  // never sees a raw unique-violation 500.
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = crypto.randomBytes(6).toString("hex");
    try {
      await sql(
        `INSERT INTO conversations
           (id, mode, first_user_prompt, context_url, context_kind, context_ref)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          params.mode,
          firstUserPrompt,
          params.context_url ?? null,
          params.context_kind ?? null,
          params.context_ref ?? null,
        ],
      );
      return { id, c_url: `/c/${id}`, k_url: `/k/${id}` };
    } catch (err: unknown) {
      const isUniqueViolation =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "23505";
      if (!isUniqueViolation || attempt === 1) throw err;
      // Retry with a fresh id
    }
  }
  // Unreachable — loop always returns or throws, but TypeScript needs this.
  /* c8 ignore next */
  throw new Error("createConversation: exhausted retries");
}

/**
 * Fetch a single conversation by id. Returns null if not found.
 */
export async function getConversation(id: string): Promise<Conversation | null> {
  const rows = await sql<Conversation>(
    `SELECT * FROM conversations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Update the user-visible title of a conversation unconditionally.
 * Used by the PATCH route for user-initiated renames.
 */
export async function updateConversationTitle(
  id: string,
  title: string,
): Promise<void> {
  await sql(
    `UPDATE conversations SET title = $2 WHERE id = $1`,
    [id, title],
  );
}

/**
 * Archive or unarchive a conversation.
 * Archiving sets `archived_at` to the current application timestamp; unarchiving clears it to NULL.
 */
export async function setConversationArchived(
  id: string,
  archived: boolean,
): Promise<void> {
  await sql(
    `UPDATE conversations SET archived_at = $2 WHERE id = $1`,
    [id, archived ? new Date().toISOString() : null],
  );
}

/**
 * Update `last_interaction_at` and optionally `last_status` on a conversation.
 */
export async function touchConversation(
  id: string,
  status?: "ok" | "error",
): Promise<void> {
  await sql(
    `UPDATE conversations
        SET last_interaction_at = NOW()
          ${status ? ", last_status = $2" : ""}
      WHERE id = $1`,
    status ? [id, status] : [id],
  );
}

// ── Message helpers ───────────────────────────────────────────────────────────

/**
 * Append a message to a conversation.
 * `content` is stored as JSONB — for text messages use `{ text: string }`.
 */
export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: unknown,
  usage?: {
    tokens_input?: number;
    tokens_output?: number;
    tokens_cache_read?: number;
    tokens_cache_creation?: number;
  },
): Promise<void> {
  await sql(
    `INSERT INTO conversation_messages
       (conversation_id, role, content, tokens_input, tokens_output,
        tokens_cache_read, tokens_cache_creation)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [
      conversationId,
      role,
      JSON.stringify(content),
      usage?.tokens_input ?? null,
      usage?.tokens_output ?? null,
      usage?.tokens_cache_read ?? null,
      usage?.tokens_cache_creation ?? null,
    ],
  );
}

/**
 * Count messages in a conversation (all roles).
 */
export async function countMessages(conversationId: string): Promise<number> {
  const rows = await sql<{ n: string }>(
    `SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = $1`,
    [conversationId],
  );
  return parseInt(rows[0]?.n ?? "0", 10);
}

/**
 * Load all messages for a conversation, ordered chronologically.
 */
export async function loadMessages(conversationId: string): Promise<
  Array<{ role: string; content: unknown; created_at: string }>
> {
  return sql(
    `SELECT role, content, created_at
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [conversationId],
  );
}

// ── Title generation ──────────────────────────────────────────────────────────

const TITLE_SYSTEM_PROMPT =
  "Genera un título corto de 5-7 palabras en español para esta conversación. " +
  "Responde SOLO con el título, sin comillas ni puntuación final.";

/**
 * After the first assistant reply, generate a short Spanish title via a small
 * background LLM call and store it in `conversations.title`.
 *
 * Non-blocking: errors are silently swallowed. `title` stays null on failure;
 * the UI falls back to `first_user_prompt`.
 *
 * Must be called AFTER the assistant message is persisted so the conversation
 * has a visible exchange to title.
 */
export async function maybeGenerateTitle(
  conversationId: string,
  messages: ChatTurn[],
): Promise<void> {
  const userMsg = messages.find((m) => m.role === "user");
  const assistantMsg = messages.find((m) => m.role === "assistant");
  if (!userMsg || !assistantMsg) return;

  try {
    const conv = await getConversation(conversationId);
    if (!conv || conv.title !== null) return;

    const userSnippet = userMsg.content.slice(0, 400);
    const assistantSnippet = assistantMsg.content.slice(0, 400);
    const prompt = `Usuario: ${userSnippet}\n\nAsistente: ${assistantSnippet}`;

    const resp = await llmComplete({
      flow: "title",
      systemPrompt: { stable: TITLE_SYSTEM_PROMPT },
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: 30,
      temperature: 0.3,
    });

    const title = resp.text.trim().replace(/^["']|["']$/g, "").trim();
    if (title) {
      // Use WHERE title IS NULL to avoid overwriting a user's manual rename
      // that may have arrived while the LLM call was in flight.
      await sql(
        `UPDATE conversations SET title = $2 WHERE id = $1 AND title IS NULL`,
        [conversationId, title],
      );
    }
  } catch {
    // Non-blocking: silently swallow; title stays null
  }
}

// ── Additional types for spec-compliant callers ───────────────────────────────

/** Alias for `Conversation` — both names are exported for compatibility. */
export type ConversationRow = Conversation;

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: unknown;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_cache_read: number | null;
  tokens_cache_creation: number | null;
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: MessageRow[];
}

export interface ConversationListRow extends Conversation {
  message_count: number;
}

export interface AppendMessageParams {
  role: string;
  content: unknown;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_cache_read?: number | null;
  tokens_cache_creation?: number | null;
}

export interface ListConversationsFilters {
  context_kind?: string;
  context_ref?: string;
  mode?: string;
  since?: Date | string;
  include_archived?: boolean;
  q?: string;
  limit?: number;
}

// ── Spec-compliant convenience wrappers ──────────────────────────────────────

/** Fetch a conversation with its full message history. */
export async function getConversationWithMessages(
  id: string,
): Promise<ConversationWithMessages | null> {
  const conv = await getConversation(id);
  if (!conv) return null;
  const messages = await sql<MessageRow>(
    `SELECT id, conversation_id, role, content,
            tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation,
            created_at
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [id],
  );
  return { ...conv, messages };
}

/** List conversations with optional filtering. Hidden from default view when archived. */
export async function listConversations(
  filters: ListConversationsFilters = {},
): Promise<ConversationListRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (!filters.include_archived) {
    conditions.push(`c.archived_at IS NULL`);
  }
  if (filters.context_kind !== undefined) {
    conditions.push(`c.context_kind = $${idx++}`);
    params.push(filters.context_kind);
  }
  if (filters.context_ref !== undefined) {
    conditions.push(`c.context_ref = $${idx++}`);
    params.push(filters.context_ref);
  }
  if (filters.mode !== undefined) {
    conditions.push(`c.mode = $${idx++}`);
    params.push(filters.mode);
  }
  if (filters.since !== undefined) {
    conditions.push(`c.last_interaction_at >= $${idx++}`);
    params.push(filters.since);
  }
  if (filters.q !== undefined && filters.q.trim() !== "") {
    const escaped = filters.q.trim().replace(/[%_\\]/g, "\\$&");
    conditions.push(
      `(c.title ILIKE $${idx} ESCAPE '\\' OR c.first_user_prompt ILIKE $${idx} ESCAPE '\\')`,
    );
    params.push(`%${escaped}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  let limitClause = "";
  if (filters.limit != null) {
    limitClause = `LIMIT $${idx++}`;
    params.push(filters.limit);
  }

  return sql<ConversationListRow>(
    `SELECT c.*, COUNT(m.id)::int AS message_count
       FROM conversations c
       LEFT JOIN conversation_messages m ON m.conversation_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.last_interaction_at DESC
      ${limitClause}`,
    params,
  );
}

/** Archive a conversation (sets archived_at to now). */
export async function archiveConversation(id: string): Promise<void> {
  return setConversationArchived(id, true);
}

/** Unarchive a conversation (clears archived_at). */
export async function unarchiveConversation(id: string): Promise<void> {
  return setConversationArchived(id, false);
}

/** Update a conversation's title. Alias for updateConversationTitle. */
export async function updateTitle(id: string, title: string): Promise<void> {
  return updateConversationTitle(id, title);
}

/** Update a conversation's last_status. Alias for touchConversation. */
export async function updateLastStatus(
  id: string,
  status: "ok" | "error",
): Promise<void> {
  return touchConversation(id, status);
}

/**
 * Write the latest non-archived conversation messages back into the dashboard's
 * legacy cache columns (chat_messages_modify / chat_messages_analyze) so the
 * renderer keeps working without touching the new tables.
 */
export async function syncLegacyCache(conversationId: string): Promise<void> {
  const conv = await getConversation(conversationId);
  if (!conv || !conv.context_ref || conv.context_kind !== "dashboard") return;
  if (conv.mode !== "modify" && conv.mode !== "analyze") return;
  if (conv.archived_at !== null) return;

  const messages = await sql<MessageRow>(
    `SELECT role, content, created_at
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [conversationId],
  );

  const legacy = messages.map((m) => {
    const c = m.content;
    let contentText: string;
    if (typeof c === "string") {
      contentText = c;
    } else if (c !== null && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
      contentText = (c as Record<string, unknown>).text as string;
    } else {
      contentText = JSON.stringify(c);
    }
    return {
      role: m.role,
      content: contentText,
      timestamp: m.created_at ? String(m.created_at) : new Date().toISOString(),
    };
  });

  const dashboardId = parseInt(conv.context_ref, 10);
  if (isNaN(dashboardId)) return;

  if (conv.mode === "modify") {
    await sql(
      `UPDATE dashboards SET chat_messages_modify = $2::jsonb WHERE id = $1`,
      [dashboardId, JSON.stringify(legacy)],
    );
  } else {
    await sql(
      `UPDATE dashboards SET chat_messages_analyze = $2::jsonb WHERE id = $1`,
      [dashboardId, JSON.stringify(legacy)],
    );
  }
}
