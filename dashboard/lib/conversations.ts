/**
 * Conversations data layer — CRUD without delete.
 *
 * Conversations can only be archived (archived_at timestamp), never deleted.
 * This is a deliberate design choice: every conversation is an audit record of
 * what the LLM was asked and what it answered.
 *
 * Uses db-write.ts pool for all operations (reads and writes on the same pool
 * so that writes are visible to subsequent reads within the same request).
 */

import { randomBytes } from "crypto";
import { sql } from "@/lib/db-write";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationRow {
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
  initial_context: InitialContext | null;
  created_by: string | null;
}

/** Snapshot of LLM context at first message send. Immutable after creation. */
export interface InitialContext {
  model: string;
  provider: string;
  driver: string | null;
  systemPrompt: {
    stable: string;
    volatile?: string;
  };
  tools: string[];
  toolSchemas?: Record<string, unknown>[];
  seedPrompt?: string;
  flow?: string;
  maxOutputTokens?: number;
  agenticLimits?: Record<string, unknown>;
}

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

/** Row returned by listConversations with computed metadata fields. */
export interface ConversationListRow extends ConversationRow {
  message_count: number;
  tool_calls_count: number;
  rounds_count: number;
  duration_seconds: number;
  last_message_preview: string | null;
  token_total: number;
}

export interface ListConversationsOptions {
  context_kind?: string;
  context_ref?: string;
  mode?: string;
  since?: string;
  include_archived?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

export interface CreateConversationOptions {
  mode: string;
  context_url?: string;
  context_kind?: string;
  context_ref?: string;
  first_user_prompt?: string;
  llm_provider?: string;
  llm_driver?: string;
}

export interface AppendMessageOptions {
  role: string;
  content: unknown;
  tokens_input?: number;
  tokens_output?: number;
  tokens_cache_read?: number;
  tokens_cache_creation?: number;
}

// ── ID generation ─────────────────────────────────────────────────────────────

/** Generate a 12-character lowercase hex conversation ID. */
export function generateConversationId(): string {
  return randomBytes(6).toString("hex");
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createConversation(
  opts: CreateConversationOptions,
): Promise<{ id: string; c_url: string; k_url: string }> {
  const id = generateConversationId();
  await sql(
    `INSERT INTO conversations
       (id, mode, context_url, context_kind, context_ref, first_user_prompt,
        llm_provider, llm_driver, created_at, last_interaction_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
    [
      id,
      opts.mode,
      opts.context_url ?? null,
      opts.context_kind ?? null,
      opts.context_ref ?? null,
      opts.first_user_prompt ?? null,
      opts.llm_provider ?? null,
      opts.llm_driver ?? null,
    ],
  );
  return { id, c_url: `/c/${id}`, k_url: `/k/${id}` };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getConversation(id: string): Promise<ConversationRow | null> {
  const rows = await sql<ConversationRow>(
    `SELECT id, mode, title, first_user_prompt, context_url, context_kind, context_ref,
            created_at, last_interaction_at, archived_at, last_status,
            llm_provider, llm_driver, initial_context, created_by
     FROM conversations
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getConversationWithMessages(
  id: string,
): Promise<(ConversationRow & { messages: MessageRow[] }) | null> {
  const conv = await getConversation(id);
  if (!conv) return null;
  const messages = await sql<MessageRow>(
    `SELECT id, conversation_id, role, content, tokens_input, tokens_output,
            tokens_cache_read, tokens_cache_creation, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [id],
  );
  return { ...conv, messages };
}

export async function listConversations(
  opts: ListConversationsOptions = {},
): Promise<ConversationListRow[]> {
  const { page = 1, limit = 50, include_archived = false } = opts;
  const offset = (Math.max(1, page) - 1) * Math.min(200, Math.max(1, limit));
  const clampedLimit = Math.min(200, Math.max(1, limit));

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (!include_archived) {
    conditions.push(`c.archived_at IS NULL`);
  }
  if (opts.context_kind) {
    conditions.push(`c.context_kind = $${idx++}`);
    params.push(opts.context_kind);
  }
  if (opts.context_ref) {
    conditions.push(`c.context_ref = $${idx++}`);
    params.push(opts.context_ref);
  }
  if (opts.mode) {
    conditions.push(`c.mode = $${idx++}`);
    params.push(opts.mode);
  }
  if (opts.since) {
    conditions.push(`c.last_interaction_at >= $${idx++}`);
    params.push(opts.since);
  }
  if (opts.q) {
    const pattern = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      `(c.title ILIKE $${idx} OR c.first_user_prompt ILIKE $${idx})`,
    );
    params.push(pattern);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(clampedLimit, offset);
  const limitParam = idx++;
  const offsetParam = idx++;

  const rows = await sql<ConversationListRow>(
    `SELECT
       c.id, c.mode, c.title, c.first_user_prompt, c.context_url, c.context_kind,
       c.context_ref, c.created_at, c.last_interaction_at, c.archived_at,
       c.last_status, c.llm_provider, c.llm_driver, c.initial_context, c.created_by,
       -- message count
       COALESCE(stats.message_count, 0)::INT AS message_count,
       -- tool_calls_count: assistant messages that have a tool_calls array in content
       COALESCE(stats.tool_calls_count, 0)::INT AS tool_calls_count,
       -- rounds_count: number of assistant messages with tool_calls (agentic rounds)
       COALESCE(stats.rounds_count, 0)::INT AS rounds_count,
       -- duration: seconds between created_at and last_interaction_at
       EXTRACT(EPOCH FROM (c.last_interaction_at - c.created_at))::INT AS duration_seconds,
       -- last message preview (truncated to 120 chars)
       LEFT(stats.last_message_preview, 120) AS last_message_preview,
       -- token totals across all messages
       COALESCE(stats.token_total, 0)::INT AS token_total
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::INT AS message_count,
         COALESCE(SUM(
           CASE WHEN role = 'assistant'
             AND jsonb_typeof(content->'tool_calls') = 'array'
           THEN jsonb_array_length(content->'tool_calls')
           ELSE 0 END
         ), 0)::INT AS tool_calls_count,
         COUNT(*) FILTER (
           WHERE role = 'assistant'
             AND (content->'tool_calls') IS NOT NULL
             AND jsonb_typeof(content->'tool_calls') = 'array'
             AND jsonb_array_length(content->'tool_calls') > 0
         )::INT AS rounds_count,
         (
           SELECT LEFT(
             CASE
               WHEN jsonb_typeof(m2.content) = 'string' THEN m2.content #>> '{}'
               WHEN m2.content->>'text' IS NOT NULL THEN m2.content->>'text'
               ELSE m2.content::text
             END,
             120
           )
           FROM conversation_messages m2
           WHERE m2.conversation_id = c.id
           ORDER BY m2.created_at DESC
           LIMIT 1
         ) AS last_message_preview,
         SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0))::INT AS token_total
       FROM conversation_messages
       WHERE conversation_id = c.id
     ) stats ON TRUE
     ${where}
     ORDER BY c.last_interaction_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );

  return rows;
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateConversation(
  id: string,
  updates: { title?: string; archived?: boolean },
): Promise<ConversationRow | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.archived === true) {
    setClauses.push(`archived_at = NOW()`);
  } else if (updates.archived === false) {
    setClauses.push(`archived_at = NULL`);
  }

