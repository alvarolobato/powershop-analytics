/**
 * Turn-events data layer — CRUD for conversation_turns and turn_events.
 */

import { sql, withTransaction } from "@/lib/db-write";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TurnRow {
  id: string;
  conversation_id: string;
  turn_index: number;
  user_message: string;
  status: "pending" | "streaming" | "complete" | "error";
  /**
   * 'user' — a real user-submitted turn, competing for the single-active-turn
   * slot `createTurnIfIdle` enforces. 'background' — a system-initiated
   * tracking turn (currently only `createBackgroundTurn`, D-049) that reports
   * progress for work running alongside whatever the user is doing; it must
   * NEVER count as "in progress" for that guard. See createTurnIfIdle below.
   */
  source: "user" | "background";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  /** Relative path to this turn's context-log file (conversation-context-store), or null. */
  context_file: string | null;
  created_at: string;
}

export interface TurnEventRow {
  id: number;
  turn_id: string;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TurnWithEvents {
  turn: TurnRow;
  events: TurnEventRow[];
}

// ── Queries ────────────────────────────────────────────────────────────────────

/**
 * Cutoff after which an in-flight turn is considered abandoned (e.g. the
 * container restarted mid-turn and the status row was never finalised).
 * createTurnIfIdle ignores older turns so a crashed turn can never permanently
 * block a conversation from accepting new ones.
 *
 * Set well above the worst-case legitimate turn so a long agentic run is never
 * misclassified as stale (issue #846 review): the agentic limits allow up to
 * maxToolCalls=24 × toolTimeoutMs=15s = 6 min of tool time plus several rounds
 * of model latency, so ~10 min is plausible. 30 min leaves comfortable margin
 * while still recovering a truly crashed turn within the same session.
 */
const ACTIVE_TURN_STALE_MINUTES = 30;

/**
 * Result of createTurnIfIdle: the created turn, or null when another turn is
 * already in flight for the conversation.
 */
export type CreateTurnResult =
  | { ok: true; turnId: string; turnIndex: number }
  | { ok: false; reason: "active_turn" };

/**
 * Atomically reject-or-create a turn (issue #823, hardened against the TOCTOU
 * race the review flagged).
 *
 * A naive `hasActiveTurn()` check followed by a separate `createTurn()` lets
 * two concurrent requests both pass the check before either inserts, so both
 * proceed — exactly the interleaving the guard is meant to prevent. Here the
 * check AND the insert run inside one transaction holding a per-conversation
 * advisory lock (`pg_advisory_xact_lock`, auto-released on commit/rollback),
 * so concurrent requests for the same conversation serialise: the second sees
 * the first's pending row and is rejected.
 *
 * The lock also makes the MAX(turn_index)+1 allocation race-free for same-
 * conversation inserts (no unique-violation retry needed); the unique
 * constraint remains as a backstop.
 */
export async function createTurnIfIdle(
  conversationId: string,
  userMessage: string,
): Promise<CreateTurnResult> {
  return withTransaction(async (client) => {
    // Serialise all turn creation for this conversation. hashtext → int4,
    // implicitly widened to the bigint key pg_advisory_xact_lock expects.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [conversationId]);

    // source = 'user' excludes background tracking turns (createBackgroundTurn)
    // from this guard (issue review on D-049): those rows sit in 'streaming'
    // for the whole 30s-2min duration of a detached generation, and before
    // this filter they were indistinguishable from a real in-flight user
    // turn — a user's own turn would finish in seconds, but any message they
    // sent while their dashboard was still generating hit this check, saw the
    // tracking row, and got rejected with TURN_IN_PROGRESS for up to two
    // minutes. The chat went dead for exactly the scenario D-049 was fixing.
    const active = await client.query(
      `SELECT 1 FROM conversation_turns
        WHERE conversation_id = $1
          AND status IN ('pending', 'streaming')
          AND source = 'user'
          AND created_at > NOW() - ($2 || ' minutes')::interval
        LIMIT 1`,
      [conversationId, String(ACTIVE_TURN_STALE_MINUTES)],
    );
    if ((active.rowCount ?? 0) > 0) {
      return { ok: false, reason: "active_turn" } as const;
    }

    const inserted = await client.query<{ id: string; turn_index: number }>(
      `INSERT INTO conversation_turns (conversation_id, turn_index, user_message, status)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(turn_index) + 1, 0)
            FROM conversation_turns
           WHERE conversation_id = $1),
         $2,
         'pending'
       )
       RETURNING id, turn_index`,
      [conversationId, userMessage],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("createTurnIfIdle: no row returned");
    return { ok: true, turnId: row.id, turnIndex: row.turn_index } as const;
  });
}

/**
 * Directly insert a `conversation_turns` row for a SYSTEM-initiated background
 * job — currently only the `start_dashboard_generation` tool (D-049): a full
 * `generateDashboard()` run cannot fit inside the per-tool dispatch timeout
 * (15s in prod), so the tool starts it detached and reports progress/result
 * through a tracking turn instead of blocking the tool call on it.
 *
 * Unlike `createTurnIfIdle`, this does NOT reject when another turn is active.
 * It is not competing for the single-active-turn slot a user-submitted message
 * uses — it is bookkeeping for work that runs alongside whatever turn (if any)
 * is currently streaming for this conversation. It still takes the same
 * per-conversation advisory lock so the `(conversation_id, turn_index)` unique
 * constraint can't collide with a concurrent `createTurnIfIdle` insert.
 *
 * Inserted with `source = 'background'` (not the `'user'` default) so
 * `createTurnIfIdle`'s active-turn guard skips it: without that distinction,
 * this row sitting in 'streaming' for the whole 30s-2min generation made
 * `createTurnIfIdle` see it as a genuine in-flight turn and reject every
 * message the user sent in that window with TURN_IN_PROGRESS — the chat
 * going dead for up to two minutes, the opposite of what D-049 set out to
 * fix. `status` keeps its normal pending/streaming/complete/error meaning so
 * turn_events/SSE replay and ConversationPane's turn-adoption logic (keyed
 * on turnId, not on `source`) need no changes.
 */
export async function createBackgroundTurn(
  conversationId: string,
  userMessage: string,
): Promise<string> {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [conversationId]);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO conversation_turns (conversation_id, turn_index, user_message, status, source, started_at)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(turn_index) + 1, 0)
            FROM conversation_turns
           WHERE conversation_id = $1),
         $2,
         'streaming',
         'background',
         NOW()
       )
       RETURNING id`,
      [conversationId, userMessage],
    );
    const row = inserted.rows[0];
    if (!row?.id) throw new Error("createBackgroundTurn: no row returned");
    return row.id;
  });
}

export async function updateTurnStatus(
  turnId: string,
  status: "pending" | "streaming" | "complete" | "error",
  error?: string,
): Promise<void> {
  if (status === "streaming") {
    await sql(
      `UPDATE conversation_turns SET status = $2, started_at = NOW() WHERE id = $1`,
      [turnId, status],
    );
  } else if (status === "complete") {
    await sql(
      `UPDATE conversation_turns SET status = $2, completed_at = NOW() WHERE id = $1`,
      [turnId, status],
    );
  } else if (status === "error") {
    await sql(
      `UPDATE conversation_turns
          SET status = $2, completed_at = NOW(), error = $3
        WHERE id = $1`,
      [turnId, status, error ?? null],
    );
  } else {
    await sql(
      `UPDATE conversation_turns SET status = $2 WHERE id = $1`,
      [turnId, status],
    );
  }
}

export async function insertTurnEvent(
  turnId: string,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const rows = await sql<{ id: number }>(
    `INSERT INTO turn_events (turn_id, seq, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [turnId, seq, eventType, JSON.stringify(payload)],
  );
  if (!rows[0]?.id) throw new Error("insertTurnEvent: RETURNING id returned no rows");
  return rows[0].id;
}

