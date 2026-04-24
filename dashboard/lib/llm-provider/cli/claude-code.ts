/**
 * Claude Code CLI driver: non-interactive `claude -p` with `--model` and JSON protocol rounds.
 * Large prompts are passed on stdin to avoid OS argv limits (E2BIG).
 */

import type { DashboardLlmConfig } from "../types";
import { runCliProcess, assertCliSuccess } from "./process";
import { CliRunnerError } from "./errors";
import { serializeChatMessagesForCli } from "./transcript";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { DASHBOARD_AGENTIC_TOOLS } from "@/lib/llm-tools/catalog";

const SINGLE_SHOT_PRINT_ARG = `You are the dashboard assistant.
The UTF-8 stdin contains the full multi-section prompt (## system, ## user, etc.).
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
  /** Full user-facing prompt (system + task combined when only one block is needed). */
  prompt: string;
}

export async function claudeCliSingleShot(input: ClaudeCliSingleShotInput): Promise<string> {
  const { cfg, prompt } = input;
  const args = [
    ...cfg.cliExtraArgs,
    "-p",
    SINGLE_SHOT_PRINT_ARG,
    "--model",
    cfg.cliModel,
    "--output-format",
    "text",
  ];
  const result = await runCliProcess({
    file: cfg.cliBin,
    args,
    stdin: prompt,
    timeoutMs: cfg.cliTimeoutMs,
    maxStdoutBytes: cfg.cliMaxCaptureBytes,
    maxStderrBytes: Math.min(cfg.cliMaxCaptureBytes, 512_000),
  });
  try {
    assertCliSuccess(result, "claude single-shot");
  } catch (e) {
    if (e instanceof CliRunnerError) throw e;
    throw e;
  }
  const text = result.stdout.trim();
  if (!text) {
    throw new CliRunnerError("LLM_CLI_EMPTY", "claude single-shot: empty stdout", {
      stderr: result.stderr,
    });
  }
  return text;
}

export interface ClaudeCliAgenticStepInput {
  cfg: DashboardLlmConfig;
  messages: ChatCompletionMessageParam[];
}

export type ClaudeAgenticStepKind = "final" | "tools";

export interface ClaudeAgenticStepFinal {
  kind: "final";
  content: string;
}

export interface ClaudeAgenticStepTools {
  kind: "tools";
  calls: { name: string; arguments: string }[];
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
      { stderr: body.slice(0, 500) },
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
    { stderr: body.slice(start, start + 500) },
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
      { stderr: stdout.slice(0, 800) },
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

export async function claudeCliAgenticStep(input: ClaudeCliAgenticStepInput): Promise<ClaudeAgenticStep> {
  const { cfg, messages } = input;
  const transcript = serializeChatMessagesForCli(messages);
  const printArg = AGENTIC_PROTOCOL_INSTRUCTION;
  const stdinBody = buildAgenticStdin(transcript);

  const args = [
    ...cfg.cliExtraArgs,
    "-p",
    printArg,
    "--model",
    cfg.cliModel,
    "--output-format",
    "json",
  ];

  const result = await runCliProcess({
    file: cfg.cliBin,
    args,
    stdin: stdinBody,
    timeoutMs: cfg.cliTimeoutMs,
    maxStdoutBytes: cfg.cliMaxCaptureBytes,
    maxStderrBytes: Math.min(cfg.cliMaxCaptureBytes, 512_000),
  });
  try {
    assertCliSuccess(result, "claude agentic step");
  } catch (e) {
    if (e instanceof CliRunnerError) {
      console.error("[claude-cli] step failed exitCode=%d stderr=%s", result.exitCode, result.stderr.slice(0, 1000));
      throw e;
    }
    throw e;
  }
  // --output-format json wraps the model output in an envelope: { result: "<text>" }.
  // Extract the inner text to avoid spurious trailing content that breaks JSON.parse.
  let textOutput = result.stdout;
  try {
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    if (typeof envelope.result === "string") textOutput = envelope.result;
  } catch {
    // Envelope parse failed — fall back to raw stdout
  }
  return parseClaudeAgenticStepJson(textOutput);
}
