/**
 * Handler for the `start_dashboard_generation` tool.
 *
 * ── D-049: async by design ──────────────────────────────────────────────────
 * `generateDashboard()` runs a full multi-round agentic loop (several LLM
 * calls + SQL exploration) and cannot possibly finish inside the per-tool
 * dispatch timeout every tool call is wrapped in (`withTimeout` in
 * llm-tools/runner.ts, `DASHBOARD_AGENTIC_TOOL_TIMEOUT_MS` = 15s in prod).
 * Before this fix the tool had a 100% TOOL_TIMEOUT rate in production
 * (llm_tool_calls: 10 calls, 10 errors, 2026-08-12..2026-08-26 — it had never
 * once succeeded).
 *
 * The handler now only *starts* the generation and returns immediately with
 * an acknowledgement; the model is expected to tell the user generation is
 * under way and end its turn, not wait or re-call the tool. The generation
 * itself runs detached (`runBackgroundGeneration`, not awaited here) and
 * reports back through the SAME machinery `runTurnBackground` uses for a
 * normal turn: a tracking `conversation_turns` row + `turn_events` (so a live
 * SSE client sees progress and a "complete"/"error" frame) plus a persisted
 * `conversation_messages` row (so the result is visible on reload even if no
 * client was listening when it finished). A failure is never swallowed: it is
 * logged, turned into an `is_error` assistant message, and surfaced as an
 * `error` turn_event — mirroring runTurnBackground's own catch block. Even a
 * failure to create the tracking row itself (no `turnId`, so no turn_event
 * possible) still reaches the user as an `is_error` assistant message —
 * otherwise the tool's own "se está generando" response would be the last
 * thing they ever heard about it.
 */

import { generateDashboard } from "@/lib/llm";
import { validateSpec, type DashboardSpec } from "@/lib/schema";
import { lintDashboardSpec } from "@/lib/sql-heuristics";
import { ZodError } from "zod";
import { sql } from "@/lib/db-write";
import { appendMessage, migrateConversationToDashboard } from "@/lib/conversations";
import { createBackgroundTurn, insertTurnEvent, updateTurnStatus } from "@/lib/turn-events";
import { publish } from "@/lib/sse-pubsub";
import { toolOk, toolError, type ToolResponseBody } from "@/lib/llm-tools/tool-payload";
import type { AgenticProgressEvent, LlmAgenticContext } from "@/lib/llm-tools/types";

interface StartDashboardGenerationArgs {
  prompt: string;
}

