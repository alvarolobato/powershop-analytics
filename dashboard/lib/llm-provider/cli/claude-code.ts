/**
 * Claude Code CLI driver: non-interactive `claude -p` with `--model` and JSON protocol rounds.
 * Large prompts are passed on stdin to avoid OS argv limits (E2BIG).
 */

import type { DashboardLlmConfig } from "../types";
import { runCliProcess, runCliProcessStreaming, assertCliSuccess } from "./process";
import { CliRunnerError } from "./errors";
import { serializeChatMessagesForCli } from "./transcript";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { DASHBOARD_AGENTIC_TOOLS } from "@/lib/llm-tools/catalog";
import { sanitize, sanitizeArgv, sanitizeTail } from "../sanitize";
import { triggerHostTokenSync } from "./host-token-sync";
import { parseCliReportedUsage, type CliReportedUsage } from "./usage";

/**
 * Flags passed on EVERY CLI invocation — a security control, not a cost
 * optimization, so this must never be gated behind a debug/lean toggle.
 *
 * `--tools ""` disables Claude Code's own built-in tool catalog (Bash, Edit,
 * Write, Read…). Prompts reaching this driver carry free-form user chat text
 * and, in the single-shot path, LLM-generated SQL — both untrusted content by
 * construction, delivered on stdin. With the native tools armed, a prompt
 * injection hiding in that content could persuade the model to run a shell
 * command or write a file on the container's host. Neither call path here
 * needs Claude's own tools: single-shot only produces text, and the agentic
 * protocol has the SERVER execute tools — the CLI only ever emits a JSON
 * envelope *naming* a tool call (see `AGENTIC_PROTOCOL_INSTRUCTION` below and
 * `dashboard/lib/llm-tools/runner.ts`, which dispatches `tc.function.name` to
 * its own handler map) — so there is nothing lost by disabling them.
 *
 * `--no-session-persistence` keeps that same chat/SQL content out of
 * on-disk session transcripts on the host running the CLI.
 */
export const CLI_SAFETY_ARGS: readonly string[] = ["--tools", "", "--no-session-persistence"];

/**
 * Flags that strip the Claude Code harness context from a non-interactive
 * run — purely a cost optimization, gated by `cfg.cliLeanMode` (see
 * `leanArgs` below) so it can be turned off to debug a flow. Safe to gate
 * precisely because the security-relevant flags live in `CLI_SAFETY_ARGS`
 * above, which is never gated.
 *
 * - `--disable-slash-commands`  skill/slash-command definitions.
 * - `--strict-mcp-config`       ignore ambient MCP servers (we pass none).
 * - `--setting-sources ""`      ignore user/project/local settings files.
 *
 * `claude -p` is an agent harness, not a bare completion endpoint: invoked
 * with defaults it prepends its own Claude Code system prompt, the full
 * built-in tool catalog, discovered CLAUDE.md/AGENTS.md files, MCP server
 * definitions, and user/project settings to EVERY call. Measured on the
 * owner's machine, identical trivial task (`reply with exactly: OK`), same
 * binary, back to back:
 *
 *   default flags:     25,664 input tokens (9 input + 7,521 cache-write +
 *                       18,134 cache-read)  →  $0.017628
 *   CLI_LEAN_ARGS + --system-prompt:  167 input tokens  →  $0.001011
 *
 * 17.4x on a task whose real content is a dozen tokens. None of that
 * harness context is useful here: the dashboard supplies its own domain
 * prompt, and the agentic protocol has the SERVER execute tools (the model
 * only emits a JSON envelope naming them — see `AGENTIC_PROTOCOL_INSTRUCTION`
 * below and `dashboard/lib/llm-tools/runner.ts`), so Claude's own tools are
 * never invoked regardless of whether the harness that would offer them is
 * present.
 *
 * Deliberately NOT included: `--bare`, the CLI's own more-minimal mode. It
 * forces `ANTHROPIC_API_KEY` auth and never reads the OAuth credentials file
 * the launchd sync maintains (D-025) — under this project's OAuth
 * single-refresher arrangement that would break authentication outright, not
 * just skip a cost optimization.
 */
export const CLI_LEAN_ARGS: readonly string[] = [
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--setting-sources",
  "",
];

