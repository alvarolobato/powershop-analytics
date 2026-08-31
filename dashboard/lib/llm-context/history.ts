/**
 * History assembly for LLM requests.
 *
 * Loads prior conversation turns and flattens them to `{ role, content }` lines.
 * Tool calls an assistant turn made are folded into that turn as a compact block
 * (`flattenStoredMessage` / `formatToolCallsForHistory`) so the tool context — the
 * query and its truncated result — is preserved for later turns.
 */

import { loadMessages } from "@/lib/conversations";
import type { ToolCallRecord } from "@/lib/conversation-types";
import {
  loadDashboardLlmConfig,
  getEffectiveDashboardModel,
  getEffectiveOpenRouterProvider,
} from "@/lib/llm-provider/config";
import {
  getOpenRouterClient,
  openRouterChatCompletion,
} from "@/lib/llm-provider/openrouter";
import { claudeCliSingleShot } from "@/lib/llm-provider/cli/claude-code";
import { isLlmEnabled } from "@/lib/llm-enabled";
import { callWithCircuitBreaker } from "@/lib/llm-circuit-breaker";
import { logUsage } from "@/lib/llm-usage";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/** Max chars kept per tool result when folding it into history (the "interesting part"). */
const HISTORY_TOOL_RESULT_MAX = 600;
/** Max chars kept per tool argument string when folding it into history. */
const HISTORY_TOOL_ARGS_MAX = 240;
/**
 * Tope TOTAL del bloque de herramientas ya ejecutadas, en caracteres.
 *
 * Cada resultado ya se capaba a `HISTORY_TOOL_RESULT_MAX` (600) y el historial
 * a 10 mensajes, pero no había tope por mensaje ni total. Un turno que explora
 * mucho genera un bloque enorme que viaja en CADA llamada de CADA turno
 * posterior de esa conversación, para siempre: medido el 31/08 en la
 * conversación 39990d7e7b0b, un solo mensaje de 25.419 chars (~8,5k tokens)
 * procedente de una exploración de 20 consultas.
 *
 * Se conservan las entradas MÁS RECIENTES —son las que tienen que ver con lo
 * que se está hablando ahora— y las viejas se resumen en una línea.
 */
const HISTORY_TOOL_LOG_MAX = 4_000;

/**
 * Max prior messages sent to the LLM per request. When a conversation exceeds
 * this, older messages are summarised into one synthetic assistant message
 * (see capHistory). Same cap the retired /api/dashboard/{modify,analyze}
 * routes applied via loadPriorTurns.
 */
export const HISTORY_MAX_MESSAGES = 10;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}

function compactArgs(args: unknown): string {
  let s: string;
  if (typeof args === "string") s = args;
  else {
    try {
      s = JSON.stringify(args);
    } catch {
      s = String(args);
    }
  }
  return truncate(s.replace(/\s+/g, " ").trim(), HISTORY_TOOL_ARGS_MAX);
}

function compactResult(result: unknown): string {
  if (result === undefined || result === null) return "(sin resultado)";
  const s =
    typeof result === "string"
      ? result
      : (() => {
          try {
            return JSON.stringify(result);
          } catch {
            return String(result);
          }
        })();
  return truncate(s.replace(/\s+/g, " ").trim(), HISTORY_TOOL_RESULT_MAX);
}

/**
 * Render the tool calls an assistant turn made into a compact, readable block so
 * later turns retain the "interesting part" — which tool ran, with what args, and
 * the (truncated) result the model saw. Returns "" when there are no tool calls.
 */
export const TOOL_LOG_OPEN_TAG = "<herramientas_ya_ejecutadas>";
export const TOOL_LOG_CLOSE_TAG = "</herramientas_ya_ejecutadas>";

/*
 * The framing this block used before 2026-08-29. Still recognised by
 * `looksLikeFabricatedToolLog` because it is what the model was shown for
 * months — conversations carrying it in their history can still prompt an
 * imitation of it, long after new turns stopped being formatted this way.
 */
