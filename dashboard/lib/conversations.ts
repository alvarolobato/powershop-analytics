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
  const id = crypto.randomBytes(6).toString("hex");
  const firstUserPrompt =
    params.first_user_prompt ?? params.seed_prompt ?? null;

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
 * Update the user-visible title of a conversation.
 * Safe to call from both the PATCH route and maybeGenerateTitle.
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
 * Archiving sets `archived_at = NOW()`; unarchiving clears it to NULL.
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
      await updateConversationTitle(conversationId, title);
    }
  } catch {
    // Non-blocking: silently swallow; title stays null
  }
}
