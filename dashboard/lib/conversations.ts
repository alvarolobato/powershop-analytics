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
import { llmComplete } from "@/lib/llm-client";
import { generateRequestId } from "@/lib/errors";

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
  /** Multi-value context_kind filter. When non-empty, applied as `c.context_kind = ANY(...)`. */
  context_kinds?: string[];
  context_ref?: string;
  /** Single-mode filter (kept for back-compat). Superseded by `modes` when both are set. */
  mode?: string;
  /** Multi-mode filter. When non-empty, applied as `c.mode = ANY(...)`. */
  modes?: string[];
  since?: string;
  /** When true, shows both active and archived rows (no archived_at filter). */
  include_archived?: boolean;
  /** When true, shows ONLY archived rows (archived_at IS NOT NULL). Overrides include_archived. */
  only_archived?: boolean;
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
  const { page = 1, limit = 50, include_archived = false, only_archived = false } = opts;
  const offset = (Math.max(1, page) - 1) * Math.min(200, Math.max(1, limit));
  const clampedLimit = Math.min(200, Math.max(1, limit));

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (only_archived) {
    conditions.push(`c.archived_at IS NOT NULL`);
  } else if (!include_archived) {
    conditions.push(`c.archived_at IS NULL`);
  }
  // Resolve context_kind filter: context_kinds[] takes precedence over single context_kind
  const activeContextKinds =
    opts.context_kinds && opts.context_kinds.length > 0
      ? opts.context_kinds
      : opts.context_kind
        ? [opts.context_kind]
        : [];
  if (activeContextKinds.length === 1) {
    conditions.push(`c.context_kind = $${idx++}`);
    params.push(activeContextKinds[0]);
  } else if (activeContextKinds.length > 1) {
    conditions.push(`c.context_kind = ANY($${idx++}::text[])`);
    params.push(activeContextKinds);
  }
  if (opts.context_ref) {
    conditions.push(`c.context_ref = $${idx++}`);
    params.push(opts.context_ref);
  }

  // Resolve mode filter: `modes` array takes precedence over single `mode`
  const activeModes =
    opts.modes && opts.modes.length > 0
      ? opts.modes
      : opts.mode
        ? [opts.mode]
        : [];
  if (activeModes.length === 1) {
    conditions.push(`c.mode = $${idx++}`);
    params.push(activeModes[0]);
  } else if (activeModes.length > 1) {
    conditions.push(`c.mode = ANY($${idx++}::text[])`);
    params.push(activeModes);
  }
  if (opts.since) {
    conditions.push(`c.last_interaction_at >= $${idx++}`);
    params.push(opts.since);
  }
  if (opts.q && opts.q.trim() !== "") {
    const pattern = `%${opts.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
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

export async function archiveConversation(id: string): Promise<ConversationRow | null> {
  await setConversationArchived(id, true);
  return getConversation(id);
}

export async function unarchiveConversation(id: string): Promise<ConversationRow | null> {
  await setConversationArchived(id, false);
  return getConversation(id);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface AppendMessageTokens {
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_cache_read?: number | null;
  tokens_cache_creation?: number | null;
}

/**
 * Append a message to a conversation. Supports two call styles:
 *   - appendMessage(id, opts) — opts has { role, content, tokens_* }
 *   - appendMessage(id, role, content, tokens?) — positional form
 */
export async function appendMessage(
  conversationId: string,
  opts: AppendMessageOptions,
): Promise<MessageRow>;
export async function appendMessage(
  conversationId: string,
  role: string,
  content: unknown,
  tokens?: AppendMessageTokens,
): Promise<MessageRow>;
export async function appendMessage(
  conversationId: string,
  roleOrOpts: string | AppendMessageOptions,
  content?: unknown,
  tokens?: AppendMessageTokens,
): Promise<MessageRow> {
  let role: string;
  let actualContent: unknown;
  let tIn: number | null;
  let tOut: number | null;
  let tCacheRead: number | null;
  let tCacheCreation: number | null;

  if (typeof roleOrOpts === "string") {
    role = roleOrOpts;
    actualContent = content;
    tIn = tokens?.tokens_input ?? null;
    tOut = tokens?.tokens_output ?? null;
    tCacheRead = tokens?.tokens_cache_read ?? null;
    tCacheCreation = tokens?.tokens_cache_creation ?? null;
  } else {
    role = roleOrOpts.role;
    actualContent = roleOrOpts.content;
    tIn = roleOrOpts.tokens_input ?? null;
    tOut = roleOrOpts.tokens_output ?? null;
    tCacheRead = roleOrOpts.tokens_cache_read ?? null;
    tCacheCreation = roleOrOpts.tokens_cache_creation ?? null;
  }

  const rows = await sql<MessageRow>(
    `INSERT INTO conversation_messages
       (conversation_id, role, content, tokens_input, tokens_output,
        tokens_cache_read, tokens_cache_creation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, conversation_id, role, content, tokens_input, tokens_output,
               tokens_cache_read, tokens_cache_creation, created_at`,
    [
      conversationId,
      role,
      JSON.stringify(actualContent),
      tIn,
      tOut,
      tCacheRead,
      tCacheCreation,
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

/** Load all messages for a conversation, ordered by created_at ASC. */
export async function loadMessages(conversationId: string): Promise<MessageRow[]> {
  return sql<MessageRow>(
    `SELECT id, conversation_id, role, content, tokens_input, tokens_output,
            tokens_cache_read, tokens_cache_creation, created_at
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC`,
    [conversationId],
  );
}

/**
 * Touch a conversation's last_interaction_at (and optionally last_status) to NOW().
 */
export async function touchConversation(
  conversationId: string,
  status?: "ok" | "error",
): Promise<void> {
  if (status !== undefined) {
    await sql(
      `UPDATE conversations SET last_status = $2, last_interaction_at = NOW() WHERE id = $1`,
      [conversationId, status],
    );
  } else {
    await sql(
      `UPDATE conversations SET last_interaction_at = NOW() WHERE id = $1`,
      [conversationId],
    );
  }
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

// ── Dedicated simple helpers (used by data-layer tests + title generation) ────

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  await sql(`UPDATE conversations SET title = $2 WHERE id = $1`, [id, title]);
}

/** Sets or clears archived_at. Passes timestamp as a param so callers can verify it. */
export async function setConversationArchived(id: string, archived: boolean): Promise<void> {
  const archivedAt = archived ? new Date().toISOString() : null;
  await sql(`UPDATE conversations SET archived_at = $2 WHERE id = $1`, [id, archivedAt]);
}

export async function countMessages(conversationId: string): Promise<number> {
  const rows = await sql<{ n: string }>(
    `SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = $1`,
    [conversationId],
  );
  return rows[0] ? parseInt(rows[0].n, 10) : 0;
}

// ── Title generation ──────────────────────────────────────────────────────────

/**
 * After the first assistant reply, fire a small LLM call to generate a short
 * Spanish title for the conversation. Non-blocking — errors are swallowed.
 * Only runs when the conversation has no title yet.
 */
export async function maybeGenerateTitle(
  conversationId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const hasContent = messages.some(
    (m) => m.role === "user" || m.role === "assistant",
  );
  if (!hasContent) return;

  const conv = await getConversation(conversationId);
  if (!conv || conv.title !== null) return;

  try {
    const response = await llmComplete({
      flow: "title",
      maxOutputTokens: 30,
      systemPrompt: {
        stable:
          "Genera un título conciso de 5-7 palabras en español para esta conversación. Devuelve solo el título, sin comillas.",
      },
      messages: messages
        .filter((m): m is { role: "user" | "assistant"; content: string } =>
          m.role === "user" || m.role === "assistant",
        )
        .map((m) => ({ role: m.role, content: m.content })),
      requestId: generateRequestId(),
    });

    const title = response.text.trim().replace(/^["']|["']$/g, "");
    if (!title) return;

    await sql(
      `UPDATE conversations SET title = $2 WHERE id = $1 AND title IS NULL`,
      [conversationId, title],
    );
  } catch {
    // Non-blocking: title is cosmetic — swallow errors silently
  }
}

/** Update a conversation's title. Alias for updateConversationTitle. */
export async function updateTitle(id: string, title: string): Promise<void> {
  return updateConversationTitle(id, title);
}

// ── Legacy cache sync ─────────────────────────────────────────────────────────


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