/**
 * Raw tool-call markup from any provider.
 *
 * The UNAMBIGUOUS tokens below can never legitimately appear in a final
 * answer, so they fail a turn whatever it ran. The looser shapes in
 * LOOSE_TOOL_MARKUP can appear in prose and are gated on zero tool calls —
 * see looksLikeFabricatedToolLog for that split.
 *
 * The dashboard is model-agnostic on purpose — DeepSeek, Claude and OpenAI are
 * all supported targets — and each family serialises tool calls differently.
 * When the router fails to parse a family's markup into `tool_calls`,
 * `openrouter.ts` sees non-empty text and returns kind:"final", so the raw
 * markup is persisted as the answer. Production hit this with DeepSeek
 * (messages 582e0af1, b0e8a038, 0cd5c169 — one of them leaking real data rows
 * inside the block, so the tool HAD run and only the transcript was
 * mis-emitted), but nothing about the failure is DeepSeek-specific: it is a
 * parser gap, and every family has a dialect that can fall through it.
 *
 * Covered dialects:
 *   - DeepSeek:  `<|DSML|tool_calls>`, `<|tool_calls_begin|>` (fullwidth bars
 *                and the exact delimiters vary by build, so the inner token is
 *                matched rather than the punctuation)
 *   - Anthropic: `<function_calls>`, `<invoke name=...>`, `<parameter ...>`
 *   - OpenAI:    `<|python_tag|>`, harmony `<|channel|>commentary to=functions.`
 *   - Common:    `<tool_call>` / `[TOOL_CALLS]` (Llama, Mistral, Qwen)
 *
 * Split in two by how unambiguous each dialect is. The tokens below cannot
 * plausibly appear in a real answer, so they fail a turn regardless of what it
 * ran; the looser shapes in LOOSE_TOOL_MARKUP need the zero-tool-call
 * condition. Every alternative requires delimiter punctuation, never a bare
 * word, so prose mentioning "tool_calls" or "invoke" is not matched.
 */
const UNAMBIGUOUS_TOOL_MARKUP = new RegExp(
  [
    // DeepSeek — token between bar delimiters of any width.
    String.raw`[<\[][\s\S]{0,4}?(?:DSML|tool.{0,2}calls.{0,2}begin|tool.{0,2}call.{0,2}begin)`,
    // Anthropic-style XML blocks.
    String.raw`<\s*/?\s*function_calls\s*>`,
    String.raw`<\s*/?\s*invoke(?:\s+name\s*=|\s*>)`,
    // OpenAI harmony / python tag.
    String.raw`<\|python_tag\|>`,
    String.raw`<\|channel\|>\s*commentary\s+to\s*=`,
  ].join("|"),
  "i",
);

/**
 * Shapes that also occur in ordinary prose, so they are only evidence when the
 * turn made NO tool calls.
 *
 * `[TOOL_CALLS]` is matched case-SENSITIVELY: the Mistral/Llama sentinel is
 * uppercase, and a case-insensitive match fired on the markdown link
 * `[tool_calls](https://…)`. `<parameter …>` and `<tool_call>` appear in any
 * answer that shows an XML snippet, which is a realistic thing to ask a data
 * assistant for.
 */
const LOOSE_TOOL_MARKUP = new RegExp(
  [
    String.raw`<\s*/?\s*parameter(?:\s+name\s*=|\s*>)`,
    String.raw`<\s*/?\s*tool_calls?\s*>`,
    String.raw`\[TOOL_CALLS\]`,
  ].join("|"),
);

export const LEGACY_TOOL_LOG_HEADER =
  "[Datos consultados con herramientas en esta respuesta]";

export function formatToolCallsForHistory(toolCalls: ToolCallRecord[]): string {
  if (!toolCalls || toolCalls.length === 0) return "";
  const todas = toolCalls.map((tc) => {
    const status = tc.success === false ? " [error]" : "";
    return `- ${tc.name}(${compactArgs(tc.arguments)})${status} → ${compactResult(tc.result)}`;
  });

  // Se recorta desde el final hacia atrás: lo reciente es lo relevante.
  const lines: string[] = [];
  let usados = 0;
  for (let i = todas.length - 1; i >= 0; i--) {
    const coste = todas[i].length + 1;
    if (usados + coste > HISTORY_TOOL_LOG_MAX && lines.length > 0) break;
    lines.unshift(todas[i]);
    usados += coste;
  }
  const omitidas = todas.length - lines.length;
  if (omitidas > 0) {
    lines.unshift(
      `- (…y ${omitidas} llamada(s) anterior(es) de ese turno, omitidas por longitud)`,
    );
  }
  // Framed as a tagged system record rather than a bracketed heading, and
  // prepended to the assistant's own words in `flattenStoredMessage`.
  //
  // The old framing was a plain Spanish heading that read exactly like
  // something an assistant says, so after a few turns every prior assistant
  // message in history began with it — and on 2026-08-28 the model completed
  // the pattern instead of using the tools: two consecutive turns in
  // conversation 0a566ce7cc78 returned a hand-written imitation of this block
  // (no ` → result` on any line, because it had no results) with ZERO real
  // tool calls, and the user had to ask three times. A closing tag and an
  // explicit "do not reproduce" make the block read as an out-of-band record
  // of what already ran, not as a house style for answers.
  return [
    TOOL_LOG_OPEN_TAG,
    "(registro del sistema: herramientas que YA se ejecutaron en ese turno.",
    "Nunca reproduzcas este bloque en una respuesta — para consultar datos,",
    "invoca la herramienta de verdad.)",
    ...lines,
    TOOL_LOG_CLOSE_TAG,
  ].join("\n");
}