  if (setClauses.length === 0) return getConversation(id);

  params.push(id);
  const rows = await sql<ConversationRow>(
    `UPDATE conversations
     SET ${setClauses.join(", ")}
     WHERE id = $${idx}
     RETURNING id, mode, title, first_user_prompt, context_url, context_kind,
               context_ref, created_at, last_interaction_at, archived_at,
               last_status, llm_provider, llm_driver, initial_context, created_by`,
    params,
  );
  return rows[0] ?? null;
}

export async function archiveConversation(id: string): Promise<ConversationRow | null> {
  return updateConversation(id, { archived: true });
}

export async function unarchiveConversation(id: string): Promise<ConversationRow | null> {
  return updateConversation(id, { archived: false });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function appendMessage(
  conversationId: string,
  opts: AppendMessageOptions,
): Promise<MessageRow> {
  const rows = await sql<MessageRow>(
    `INSERT INTO conversation_messages
       (conversation_id, role, content, tokens_input, tokens_output,
        tokens_cache_read, tokens_cache_creation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, conversation_id, role, content, tokens_input, tokens_output,
               tokens_cache_read, tokens_cache_creation, created_at`,
    [
      conversationId,
      opts.role,
      JSON.stringify(opts.content),
      opts.tokens_input ?? null,
      opts.tokens_output ?? null,
      opts.tokens_cache_read ?? null,
      opts.tokens_cache_creation ?? null,
    ],
  );

  await sql(
    `UPDATE conversations
     SET last_interaction_at = NOW()
     WHERE id = $1`,
    [conversationId],
  );

  return rows[0];
}

export async function setInitialContext(
  conversationId: string,
  context: InitialContext,
): Promise<void> {
  await sql(
    `UPDATE conversations
     SET initial_context = $2
     WHERE id = $1 AND initial_context IS NULL`,
    [conversationId, JSON.stringify(context)],
  );
}

export async function updateLastStatus(
  conversationId: string,
  status: "ok" | "error",
): Promise<void> {
  await sql(
    `UPDATE conversations SET last_status = $2, last_interaction_at = NOW() WHERE id = $1`,
    [conversationId, status],
  );
}