/**
 * Per-call argv prefix that strips the Claude Code harness context (when
 * `cfg.cliLeanMode` is on) and, for the single-shot path, delivers the
 * flow's domain content on `--system-prompt`.
 *
 * `systemPrompt` here is the exact value that will land in the CLI's
 * system-prompt channel for this call — for `claudeCliSingleShotOnce` that's
 * the caller's stable domain block (when the flow is safe to put there — see
 * `llm-client.ts`'s `CLI_SYSTEM_PROMPT_SAFE_FLOWS`) with `SINGLE_SHOT_PRINT_ARG`
 * appended as a suffix, or just the shim alone when the flow isn't; for the
 * agentic path it's always just `AGENTIC_PROTOCOL_INSTRUCTION` (a fixed
 * constant, so it never varies per call and is always safe to put here).
 *
 * `cfg.cliLeanMode = false` restores the previous full-harness behaviour as
 * an escape hatch: `--system-prompt` is then omitted entirely by this
 * function (it would REPLACE the harness default, defeating the escape
 * hatch's whole point), so `claudeCliSingleShotOnce` instead layers the
 * domain content on top of the harness default via `--append-system-prompt`
 * (see its own comment).
 */
function leanArgs(cfg: DashboardLlmConfig, systemPrompt: string): string[] {
  // CLI_SAFETY_ARGS is unconditional — see its own comment above. Only the
  // cost-saving flags are gated.
  if (!cfg.cliLeanMode) return [...CLI_SAFETY_ARGS];
  return [...CLI_SAFETY_ARGS, ...CLI_LEAN_ARGS, "--system-prompt", systemPrompt];
}

/**
 * Run a CLI operation and, on `LLM_CLI_AUTH` failure (typically caused by an
 * out-of-band rotation of the Keychain refresh_token while the container was
 * holding the previous access_token), trigger an on-demand sync of the host
 * Keychain into the credentials file via launchd's WatchPaths and retry once.
 *
 * Strict scope: this NEVER refreshes the token itself — the kick fires the
 * existing host-side sync-only script. Single-refresher rule (D-025) stands.
 */
async function withAuthAutoRecovery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!(err instanceof CliRunnerError) || err.code !== "LLM_CLI_AUTH") {
      throw err;
    }
    const sync = await triggerHostTokenSync();
    if (!sync.ok) {
      // Plumbing missing on the host — the retry would fail the same way.
      // Surface the original auth error verbatim.
      console.warn(
        `[claude-cli] auth-recovery skipped: ${sync.reason}`,
      );
      throw err;
    }
    const note = "timeout" in sync && sync.timeout
      ? `mtime didn't advance within ${sync.waitedMs}ms — retrying anyway`
      : `creds refreshed in ${sync.waitedMs}ms`;
    console.warn(`[claude-cli] LLM_CLI_AUTH → kicked host launchd, ${note}; retrying once`);
    return await operation();
  }
}

/** Tail size to retain on CliRunnerError details (matches process.ts). */
const TAIL_MAX_BYTES = 4096;

/**
 * Protocol shim for the single-shot path. Always constant, always sent as
 * the SUFFIX of the effective system-prompt content — the domain block (when
 * present) goes first because that's what needs to be the stable, byte-
 * identical PREFIX for the CLI's own prompt-cache breakpoint to anchor on
 * (irrelevant to the token-count win above, which comes from stripping the
 * harness; relevant to why order matters once a flow does put its stable
 * block here).
 *
 * "Your system prompt (above this instruction)" stays literally true in
 * every case: with a domain block it's the caller-built `cliSystemPrompt`
 * (see `claudeCliSingleShotOnce`) delivered via `--system-prompt` (lean mode
 * on) or `--append-system-prompt` (lean mode off); without one (an unsafe
 * flow, or a call with no domain prompt at all) it's just this shim, and
 * stdin's own `## system` section (built by `llm-client.ts`) carries
 * whatever domain content didn't go on the flag.
 */
const SINGLE_SHOT_PRINT_ARG = `You are the dashboard assistant.
Your system prompt (above this instruction) may carry the flow's domain
instructions. The UTF-8 stdin carries the per-call context and task (## system
for any domain content not delivered above, ## user, ## assistant, etc.).
Execute the task and write the answer to stdout only.`;

