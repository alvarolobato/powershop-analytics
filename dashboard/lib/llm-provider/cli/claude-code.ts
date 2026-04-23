/**
 * Claude Code CLI driver: non-interactive `claude -p` with `--model` and JSON protocol rounds.
 */

import type { DashboardLlmConfig } from "../types";
import { runCliProcess, assertCliSuccess } from "./process";
import { CliRunnerError } from "./errors";
import { serializeChatMessagesForCli } from "./transcript";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const AGENTIC_PROTOCOL_INSTRUCTION = `You are the dashboard agentic planner. Reply with ONE JSON object only, no markdown fences, no prose.

Schema:
1) Final assistant text to show the user:
{"kind":"final","content":"<string>"}

2) Request tool calls (server will execute them and send you tool results):
{"kind":"tools","calls":[{"name":"<tool_name>","arguments":"<JSON string of args>"}]}

Use exact tool names from the tool list in the system prompt. Arguments must be a JSON string (escaped JSON inside JSON), matching OpenAI function-calling style.`;

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
    prompt,
    "--model",
    cfg.cliModel,
    "--output-format",
    "text",
  ];
  const result = await runCliProcess({
    file: cfg.cliBin,
    args,
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
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new CliRunnerError(
      "LLM_CLI_PARSE",
      "claude agentic: no JSON object found in output",
      { stderr: body.slice(0, 500) },
    );
  }
  return body.slice(start, end + 1);
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
  throw new CliRunnerError(
    "LLM_CLI_PARSE",
    `claude agentic: unknown kind ${String(kind)}`,
  );
}

export async function claudeCliAgenticStep(input: ClaudeCliAgenticStepInput): Promise<ClaudeAgenticStep> {
  const { cfg, messages } = input;
  const transcript = serializeChatMessagesForCli(messages);
  const prompt = `${AGENTIC_PROTOCOL_INSTRUCTION}\n\n--- conversation ---\n${transcript}\n--- end ---\n`;

  const args = [
    ...cfg.cliExtraArgs,
    "-p",
    prompt,
    "--model",
    cfg.cliModel,
    "--output-format",
    "text",
  ];

  const result = await runCliProcess({
    file: cfg.cliBin,
    args,
    timeoutMs: cfg.cliTimeoutMs,
    maxStdoutBytes: cfg.cliMaxCaptureBytes,
    maxStderrBytes: Math.min(cfg.cliMaxCaptureBytes, 512_000),
  });
  try {
    assertCliSuccess(result, "claude agentic step");
  } catch (e) {
    if (e instanceof CliRunnerError) throw e;
    throw e;
  }
  return parseClaudeAgenticStepJson(result.stdout);
}