/** Record the relative path of a turn's context-log file (see conversation-context-store). */
export async function setTurnContextFile(turnId: string, contextFile: string): Promise<void> {
  await sql(
    `UPDATE conversation_turns SET context_file = $2 WHERE id = $1`,
    [turnId, contextFile],
  );
}

/**
 * Resolve a turn's context-file path, scoped to its conversation so a caller
 * can only read context for a turn that belongs to the given conversation.
 * Returns null when the turn doesn't exist, belongs to another conversation,
 * or has no context file.
 */
export async function getTurnContextFile(
  conversationId: string,
  turnId: string,
): Promise<string | null> {
  const rows = await sql<{ context_file: string | null }>(
    `SELECT context_file FROM conversation_turns
      WHERE id = $1 AND conversation_id = $2`,
    [turnId, conversationId],
  );
  return rows[0]?.context_file ?? null;
}

/**
 * Delete the transient streaming events (`token`, `thinking`) of a finished turn.
 *
 * These events carry CUMULATIVE snapshots per delta — O(n²) storage in response
 * length — and are pure transport once the turn is complete: the final text
 * lives on the assistant message (including its `thinking`). Pruning bounds
 * turn_events growth and keeps SSE replay payloads small (issue #834).
 * Durable events (log, context_ref, spec_update, complete, error) are kept.
 */
export async function pruneStreamEvents(turnId: string): Promise<void> {
  await sql(
    `DELETE FROM turn_events
      WHERE turn_id = $1 AND event_type IN ('token', 'thinking')`,
    [turnId],
  );
}

export async function getTurnWithEvents(turnId: string): Promise<TurnWithEvents | null> {
  const turns = await sql<TurnRow>(
    `SELECT * FROM conversation_turns WHERE id = $1`,
    [turnId],
  );
  if (!turns[0]) return null;
  const events = await sql<TurnEventRow>(
    `SELECT * FROM turn_events WHERE turn_id = $1 ORDER BY seq ASC`,
    [turnId],
  );
  return { turn: turns[0], events };
}