const AGENTIC_PROTOCOL_INSTRUCTION = `You are the dashboard agentic planner. Reply with ONE JSON object only, no markdown fences, no prose.

Schema:
1) Final assistant text to show the user:
{"kind":"final","content":"<string>"}

2) Request tool calls (server will execute them and send you tool results):
{"kind":"tools","calls":[{"name":"<tool_name>","arguments":"<JSON string of args>"}]}

UTF-8 stdin format:
- After the line TOOL_CATALOG_JSON comes one line of minified JSON (OpenAI tools array).
- After the line TRANSCRIPT comes the conversation text (markdown sections).

Use exact tool names from the tool catalog JSON. Arguments must be a JSON string (escaped JSON inside JSON), matching OpenAI function-calling style.`;

function buildCompactToolCatalogJson(): string {
  const tools = DASHBOARD_AGENTIC_TOOLS.filter((t) => t.type === "function").map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
  return JSON.stringify(tools);
}

function buildAgenticStdin(transcript: string): string {
  return `TOOL_CATALOG_JSON\n${buildCompactToolCatalogJson()}\nTRANSCRIPT\n${transcript}\n`;
}

export interface ClaudeCliSingleShotInput {
  cfg: DashboardLlmConfig;
  /**
   * Task body written to stdin. When `systemPrompt` is set, this is the
   * flow's volatile context (if any) plus the conversation turns — the
   * caller (`llm-client.ts`) strips the stable domain block out of it so it
   * isn't sent twice. When `systemPrompt` is omitted, this is the full
   * combined prompt exactly as before this driver supported a separate
   * system-prompt channel.
   */
  prompt: string;
  /**
   * The flow's domain system-prompt content, delivered ahead of the
   * protocol shim via `--system-prompt` (lean mode on) or
   * `--append-system-prompt` (lean mode off) — never silently dropped.
   *
   * Only ever set by the caller for flows on the
   * `CLI_SYSTEM_PROMPT_SAFE_FLOWS` allow-list (`llm-client.ts`) — every
   * other flow's `buildSystemPrompt().stable` was found, on audit, to
   * interpolate per-call data (a serialized dashboard, query results, a
   * role, an existing-dashboard list) straight into what the rest of the
   * app treats as the cache-stable prefix. Putting per-call data on this
   * flag would mean it lands on `--system-prompt`, the one channel this
   * driver also uses (lean mode off) via `--append-system-prompt` — both are
   * meant to be call-invariant, so a `--system-prompt`/`--append-system-prompt`
   * mismatch there would be silent, not a crash. See
   * `docs/decisions/D-046-cli-lean-mode-and-kill-switch.md`.
   *
   * Omit (or pass `""`) for a call with no separately-delivered domain
   * prompt — the system-prompt channel then carries just the protocol shim
   * (or, lean mode off, nothing beyond the harness default), and the caller
   * is expected to have folded ALL domain content into `prompt` instead.
   */
  systemPrompt?: string;
}

/**
 * Result of a single-shot CLI call.
 *
 * `usage` is `null` only when the binary reported nothing parseable (an
 * older build, or a shape this parser does not recognise) — never a silent
 * zero. Callers persist it verbatim so `llm_usage` reflects what the CLI
 * actually billed instead of the hard-coded `EMPTY_USAGE` every `cli` row
 * used to carry.
 */
export interface ClaudeCliSingleShotResult {
  text: string;
  usage: CliReportedUsage | null;
}

export function claudeCliSingleShot(
  input: ClaudeCliSingleShotInput,
): Promise<ClaudeCliSingleShotResult> {
  return withAuthAutoRecovery(() => claudeCliSingleShotOnce(input));
}