interface GeneratedDashboard {
  dashboardId: number;
  redirectUrl: string;
  summary: string;
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

export async function handleStartDashboardGeneration(
  rawArgs: string,
  ctx: LlmAgenticContext,
): Promise<ToolResponseBody> {
  let args: StartDashboardGenerationArgs;
  try {
    args = JSON.parse(rawArgs) as StartDashboardGenerationArgs;
  } catch {
    return toolError("INVALID_ARGS", "Invalid JSON arguments.", ctx);
  }

  if (!args.prompt || typeof args.prompt !== "string" || !args.prompt.trim()) {
    return toolError("INVALID_ARGS", "The 'prompt' field is required and must be a non-empty string.", ctx);
  }
  const prompt = args.prompt.trim();

  // Detached on purpose — see module doc. Any failure this promise itself
  // raises (as opposed to failures INSIDE the generation, which
  // runBackgroundGeneration already catches and reports) is a last-resort net
  // so it is still never a silent drop, just a server log.
  void runBackgroundGeneration(prompt, ctx).catch((err) => {
    console.error(
      `[${ctx.requestId}] start_dashboard_generation: unrecoverable background failure:`,
      err,
    );
  });

  // What the model sees on ITS NEXT round: the generation has only just
  // started, not finished. The message is deliberately explicit about what
  // NOT to do (poll, re-call, wait) because a model told merely "started"
  // tends to call the tool again or stall a round waiting for a result that
  // will never arrive on this turn.
  return toolOk({
    status: "started",
    message:
      "La generación del panel se ha iniciado en segundo plano (tarda entre 30s y 2 min). " +
      "NO vuelvas a llamar a start_dashboard_generation en este turno ni esperes aquí: el panel terminado " +
      "(con enlace para abrirlo) aparecerá automáticamente como un nuevo mensaje en esta conversación cuando " +
      "esté listo. Responde ya al usuario confirmando que el panel se está generando.",
  });
}

/**
 * Runs the actual generation to completion, detached from the tool call that
 * started it. Never throws to its caller — every failure path here ends in a
 * logged error plus (when a conversation is attached) a persisted `is_error`
 * message and an `error` turn_event, so nothing about a failed background run
 * is invisible the way swallowed errors have repeatedly been in this codebase.
 */
async function runBackgroundGeneration(prompt: string, ctx: LlmAgenticContext): Promise<void> {
  const conversationId = ctx.conversationId;

  // No conversation to report back to — not a real production path (the tool
  // is only exposed in the free-chat catalog, which always sets
  // conversationId), but keep it non-throwing for direct/test callers: run
  // best-effort and only log.
  if (!conversationId) {
    try {
      await generateAndPersist(prompt, ctx);
    } catch (err) {
      console.error(`[${ctx.requestId}] start_dashboard_generation (no conversation):`, err);
    }
    return;
  }

  let turnId: string;
  try {
    turnId = await createBackgroundTurn(conversationId, `[start_dashboard_generation] ${prompt}`);
  } catch (err) {
    console.error(
      `[${ctx.requestId}] start_dashboard_generation: could not create tracking turn:`,
      err,
    );
    // No turnId exists yet, so there is no turn_event to emit — but the user
    // was already told "se está generando" by the tool's own response and,
    // without this, would simply never hear anything again (review finding:
    // this catch used to only console.error, contradicting D-049's own claim
    // that every failure path, "incluso fallar al crear la fila de
    // seguimiento", is shown to the user). appendMessage doesn't need a
    // turnId, so post the failure straight to the conversation instead.
    try {
      await appendMessage(conversationId, "assistant", {
        text: "No se pudo iniciar el seguimiento de la generación del panel (error de base de datos). Inténtalo de nuevo.",
        is_error: true,
      });
    } catch (persistErr) {
      console.error(
        `[${ctx.requestId}] start_dashboard_generation: could not persist tracking-turn failure message:`,
        persistErr,
      );
    }
    return;
  }

  let seq = 0;
  const emit = async (eventType: string, payload: Record<string, unknown>): Promise<void> => {
    try {
      const thisSeq = seq++;
      const dbEventId = await insertTurnEvent(turnId, thisSeq, eventType, payload);
      publish(conversationId, { dbEventId, turnId, seq: thisSeq, eventType, payload });
    } catch (err) {
      console.warn(`[${ctx.requestId}] start_dashboard_generation: emit ${eventType} failed:`, err);
    }
  };

  await emit("log", {
    kind: "meta",
    text: `Generando panel: "${prompt}"…`,
    ts: new Date().toISOString(),
  });

  // Route the nested agentic loop's own tool calls (execute_query,
  // describe_ps_table, etc. — generateDashboard runs its own tool-calling
  // round trip) onto this tracking turn as log lines, so a live viewer sees
  // progress instead of silence for the whole run. Token/thinking deltas are
  // intentionally ignored: the generate flow's final output is a raw JSON
  // spec, not prose worth streaming.
  const genCtx: LlmAgenticContext = {
    requestId: ctx.requestId,
    endpoint: "start_dashboard_generation",
    llmProvider: ctx.llmProvider,
    llmDriver: ctx.llmDriver,
    onAgenticProgress: (event: AgenticProgressEvent) => {
      if (event.type === "tool_start") {
        void emit("log", { kind: "tool", text: `▶ ${event.name}`, ts: new Date().toISOString() });
      } else if (event.type === "tool_done") {
        void emit("log", {
          kind: "tool",
          text: `${event.ok ? "✓" : "✗"} ${event.name} (${event.ms}ms)`,
          ts: new Date().toISOString(),
        });
      }
    },
  };

  try {
    const { summary } = await generateAndPersist(prompt, genCtx, conversationId);
    const msg = await appendMessage(conversationId, "assistant", { text: summary });
    await emit("complete", { messageId: msg.id });
    await updateTurnStatus(turnId, "complete");
  } catch (err) {
    const errText = err instanceof Error ? err.message : "Dashboard generation failed.";
    console.error(
      `[${ctx.requestId}] start_dashboard_generation: background generation failed:`,
      err,
    );
    let errorMessageId: string | undefined;
    try {
      const errorMsg = await appendMessage(conversationId, "assistant", {
        text: errText,
        is_error: true,
      });
      errorMessageId = errorMsg.id;
    } catch (persistErr) {
      console.error(
        `[${ctx.requestId}] start_dashboard_generation: could not persist error message:`,
        persistErr,
      );
    }
    await emit("error", {
      message: errText,
      ts: new Date().toISOString(),
      ...(errorMessageId ? { messageId: errorMessageId } : {}),
    });
    await updateTurnStatus(turnId, "error", errText).catch(() => {});
  }
}

/**
 * Generates the dashboard spec via the LLM, validates it, persists it, and
 * (best-effort) migrates the conversation to dashboard context. Throws a
 * plain Error (message prefixed with the original tool error code, kept for
 * log grep-ability) on any failure — the caller is responsible for reporting.
 */
async function generateAndPersist(
  prompt: string,
  ctx: LlmAgenticContext,
  conversationId?: string,
): Promise<GeneratedDashboard> {
  let rawResponse: string;
  try {
    rawResponse = await generateDashboard(prompt, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Dashboard generation failed.";
    throw new Error(`GENERATE_FAILED: ${msg}`);
  }

  const jsonStr = extractJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("INVALID_SPEC: The LLM returned an invalid JSON spec.");
  }

  let spec: DashboardSpec;
  try {
    spec = validateSpec(parsed);
  } catch (err) {
    const details =
      err instanceof ZodError
        ? err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : "Spec validation failed";
    throw new Error(`INVALID_SPEC: Dashboard spec is invalid: ${details}`);
  }

  const sqlLint = lintDashboardSpec(spec);
  if (sqlLint.length > 0) {
    throw new Error(`SQL_LINT: Generated dashboard contains invalid SQL patterns: ${sqlLint.join(" | ")}`);
  }

  const title = spec.title;
  const description = spec.description ?? null;
  let dashboardId: number;
  try {
    const rows = await sql<{ id: number }>(
      `INSERT INTO dashboards (name, description, spec)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [title, description, JSON.stringify(spec)],
    );
    const row = rows[0];
    if (!row?.id) throw new Error("INSERT dashboards did not return an id");
    dashboardId = row.id;
  } catch (err) {
    console.error(`[${ctx.requestId}] start_dashboard_generation: DB insert failed:`, err);
    throw new Error("DB_ERROR: Failed to save the dashboard.");
  }

  const redirectUrl = conversationId
    ? `/dashboard/${dashboardId}?tab=modify&continue=${encodeURIComponent(conversationId)}`
    : `/dashboard/${dashboardId}?tab=modify`;

  // Migrate the conversation to dashboard context (mode='modify', context_kind,
  // context_ref AND context_url — same semantics as the D-032 handoff endpoint).
  // Without the mode change, follow-up turns would still dispatch as free chat,
  // which has no apply_dashboard_modification tool.
  // Best-effort: if it fails the dashboard was still created successfully.
  if (conversationId) {
    try {
      await migrateConversationToDashboard(conversationId, String(dashboardId));
    } catch (err) {
      console.warn(
        `[${ctx.requestId}] start_dashboard_generation: migrateConversationToDashboard failed:`,
        err,
      );
    }
  }

  return {
    dashboardId,
    redirectUrl,
    summary: `Panel "${title}" creado con ${spec.widgets.length} widget(s). Visita ${redirectUrl} para revisarlo y modificarlo.`,
  };
}