/**
 * True when an assistant turn's final text is the model *describing* tool
 * calls instead of making them.
 *
 * The signature is unambiguous: code only ever emits this block into history,
 * never into a stored message, and only ever when there were tool calls to
 * report. So this shape arriving as a turn's answer with `actualToolCalls === 0`
 * means the model wrote it. Requiring the zero-call condition is what keeps a
 * genuine turn — one that really ran tools and happens to quote itself — from
 * tripping the guard.
 */
/**
 * ¿La respuesta es una ESPECIFICACIÓN de dashboard en vez de una respuesta?
 *
 * En free-chat el usuario pregunta por cifras. Un JSON con `widgets` no es la
 * respuesta: es la receta para construir un panel, y en el chat se ve como un
 * muro de JSON. El 2026-08-31 una pregunta de rentabilidad por proveedor
 * terminó así -- 20 consultas correctas, 11 KB de spec pegados en el texto, el
 * turno guardado como `complete` y el usuario sin ningún resultado.
 *
 * `looksLikeFabricatedToolLog` no lo cazaba y no debía: exige
 * `actualToolCalls === 0` para sus formas ambiguas, y aquí hubo 26 llamadas
 * reales. El turno hizo el trabajo; lo que falló fue la FORMA de contestar.
 *
 * Para pedir un panel existe `start_dashboard_generation`. Un spec inline
 * significa que el modelo se saltó la herramienta, así que exigir que no haya
 * habido llamada a esa herramienta evita marcar el caso legítimo en el que el
 * modelo explica lo que la herramienta acaba de generar.
 */