async function claudeCliSingleShotOnce(
  input: ClaudeCliSingleShotInput,
): Promise<ClaudeCliSingleShotResult> {
  const { cfg, prompt, systemPrompt } = input;
  const domainPrompt = systemPrompt ?? "";
  // The domain block (when present) is a PREFIX of the flag value, the shim
  // a SUFFIX — see SINGLE_SHOT_PRINT_ARG's doc comment for why that ordering
  // is what makes the block cacheable.
  const cliSystemPrompt = domainPrompt
    ? `${domainPrompt}\n\n${SINGLE_SHOT_PRINT_ARG}`
    : SINGLE_SHOT_PRINT_ARG;
  // `leanArgs` only actually emits `--system-prompt` (which REPLACES the
  // harness's default system prompt) when `cfg.cliLeanMode` is on. The
  // escape hatch (`cliLeanMode: false`) exists specifically to restore that
  // harness default, so reusing `--system-prompt` here would fight the
  // escape hatch's whole point. `--append-system-prompt` layers our domain
  // content ON TOP of the harness default instead of replacing it, so lean
  // mode off still gets the full harness context AND the domain prompt is
  // never silently dropped. Only emitted when there IS a domain prompt to
  // deliver — with none, lean-mode-off behaves exactly as before this
  // driver supported a separate system-prompt channel at all.
  const appendSystemPromptArgs: string[] =
    !cfg.cliLeanMode && domainPrompt ? ["--append-system-prompt", cliSystemPrompt] : [];
  // `--output-format json` (was `text`): the JSON envelope carries `usage`
  // and `total_cost_usd` alongside `result`. The text format carries
  // neither, which is why every `cli` row in `llm_usage` used to read zero
  // tokens no matter how large the call.
  const args = [
    ...cfg.cliExtraArgs,
    ...leanArgs(cfg, cliSystemPrompt),
    ...appendSystemPromptArgs,
    "-p",
    SINGLE_SHOT_PRINT_ARG,
    "--model",
    cfg.cliModel,
    "--output-format",
    "json",
  ];
  const fullArgv = [cfg.cliBin, ...args];
  const result = await runCliProcess({
    file: cfg.cliBin,
    args,
    stdin: prompt,
    timeoutMs: cfg.cliTimeoutMs,
    maxStdoutBytes: cfg.cliMaxCaptureBytes,
    maxStderrBytes: Math.min(cfg.cliMaxCaptureBytes, 512_000),
  });
  try {
    assertCliSuccess(result, "claude single-shot", fullArgv);
  } catch (e) {
    if (e instanceof CliRunnerError) throw e;
    throw e;
  }

  const raw = result.stdout.trim();
  if (!raw) {
    throw new CliRunnerError("LLM_CLI_EMPTY", "claude single-shot: empty stdout", {
      stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
      command: sanitizeArgv(fullArgv),
      phase: "empty",
      durationMs: result.durationMs,
    });
  }

  const { text, usage } = parseSingleShotEnvelope(raw, result, fullArgv);
  if (!text) {
    throw new CliRunnerError("LLM_CLI_EMPTY", "claude single-shot: empty result text", {
      stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
      command: sanitizeArgv(fullArgv),
      phase: "empty",
      durationMs: result.durationMs,
    });
  }
  return { text, usage };
}

/**
 * Find the CLI's result envelope in stdout, scanning LINE BY LINE rather than
 * `JSON.parse`-ing the whole blob.
 *
 * The binary version running on the host is not pinned by this repo, so a
 * deprecation notice, an update nag, or any other stray line ahead of the
 * JSON would otherwise break `JSON.parse` outright and silently fall back to
 * treating the entire blob as the assistant's answer. A line only counts as
 * the envelope if it carries a field the CLI actually emits for a result
 * (`result` / `is_error` / `type: "result"`) — a flow whose own ANSWER is
 * JSON (e.g. a dashboard spec) must not be mistaken for the envelope.
 */