/**
 * Cumulative snapshot events, pruned from replay once their turn has settled.
 *
 * `token` and `thinking` payloads are CUMULATIVE — each row holds the entire
 * accumulated text so far, not a delta (see turn-background.ts's
 * "model_text_delta.text is CUMULATIVE — replace, never append"). Every row is
 * therefore a strict prefix of the next, which makes the table O(n^2) in a
 * turn's output length: production holds 369k such rows / 693 MB for 140
 * turns, against ~714 kB of actual text.
 *
 * `pruneStreamEvents` deletes them when a turn reaches complete/error, because
 * the durable copy then lives on the assistant message. Turns that settled
 * before that existed still carry theirs, and nothing ever backfilled.
 *
 * Excluding them at read time makes an unpruned turn behave like a pruned one
 * — but NOT indiscriminately, see LAST_SNAPSHOT_EVENT_TYPES below.
 */
const TRANSIENT_EVENT_TYPES = ["token", "thinking"];

/**
 * ...with one exception: the LAST `thinking` snapshot per settled turn is kept.
 *
 * `content.thinking` on the assistant message and `pruneStreamEvents` shipped
 * in the same commit (b4ea69c, 2026-06-12). So "turn still has unpruned
 * thinking events" implies "turn predates content.thinking" — a perfect
 * correlation, meaning for exactly the turns this exclusion targets, those
 * events are the ONLY copy of the model's reasoning. Dropping all of them
 * silently emptied the thinking block on every historical answer and left
 * ConversationPane's `turnData?.thinking` fallback (which exists for precisely
 * this population) as dead code.
 *
 * Because the payloads are cumulative, the last row IS the complete text — so
 * keeping one row per turn preserves 100% of the information at ~0.04% of the
 * rows. `token` needs no such exception: the final text is on the assistant
 * message's `content.text`, which has always been written.
 */
const LAST_SNAPSHOT_EVENT_TYPE = "thinking";

/**
 * Hard ceiling on one replay. Reaching it means a turn is genuinely producing
 * that many events RIGHT NOW (settled turns contribute a handful after the
 * pruning above), so it is logged rather than applied silently — a truncated
 * replay that looks complete is worse than a slow one.
 */
const MAX_REPLAY_EVENTS = 5_000;

export async function getConversationEvents(
  conversationId: string,
  sinceId?: number,
): Promise<TurnEventRow[]> {
  // `keep` resolves the last thinking snapshot per turn once, up front, rather
  // than as a correlated subquery per row.
  //
  // The predicate reads: keep a row if it is a durable event, OR its turn is
  // still in flight (the client has no assistant message to read from yet), OR
  // it is that turn's final thinking snapshot.
  const KEEP = `
    WITH keep AS (
      SELECT DISTINCT ON (te.turn_id) te.id
        FROM turn_events te
        JOIN conversation_turns ct ON ct.id = te.turn_id
       WHERE ct.conversation_id = $1
         AND te.event_type = '${LAST_SNAPSHOT_EVENT_TYPE}'
       ORDER BY te.turn_id, te.id DESC
    )`;

  const rows =
    sinceId !== undefined
      ? await sql<TurnEventRow>(
          `${KEEP}
           SELECT te.*
             FROM turn_events te
             JOIN conversation_turns ct ON ct.id = te.turn_id
            WHERE ct.conversation_id = $1
              AND te.id > $2
              AND (te.event_type <> ALL($3::text[])
                   OR ct.status IN ('streaming', 'pending')
                   OR te.id IN (SELECT id FROM keep))
            ORDER BY te.id ASC
            LIMIT ${MAX_REPLAY_EVENTS + 1}`,
          [conversationId, sinceId, TRANSIENT_EVENT_TYPES],
        )
      : await sql<TurnEventRow>(
          `${KEEP}
           SELECT te.*
             FROM turn_events te
             JOIN conversation_turns ct ON ct.id = te.turn_id
            WHERE ct.conversation_id = $1
              AND (te.event_type <> ALL($2::text[])
                   OR ct.status IN ('streaming', 'pending')
                   OR te.id IN (SELECT id FROM keep))
            ORDER BY te.id ASC
            LIMIT ${MAX_REPLAY_EVENTS + 1}`,
          [conversationId, TRANSIENT_EVENT_TYPES],
        );

  if (rows.length > MAX_REPLAY_EVENTS) {
    // Never truncate silently (AGENTS.md): say what was dropped. Note the
    // client's Last-Event-ID only moves forward, so a gap here is not
    // re-requested on reconnect — this warning is the only signal.
    console.warn(
      `[turn-events] conversation ${conversationId} replay hit the ${MAX_REPLAY_EVENTS}-event ceiling` +
        ` (sinceId=${sinceId ?? "none"}); returning the oldest ${MAX_REPLAY_EVENTS} and dropping the rest.` +
        ` Expected only for a very long in-flight turn; settled turns contribute a handful of rows.`,
    );
    return rows.slice(0, MAX_REPLAY_EVENTS);
  }
  return rows;
}