export function looksLikeDashboardSpecInsteadOfAnswer(
  text: string,
  calledDashboardGeneration: boolean,
): boolean {
  if (calledDashboardGeneration) return false;
  const t = text ?? "";
  if (!t) return false;
  // Un spec real trae `widgets` como array JUNTO con `sql` o un tipo de widget.
  // Sólo `widgets` es demasiado laxo: cabe en una frase ("el panel tiene 4
  // widgets") y marcaría respuestas correctas.
  const tieneWidgets = /"widgets"\s*:\s*\[/.test(t);
  if (!tieneWidgets) return false;
  return /"(sql|kpi_row|bar_chart|line_chart|area_chart|donut_chart|ranked_bars|insights_strip)"/.test(
    t,
  );
}

export function looksLikeFabricatedToolLog(
  text: string,
  actualToolCalls: number,
): boolean {
  const t = (text ?? "").trimStart();
  if (!t) return false;

  // ── Unambiguous provider markup: checked BEFORE the tool-call count ──
  //
  // Raw tool-call syntax is never a valid final answer, whatever ran earlier
  // in the turn. Gating this behind `actualToolCalls === 0` disabled it in
  // exactly the case it was written for: round 1 calls execute_query
  // successfully (count = 3), round 2 emits markup the router fails to parse,
  // openrouter.ts sees non-empty text and returns kind:"final" — and the guard
  // waves the markup through to the user as a completed answer. `ctx.toolCalls`
  // accumulates across rounds and is never reset, so the count at the persist
  // seam is the whole turn's, which is what made the gate wrong here.
  if (UNAMBIGUOUS_TOOL_MARKUP.test(t)) return true;

  // ── Everything below needs the zero-call condition ──
  //
  // These shapes can legitimately appear in prose, so they are only suspicious
  // when the turn produced no tool calls at all. That condition is what keeps
  // a turn which really ran tools — and happens to quote itself — alive.
  if (actualToolCalls > 0) return false;

  if (LOOSE_TOOL_MARKUP.test(t)) return true;

  // `includes`, not `startsWith`: one word of preamble ("Claro, aquí tienes:")
  // defeated an anchored check, and this PR changes the very block the model
  // imitates, so betting the imitation stays at position 0 is unwarranted. The
  // call-line requirement below is what makes searching anywhere safe.
  const framed =
    t.includes(TOOL_LOG_OPEN_TAG) || t.includes(LEGACY_TOOL_LOG_HEADER);
  if (!framed) return false;
  // A turn that merely *mentions* the framing (the user asked what the block
  // is) must survive: it has to actually list call-shaped lines.
  return /^-\s*\w+\s*\(/m.test(t);
}

/**
 * Flatten a stored conversation_messages row to a single history line for the LLM,
 * or null to skip it. User/assistant text is extracted from the JSONB content;
 * tool calls recorded on an assistant message are folded in as a compact block so
 * the conversational context (including tool results) is preserved across turns.
 * Standalone tool-role rows are skipped — tool context lives on the assistant row.
 */
export function flattenStoredMessage(row: {
  role: string;
  content: unknown;
}): HistoryMessage | null {
  if (row.role !== "user" && row.role !== "assistant") return null;

  const c = row.content;
  let text = "";
  let toolCalls: ToolCallRecord[] | undefined;

  if (typeof c === "string") {
    text = c;
  } else if (c !== null && typeof c === "object" && !Array.isArray(c)) {
    const obj = c as Record<string, unknown>;
    let recognized = false;
    if (typeof obj.text === "string") {
      text = obj.text;
      recognized = true;
    }
    if (Array.isArray(obj.tool_calls)) {
      toolCalls = obj.tool_calls as ToolCallRecord[];
      recognized = true;
    }
    // Only stringify genuinely unknown content shapes — an object with a known
    // (but empty) text field is an empty turn, which we skip below.
    if (!recognized) text = JSON.stringify(c);
  } else {
    text = JSON.stringify(c);
  }

  // Drain the priming. The 13 fabricated messages already in production carry
  // the legacy heading in their stored text, and this function replays that
  // text verbatim — so in exactly the conversations that already relapsed, the
  // model keeps being shown the pattern it copied. The reframing above only
  // affects blocks RENDERED from tool_calls; a fabrication is plain text and
  // is immune to it. Skipping these rows costs nothing (they contain no real
  // answer) and stops old damage causing new damage.
  if (
    row.role === "assistant" &&
    looksLikeFabricatedToolLog(text, toolCalls?.length ?? 0)
  ) {
    return null;
  }

  if (row.role === "assistant" && toolCalls && toolCalls.length > 0) {
    const block = formatToolCallsForHistory(toolCalls);
    text = text ? `${block}\n\n${text}` : block;
  }

  if (!text) return null;
  return { role: row.role as "user" | "assistant", content: text };
}

/**
 * Build conversation history for an LLM request, capped at
 * HISTORY_MAX_MESSAGES (older messages summarised — see capHistory).
 *
 * Priority:
 * 1. If `opts.priorMessages` is provided, cap and return them (caller pre-loaded).
 * 2. If `conversationId` is provided, load from DB, flatten, cap.
 * 3. Otherwise return [].
 *
 * Flattening: extracts `.text` from JSONB content objects, falls back to JSON.stringify.
 * Tool calls recorded on an assistant message are folded into that turn as a compact
 * block (see `flattenStoredMessage`) so tool results persist as context across turns.
 */
export async function buildHistory(
  conversationId: string | null,
  opts?: { priorMessages?: HistoryMessage[]; flow?: string },
): Promise<HistoryMessage[]> {
  if (opts?.priorMessages)
    return capHistory(opts.priorMessages, HISTORY_MAX_MESSAGES, opts.flow);
  if (!conversationId) return [];

  const rows = await loadMessages(conversationId);
  const messages: HistoryMessage[] = [];

  for (const row of rows) {
    const flat = flattenStoredMessage(row);
    if (flat) messages.push(flat);
  }

  return capHistory(messages, HISTORY_MAX_MESSAGES, opts?.flow);
}

// ── History capping + summarisation ───────────────────────────────────────────

/** Max chars of older user prompts fed to the summarisation LLM call (and used
 *  verbatim as the fallback summary). Keeps the bounding call itself bounded. */
const SUMMARY_INPUT_MAX_CHARS = 4_000;

/**
 * Bound the history sent to the LLM. When `messages` exceeds `maxMessages`,
 * the older ones are summarised (small LLM call) into a single synthetic
 * assistant message followed by the (maxMessages - 1) most recent messages.
 * No-op (and no LLM call) when the history is within the cap — callers may
 * invoke this redundantly without cost.
 *
 * `flow` routes the summarisation call through the same per-flow model/provider
 * overrides as the parent request (see getEffectiveDashboardModel).
 */
export async function capHistory(
  messages: HistoryMessage[],
  maxMessages: number = HISTORY_MAX_MESSAGES,
  flow?: string,
): Promise<HistoryMessage[]> {
  if (messages.length <= maxMessages) return messages;
  if (maxMessages < 2) return maxMessages <= 0 ? [] : messages.slice(-1);

  const recentCount = maxMessages - 1;
  const oldMessages = messages.slice(0, messages.length - recentCount);
  const recentMessages = messages.slice(messages.length - recentCount);

  const summary = await buildSummary(oldMessages, flow);
  return [
    {
      role: "assistant",
      content: `Earlier in this conversation the user requested: ${summary}`,
    },
    ...recentMessages,
  ];
}

/**
 * Summarise older user requests via a small LLM call. Falls back to the
 * (bounded) raw user prompts when the LLM call fails — capping must never make
 * a turn fail. Input is whitespace-normalised and capped at
 * SUMMARY_INPUT_MAX_CHARS (most recent prompts win) so the summarisation
 * request stays small regardless of conversation length.
 */
async function buildSummary(
  messages: HistoryMessage[],
  flow?: string,
): Promise<string> {
  // Most recent old prompts are the most relevant — accumulate from the end
  // until the char budget is spent, then restore chronological order.
  const bullets: string[] = [];
  let budget = SUMMARY_INPUT_MAX_CHARS;
  const userMessages = messages.filter((m) => m.role === "user");
  for (let i = userMessages.length - 1; i >= 0 && budget > 0; i--) {
    const line = `- ${userMessages[i].content.replace(/\s+/g, " ").trim().slice(0, 200)}`;
    bullets.push(line);
    budget -= line.length + 1;
  }
  const userPrompts = bullets.reverse().join("\n");

  const cfg = loadDashboardLlmConfig();

  // This function calls the providers DIRECTLY — it does not go through
  // llmComplete or runAgenticChat — so neither the kill switch nor the
  // e2e-stub short-circuit in turn-background reaches it. Both have to be
  // honoured here explicitly, or they are not honoured at all:
  //
  //   - The master switch is meant to mean "no model calls, full stop". A
  //     conversation past HISTORY_MAX_MESSAGES would otherwise still fire a
  //     real, billed summarisation call with the switch off — the worst kind
  //     of failure for a control whose whole value is that you can trust it.
  //   - turn-background calls capHistory() unconditionally, BEFORE its
  //     e2e-stub branch, so without this a long enough conversation would
  //     make a real external call from CI.
  //
  // Returning `userPrompts` is not a new degradation path: it is the same
  // bounded fallback both catch blocks below already use when the call fails.
  if (!isLlmEnabled() || cfg.provider === "e2e-stub") {
    return userPrompts;
  }

  const prompt = `Summarise the following prior user requests in a short bulleted list (one line each, max 300 chars total). Respond with only the bullet list, no preamble.\n\n${userPrompts}`;

  const flowArg = flow as Parameters<typeof getEffectiveDashboardModel>[1];
  const model = getEffectiveDashboardModel(cfg, flowArg);
  const provider = getEffectiveOpenRouterProvider(cfg, flowArg);

  if (cfg.provider === "cli") {
    try {
      const { text, usage } = await callWithCircuitBreaker(() =>
        claudeCliSingleShot({ cfg, prompt }),
      );
      // This branch logged no usage at all before the CLI envelope was
      // parsed — history summarisation fires on every long conversation and
      // was free as far as `llm_usage` was concerned.
      logUsage(
        "dashboard/history/summarise",
        model,
        {
          prompt_tokens: usage?.prompt_tokens ?? 0,
          completion_tokens: usage?.completion_tokens ?? 0,
          total_tokens: usage?.total_tokens ?? 0,
          cache_creation_input_tokens:
            usage?.cache_creation_input_tokens ?? null,
          cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
        },
        { provider: "cli", driver: cfg.cliDriver },
        { reportedCostUsd: usage?.cost_usd ?? null },
      );
      return text;
    } catch {
      return userPrompts;
    }
  }

  try {
    const client = getOpenRouterClient();
    const { content, usage, reportedCostUsd } = await callWithCircuitBreaker(
      () =>
        openRouterChatCompletion({
          client,
          model,
          messages: [{ role: "user" as const, content: prompt }],
          temperature: 0.1,
          maxTokens: 200,
          provider,
        }),
    );
    if (usage) {
      logUsage(
        "dashboard/history/summarise",
        model,
        {
          prompt_tokens: usage.prompt_tokens ?? 0,
          completion_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
        },
        undefined,
        // openRouterChatCompletion now returns the provider's own figure; this
        // call site was the one that still dropped it. Small (200 max tokens)
        // but it fires on every long conversation.
        { reportedCostUsd },
      );
    }
    return content || userPrompts;
  } catch {
    return userPrompts;
  }
}