function findResultEnvelope(raw: string): Record<string, unknown> | null {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const o = asResultEnvelope(parsed);
    if (o) return o;
  }
  // Line scanning strictly NARROWS what a whole-blob JSON.parse would have
  // accepted: a pretty-printed envelope spanning several lines fails every
  // per-line parse above. Fall back to the whole-blob parse (same
  // discriminator) so that shape still works.
  try {
    return asResultEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The envelope discriminator, applied to an already-parsed value. */
function asResultEnvelope(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if ("result" in o || "is_error" in o || o.type === "result") return o;
  return null;
}

/**
 * Read `{result, usage, total_cost_usd, is_error}` out of the JSON envelope.
 *
 * Falls back to treating stdout as plain text (`usage: null`) when nothing
 * that looks like a result envelope is found — an older binary that ignores
 * `--output-format json`, or any other shape this parser does not recognise,
 * still works, just without usage. `is_error` is surfaced with the same
 * auth/API-error classification the agentic path uses below, so a policy or
 * credential failure is reported as such instead of being handed back as the
 * assistant's answer.
 */
function parseSingleShotEnvelope(
  raw: string,
  result: { exitCode: number | null; stderr: string; stdout: string; durationMs: number },
  fullArgv: string[],
): { text: string; usage: CliReportedUsage | null } {
  const envelope = findResultEnvelope(raw);
  if (!envelope) return { text: raw, usage: null };

  if (envelope.is_error === true) {
    const status = typeof envelope.api_error_status === "number" ? envelope.api_error_status : null;
    const inner = sanitize(typeof envelope.result === "string" ? envelope.result : "");
    const isAuth =
      status === 401 || status === 403 || /authentication|invalid.*credentials|unauthorized/i.test(inner);
    throw new CliRunnerError(
      isAuth ? "LLM_CLI_AUTH" : "LLM_CLI_API_ERROR",
      `claude single-shot: ${inner.slice(0, 240) || `api_error_status=${status}`}`,
      {
        exitCode: result.exitCode,
        stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
        stdout: sanitizeTail(result.stdout, TAIL_MAX_BYTES),
        command: sanitizeArgv(fullArgv),
        phase: isAuth ? "auth" : "exit",
        durationMs: result.durationMs,
        innerErrorCode: status,
      },
    );
  }

  const text = typeof envelope.result === "string" ? envelope.result.trim() : "";
  return { text, usage: parseCliReportedUsage(envelope) };
}

export interface ClaudeCliAgenticStepInput {
  cfg: DashboardLlmConfig;
  messages: ChatCompletionMessageParam[];
  /** Optional callback invoked as the model streams text. `chars` is the delta;
   *  `totalChars` is the running total since this step began. */
  onTextDelta?: (chars: number, totalChars: number, accumulatedText: string) => void;
  /** Optional callback invoked as the model streams extended-thinking content.
   *  Same contract as onTextDelta but for the chain-of-thought block (only
   *  emitted on Claude builds with thinking enabled). */
  onThinkingDelta?: (chars: number, totalChars: number, accumulatedThinking: string) => void;
}

export type ClaudeAgenticStepKind = "final" | "tools";

export interface ClaudeAgenticStepFinal {
  kind: "final";
  content: string;
  /**
   * Usage reported by the CLI's terminal `result` line for THIS round.
   * `null` when the binary reported nothing parseable. An agentic run makes
   * one CLI invocation per round, so the caller sums these across rounds.
   */
  usage?: CliReportedUsage | null;
}

export interface ClaudeAgenticStepTools {
  kind: "tools";
  calls: { name: string; arguments: string }[];
  usage?: CliReportedUsage | null;
}

export type ClaudeAgenticStep = ClaudeAgenticStepFinal | ClaudeAgenticStepTools;

function extractJsonObject(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : t;
  const start = body.indexOf("{");
  if (start === -1) {
    throw new CliRunnerError(
      "LLM_CLI_PARSE",
      "claude agentic: no JSON object found in output",
      { stderr: sanitize(body.slice(0, 500)), phase: "parse" },
    );
  }
  // Walk forward counting balanced braces, respecting strings and escapes,
  // so trailing content (explanation prose, extra `}` chars) is ignored.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return body.slice(start, i + 1);
      }
    }
  }
  throw new CliRunnerError(
    "LLM_CLI_PARSE",
    "claude agentic: unterminated JSON object in output",
    { stderr: sanitize(body.slice(start, start + 500)) },
  );
}

export function parseClaudeAgenticStepJson(stdout: string): ClaudeAgenticStep {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(stdout));
  } catch (e) {
    throw new CliRunnerError(
      "LLM_CLI_PARSE",
      `claude agentic: invalid JSON (${e instanceof Error ? e.message : "parse error"})`,
      { stderr: sanitize(stdout.slice(0, 800)) },
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CliRunnerError("LLM_CLI_PARSE", "claude agentic: JSON root must be an object");
  }
  const o = parsed as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "final") {
    const content = o.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new CliRunnerError("LLM_CLI_PARSE", "claude agentic: final.content must be a non-empty string");
    }
    return { kind: "final", content: content.trim() };
  }
  if (kind === "tools") {
    const callsRaw = o.calls;
    if (!Array.isArray(callsRaw) || callsRaw.length === 0) {
      throw new CliRunnerError("LLM_CLI_PARSE", "claude agentic: tools.calls must be a non-empty array");
    }
    const calls: { name: string; arguments: string }[] = [];
    for (const c of callsRaw) {
      if (!c || typeof c !== "object") continue;
      const cr = c as Record<string, unknown>;
      const name = cr.name;
      const args = cr.arguments;
      if (typeof name !== "string" || !name) {
        throw new CliRunnerError("LLM_CLI_PARSE", "claude agentic: each call needs a string name");
      }
      const argStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
      calls.push({ name, arguments: argStr });
    }
    if (!calls.length) {
      throw new CliRunnerError("LLM_CLI_PARSE", "claude agentic: no valid tool calls parsed");
    }
    return { kind: "tools", calls };
  }
  // Model skipped the wrapper and returned a bare dashboard spec or other JSON directly.
  // If it looks like a final answer (has title+widgets or is otherwise not a tool request),
  // treat the whole extracted JSON as the content string.
  if (kind === undefined || (typeof kind === "string" && kind !== "tools")) {
    const content = extractJsonObject(stdout);
    if (content) return { kind: "final", content };
  }
  throw new CliRunnerError(
    "LLM_CLI_PARSE",
    `claude agentic: unknown kind ${String(kind)}`,
  );
}

/**
 * Parse a single stream-json NDJSON line from `claude --output-format stream-json --verbose`.
 *
 * With `--include-partial-messages` the binary also emits incremental
 * `stream_event` lines with `content_block_delta` for each token chunk —
 * we surface those as `text_delta` so the UI can show Claude typing in
 * real time. The cumulative `assistant` envelope is emitted at the end
 * of each message and carries the same content; on newer builds (where
 * deltas are present) callers should treat it as a redundant duplicate.
 *
 * Supported event shapes (defensive — unknown shapes are silently ignored):
 *   { type: "system", subtype: "init", ... }
 *   { type: "stream_event", event: { type:"content_block_delta", delta:{ type:"text_delta", text:"..." } } }
 *   { type: "assistant", message: { content: [ {type:"text", text:"..."} | {type:"tool_use",...} ] } }
 *   { type: "result", is_error: bool, result: string, ... }
 *
 * Returns:
 *   { kind: "text_delta", text: string }    — incremental token chunk (partial-messages flag)
 *   { kind: "text_full",  text: string }    — cumulative assistant text (one per message)
 *   { kind: "result", text: string, isError: bool, status?: number }  — terminal result line
 *   { kind: "ignore" }                     — all other lines
 */
export type StreamJsonLineParse =
  | { kind: "text_delta"; text: string }
  | { kind: "thinking_delta"; text: string }
  | { kind: "text_full"; text: string }
  | {
      kind: "result";
      text: string;
      isError: boolean;
      status?: number | null;
      /** Token/cost accounting for this round — see `usage.ts`. */
      usage?: CliReportedUsage | null;
    }
  | { kind: "ignore" };

export function parseStreamJsonLine(line: string): StreamJsonLineParse {
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "ignore" };
    obj = parsed as Record<string, unknown>;
  } catch {
    return { kind: "ignore" };
  }

  const type = obj.type;

  // Terminal result line — emitted at the end of a step. It also carries
  // this round's `usage` + `total_cost_usd`; the agentic adapter previously
  // parsed this line for `result`/`is_error` only and dropped the
  // accounting, which is why every agentic round on the CLI provider
  // contributed nothing to `AgenticUsageTotals`.
  if (type === "result") {
    const isError = obj.is_error === true;
    const resultText = typeof obj.result === "string" ? obj.result : "";
    const status = typeof obj.api_error_status === "number" ? obj.api_error_status : null;
    return { kind: "result", text: resultText, isError, status, usage: parseCliReportedUsage(obj) };
  }

  // Incremental token chunks emitted with --include-partial-messages.
  if (type === "stream_event") {
    const ev = obj.event;
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return { kind: "ignore" };
    const e = ev as Record<string, unknown>;
    if (e.type === "content_block_delta") {
      const delta = e.delta;
      if (delta && typeof delta === "object" && !Array.isArray(delta)) {
        const d = delta as Record<string, unknown>;
        if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
          return { kind: "text_delta", text: d.text };
        }
        // Extended thinking: visible chain-of-thought reasoning emitted before
        // the final answer. Surface it so the UI can show "Claude razonando".
        if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
          return { kind: "thinking_delta", text: d.thinking };
        }
      }
    }
    return { kind: "ignore" };
  }

  // Assistant message — can carry text content or tool_use blocks.
  if (type === "assistant") {
    const message = obj.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) return { kind: "ignore" };
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return { kind: "ignore" };
    // Extract text chunks; skip tool_use blocks (they appear in the result envelope).
    const textParts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text) {
        textParts.push(b.text);
      }
    }
    const joined = textParts.join("");
    if (joined) return { kind: "text_full", text: joined };
    return { kind: "ignore" };
  }

  return { kind: "ignore" };
}

export function claudeCliAgenticStep(input: ClaudeCliAgenticStepInput): Promise<ClaudeAgenticStep> {
  return withAuthAutoRecovery(() => claudeCliAgenticStepOnce(input));
}

async function claudeCliAgenticStepOnce(input: ClaudeCliAgenticStepInput): Promise<ClaudeAgenticStep> {
  const { cfg, messages, onTextDelta, onThinkingDelta } = input;
  const transcript = serializeChatMessagesForCli(messages);
  const printArg = AGENTIC_PROTOCOL_INSTRUCTION;
  const stdinBody = buildAgenticStdin(transcript);

  // Use --output-format stream-json --verbose --include-partial-messages so we get
  // token-level NDJSON events while the model is generating. Each token chunk
  // arrives as { type:"stream_event", event:{ type:"content_block_delta", delta:
  // { type:"text_delta", text } } } and is forwarded via onTextDelta so the UI
  // can show Claude typing in real time. The cumulative `type:"assistant"`
  // envelope at the end of each message is treated as a duplicate and skipped
  // (sawAnyDelta below). On older binaries that ignore --include-partial-messages
  // no deltas arrive — we then fall back to the cumulative assistant message
  // and emit it as a single chunk.
  // AGENTIC_PROTOCOL_INSTRUCTION is a fixed constant (never interpolates
  // per-call data), so it's always safe to hand to leanArgs — unlike the
  // single-shot path there is no per-flow allow-list to consult here.
  const args = [
    ...cfg.cliExtraArgs,
    ...leanArgs(cfg, printArg),
    "-p",
    printArg,
    "--model",
    cfg.cliModel,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  const fullArgv = [cfg.cliBin, ...args];

  // Accumulate assistant text across chunks so we can parse the full step JSON
  // once the result line arrives. Extended-thinking blocks accumulate in
  // parallel and are forwarded via onThinkingDelta.
  let accumulatedText = "";
  let totalCharsEmitted = 0;
  let accumulatedThinking = "";
  let totalThinkingCharsEmitted = 0;
  // Whether any incremental text_delta events arrived for this step. When true,
  // the cumulative `type:"assistant"` envelope (text_full) is a duplicate and
  // must be ignored to avoid double-counting.
  let sawAnyDelta = false;
  // Store the last result line so we can use its envelope for error detection.
  // Use a box object to avoid TypeScript control-flow narrowing issues with
  // variables mutated inside closures.
  const resultBox: {
    line: {
      text: string;
      isError: boolean;
      status?: number | null;
      usage?: CliReportedUsage | null;
    } | null;
  } = { line: null };

  const emitDelta = (deltaText: string) => {
    accumulatedText += deltaText;
    totalCharsEmitted += deltaText.length;
    if (onTextDelta) {
      try {
        onTextDelta(deltaText.length, totalCharsEmitted, accumulatedText);
      } catch {
        /* ignore callback errors */
      }
    }
  };

  const emitThinkingDelta = (deltaText: string) => {
    accumulatedThinking += deltaText;
    totalThinkingCharsEmitted += deltaText.length;
    if (onThinkingDelta) {
      try {
        onThinkingDelta(deltaText.length, totalThinkingCharsEmitted, accumulatedThinking);
      } catch {
        /* ignore callback errors */
      }
    }
  };

  const result = await runCliProcessStreaming({
    file: cfg.cliBin,
    args,
    stdin: stdinBody,
    timeoutMs: cfg.cliTimeoutMs,
    maxStdoutBytes: cfg.cliMaxCaptureBytes,
    maxStderrBytes: Math.min(cfg.cliMaxCaptureBytes, 512_000),
    onStdoutLine: (line) => {
      const parsed = parseStreamJsonLine(line);
      if (parsed.kind === "text_delta") {
        sawAnyDelta = true;
        emitDelta(parsed.text);
      } else if (parsed.kind === "thinking_delta") {
        emitThinkingDelta(parsed.text);
      } else if (parsed.kind === "text_full") {
        // Older CLI builds (or partial-messages flag silently ignored) emit
        // only the cumulative assistant message — surface it as one chunk.
        // Newer builds emit deltas first and then this duplicate; skip it.
        if (!sawAnyDelta) {
          emitDelta(parsed.text);
        }
      } else if (parsed.kind === "result") {
        resultBox.line = parsed;
      }
    },
  });

  try {
    assertCliSuccess(result, "claude agentic step", fullArgv);
  } catch (e) {
    if (e instanceof CliRunnerError) throw e;
    throw e;
  }

  // Check for is_error on the result line — same D-024 handling as before.
  const resultLine = resultBox.line;
  if (resultLine?.isError) {
    const status = resultLine.status ?? null;
    const innerRaw = resultLine.text;
    const inner = sanitize(innerRaw);
    const isAuth = status === 401 || status === 403 || /authentication|invalid.*credentials|unauthorized/i.test(inner);
    throw new CliRunnerError(
      isAuth ? "LLM_CLI_AUTH" : "LLM_CLI_API_ERROR",
      `claude agentic step: ${inner.slice(0, 240) || `api_error_status=${status}`}`,
      {
        exitCode: result.exitCode,
        stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
        stdout: sanitizeTail(result.stdout, TAIL_MAX_BYTES),
        command: sanitizeArgv(fullArgv),
        phase: isAuth ? "auth" : "exit",
        durationMs: result.durationMs,
        innerErrorCode: status,
      },
    );
  }

  // Prefer the result line text over the accumulated text — the result line
  // contains the final model output and is more reliable than accumulation.
  // Fall back to accumulated text if no result line was seen (e.g. older CLI).
  const textOutput = resultLine?.text || accumulatedText;
  // (resultBox used above)

  // Final fallback: if stdout has a single-object JSON envelope (older --output-format json
  // compatible binary), try to parse it the old way.
  if (!textOutput.trim()) {
    const stdoutTrimmed = result.stdout.trim();
    if (stdoutTrimmed) {
      try {
        const envelope = JSON.parse(stdoutTrimmed) as Record<string, unknown>;
        if (envelope?.is_error === true) {
          const status = typeof envelope.api_error_status === "number" ? envelope.api_error_status : null;
          const innerRaw = typeof envelope.result === "string" ? envelope.result : "";
          const inner = sanitize(innerRaw);
          const isAuth = status === 401 || status === 403 || /authentication|invalid.*credentials|unauthorized/i.test(inner);
          throw new CliRunnerError(
            isAuth ? "LLM_CLI_AUTH" : "LLM_CLI_API_ERROR",
            `claude agentic step: ${inner.slice(0, 240) || `api_error_status=${status}`}`,
            {
              exitCode: result.exitCode,
              stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
              stdout: sanitizeTail(result.stdout, TAIL_MAX_BYTES),
              command: sanitizeArgv(fullArgv),
              phase: isAuth ? "auth" : "exit",
              durationMs: result.durationMs,
              innerErrorCode: status,
            },
          );
        }
        if (typeof envelope.result === "string") {
          return {
            ...parseClaudeAgenticStepJson(envelope.result),
            usage: parseCliReportedUsage(envelope),
          };
        }
      } catch (e) {
        if (e instanceof CliRunnerError) throw e;
        // JSON parse failed — fall through to raw stdout
      }
      return parseClaudeAgenticStepJson(stdoutTrimmed);
    }
    throw new CliRunnerError("LLM_CLI_EMPTY", "claude agentic step: empty output", {
      stderr: sanitizeTail(result.stderr, TAIL_MAX_BYTES),
      command: sanitizeArgv(fullArgv),
      phase: "empty",
      durationMs: result.durationMs,
    });
  }

  // Attach this round's accounting to the step so the adapter can forward it
  // into the runner's usage totals (previously hard-coded to zero on every
  // round — see agent-adapter.ts).
  return { ...parseClaudeAgenticStepJson(textOutput), usage: resultLine?.usage ?? null };
}
