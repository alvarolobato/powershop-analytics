import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunCliProcess, mockRunCliProcessStreaming } = vi.hoisted(() => ({
  mockRunCliProcess: vi.fn(),
  mockRunCliProcessStreaming: vi.fn(),
}));

vi.mock("@/lib/llm-provider/cli/process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runCliProcess: mockRunCliProcess,
    runCliProcessStreaming: mockRunCliProcessStreaming,
  };
});

import {
  claudeCliSingleShot,
  claudeCliAgenticStep,
  parseStreamJsonLine,
  CLI_SAFETY_ARGS,
} from "@/lib/llm-provider/cli/claude-code";
import { CliRunnerError } from "@/lib/llm-client";
import type { DashboardLlmConfig } from "@/lib/llm-provider/types";

const cfg: DashboardLlmConfig = {
  provider: "cli",
  openrouterModel: "anthropic/claude-sonnet-4",
  cliModel: "sonnet",
  cliDriver: "claude_code",
  cliBin: "claude",
  cliExtraArgs: ["--quiet"],
  cliTimeoutMs: 5000,
  cliMaxCaptureBytes: 1_000_000,
};

function okResult(stdout: string) {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    truncatedStdout: false,
    truncatedStderr: false,
    durationMs: 50,
  };
}

/**
 * Build a mock for runCliProcessStreaming that feeds NDJSON lines via onStdoutLine,
 * then resolves with `result`. This simulates what the streaming CLI produces.
 */
function makeStreamingMock(
  ndjsonLines: string[],
  result?: Partial<ReturnType<typeof okResult>>,
) {
  return vi.fn().mockImplementation(
    async ({ onStdoutLine }: { onStdoutLine: (line: string) => void }) => {
      for (const line of ndjsonLines) {
        onStdoutLine(line);
      }
      return { ...okResult(""), ...result };
    },
  );
}

/**
 * Build stream-json NDJSON lines that represent the final model output.
 * The result line contains the final text in the `result` field.
 */
function makeStreamJsonResult(finalText: string): string[] {
  return [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: finalText }] } }),
    JSON.stringify({ type: "result", is_error: false, result: finalText }),
  ];
}

describe("parseStreamJsonLine", () => {
  it("parses cumulative assistant text content as text_full", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("text_full");
    if (r.kind === "text_full") expect(r.text).toBe("hello");
  });

  it("parses incremental content_block_delta text_delta as text_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "1, 2, 3" },
      },
    });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("text_delta");
    if (r.kind === "text_delta") expect(r.text).toBe("1, 2, 3");
  });

  it("parses extended-thinking content_block_delta thinking_delta as thinking_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me check the data..." },
      },
    });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("thinking_delta");
    if (r.kind === "thinking_delta") expect(r.text).toBe("Let me check the data...");
  });

  it("ignores signature_delta (extended-thinking signature, not visible)", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "abc123" },
      },
    });
    expect(parseStreamJsonLine(line).kind).toBe("ignore");
  });

  it("ignores non-text content_block_delta variants (e.g. input_json_delta)", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{\"a\":" },
      },
    });
    expect(parseStreamJsonLine(line).kind).toBe("ignore");
  });

  it("ignores tool_use content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "validate_query", id: "x" }] },
    });
    expect(parseStreamJsonLine(line).kind).toBe("ignore");
  });

  it("parses result line", () => {
    const line = JSON.stringify({ type: "result", is_error: false, result: "final output" });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("result");
    if (r.kind === "result") {
      expect(r.isError).toBe(false);
      expect(r.text).toBe("final output");
      // No usage/total_cost_usd on this envelope — degrades to null, not zero.
      expect(r.usage).toBeNull();
    }
  });

  it("parses usage + total_cost_usd off the result line", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: false,
      result: "final output",
      total_cost_usd: 0.0176284,
      usage: { input_tokens: 9, output_tokens: 36 },
    });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("result");
    if (r.kind === "result") {
      expect(r.usage).toEqual({
        prompt_tokens: 9,
        completion_tokens: 36,
        total_tokens: 45,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cost_usd: 0.0176284,
      });
    }
  });

  it("parses error result line", () => {
    const line = JSON.stringify({ type: "result", is_error: true, api_error_status: 401, result: "auth fail" });
    const r = parseStreamJsonLine(line);
    expect(r.kind).toBe("result");
    if (r.kind === "result") {
      expect(r.isError).toBe(true);
      expect(r.status).toBe(401);
    }
  });

  it("ignores system init lines", () => {
    const line = JSON.stringify({ type: "system", subtype: "init" });
    expect(parseStreamJsonLine(line).kind).toBe("ignore");
  });

  it("ignores malformed JSON", () => {
    expect(parseStreamJsonLine("not json").kind).toBe("ignore");
  });

  it("ignores empty string", () => {
    expect(parseStreamJsonLine("").kind).toBe("ignore");
  });

  it("ignores incomplete lines (partial JSON)", () => {
    expect(parseStreamJsonLine('{"type":"assistant"').kind).toBe("ignore");
  });
});

describe("claudeCliSingleShot", () => {
  beforeEach(() => {
    mockRunCliProcess.mockReset();
  });

  it("invokes the CLI with the configured args and returns trimmed stdout when the output is not a JSON envelope", async () => {
    // Plain text stdout (no result envelope) — an older binary ignoring
    // --output-format json, or any other unrecognised shape. Must still work,
    // just without usage.
    mockRunCliProcess.mockResolvedValueOnce(okResult("  hello world  "));

    const out = await claudeCliSingleShot({ cfg, prompt: "do the thing" });
    expect(out.text).toBe("hello world");
    expect(out.usage).toBeNull();

    const callArgs = mockRunCliProcess.mock.calls[0][0];
    expect(callArgs.file).toBe("claude");
    expect(callArgs.args).toContain("-p");
    expect(callArgs.args).toContain("--model");
    expect(callArgs.args).toContain("sonnet");
    expect(callArgs.args).toContain("--output-format");
    expect(callArgs.args).toContain("json");
    expect(callArgs.args[0]).toBe("--quiet"); // cliExtraArgs prepended
    expect(callArgs.stdin).toBe("do the thing");
    expect(callArgs.timeoutMs).toBe(5000);
  });

  it("parses the result envelope and returns real usage + total_cost_usd", async () => {
    mockRunCliProcess.mockResolvedValueOnce(
      okResult(
        JSON.stringify({
          result: "answer text",
          total_cost_usd: 0.0176284,
          usage: {
            input_tokens: 9,
            output_tokens: 36,
            cache_creation_input_tokens: 7521,
            cache_read_input_tokens: 18134,
          },
        }),
      ),
    );

    const out = await claudeCliSingleShot({ cfg, prompt: "do the thing" });
    expect(out.text).toBe("answer text");
    expect(out.usage).toEqual({
      prompt_tokens: 9,
      completion_tokens: 36,
      total_tokens: 45,
      cache_creation_input_tokens: 7521,
      cache_read_input_tokens: 18134,
      cost_usd: 0.0176284,
    });
  });

  it("locates the result envelope line-by-line when a stray line precedes it", async () => {
    // Not hypothetical: a deprecation notice or update nag ahead of the JSON
    // would break a whole-stdout JSON.parse outright.
    const stdout = [
      "A new version of the Claude CLI is available.",
      JSON.stringify({ result: "answer", total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 2 } }),
    ].join("\n");
    mockRunCliProcess.mockResolvedValueOnce(okResult(stdout));

    const out = await claudeCliSingleShot({ cfg, prompt: "x" });
    expect(out.text).toBe("answer");
    expect(out.usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cost_usd: 0.001,
    });
  });

  it("degrades to unmetered-but-working on an envelope missing usage", async () => {
    mockRunCliProcess.mockResolvedValueOnce(
      okResult(JSON.stringify({ result: "answer only" })),
    );

    const out = await claudeCliSingleShot({ cfg, prompt: "x" });
    expect(out.text).toBe("answer only");
    expect(out.usage).toBeNull();
  });

  it("degrades to unmetered-but-working on an envelope missing total_cost_usd", async () => {
    mockRunCliProcess.mockResolvedValueOnce(
      okResult(
        JSON.stringify({ result: "answer", usage: { input_tokens: 5, output_tokens: 7 } }),
      ),
    );

    const out = await claudeCliSingleShot({ cfg, prompt: "x" });
    expect(out.text).toBe("answer");
    expect(out.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 7,
      total_tokens: 12,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cost_usd: null,
    });
  });

  it("ignores extra unknown fields on the envelope without failing", async () => {
    mockRunCliProcess.mockResolvedValueOnce(
      okResult(
        JSON.stringify({
          result: "answer",
          total_cost_usd: 0.002,
          usage: { input_tokens: 3, output_tokens: 4 },
          modelUsage: { "claude-x": { costUSD: 0.002 } },
          session_id: "some-uuid",
          unexpected_new_field: { nested: true },
        }),
      ),
    );

    const out = await claudeCliSingleShot({ cfg, prompt: "x" });
    expect(out.text).toBe("answer");
    expect(out.usage?.cost_usd).toBe(0.002);
    expect(out.usage?.prompt_tokens).toBe(3);
  });

  it("always includes CLI_SAFETY_ARGS in argv, unconditionally", async () => {
    mockRunCliProcess.mockResolvedValueOnce(okResult("hello"));

    await claudeCliSingleShot({ cfg, prompt: "do the thing" });

    const callArgs = mockRunCliProcess.mock.calls[0][0];
    expect(callArgs.args).toContain("--tools");
    // "--tools" must be immediately followed by an empty string, not just
    // present somewhere in argv — the empty value is what actually disables
    // the built-in tool catalog.
    const toolsIdx = callArgs.args.indexOf("--tools");
    expect(callArgs.args[toolsIdx + 1]).toBe("");
    expect(callArgs.args).toContain("--no-session-persistence");
    for (const flag of CLI_SAFETY_ARGS) {
      expect(callArgs.args).toContain(flag);
    }
  });

  it("throws LLM_CLI_EMPTY when the CLI returns empty stdout on success", async () => {
    mockRunCliProcess.mockResolvedValueOnce(okResult("   \n  "));

    const promise = claudeCliSingleShot({ cfg, prompt: "x" });
    await expect(promise).rejects.toBeInstanceOf(CliRunnerError);
    await expect(promise).rejects.toMatchObject({ code: "LLM_CLI_EMPTY" });
  });

  it("propagates CliRunnerError from non-zero exit", async () => {
    mockRunCliProcess.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "boom",
      timedOut: false,
      truncatedStdout: false,
      truncatedStderr: false,
      durationMs: 50,
    });

    await expect(
      claudeCliSingleShot({ cfg, prompt: "x" }),
    ).rejects.toBeInstanceOf(CliRunnerError);
  });
});

describe("claudeCliAgenticStep", () => {
  beforeEach(() => {
    mockRunCliProcessStreaming.mockReset();
  });

  it("parses a 'final' step from stream-json result line", async () => {
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock(makeStreamJsonResult('{"kind":"final","content":"answer"}')),
    );

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(step.kind).toBe("final");
    if (step.kind === "final") {
      expect(step.content).toBe("answer");
    }
  });

  it("forwards this round's usage from the result line onto the step", async () => {
    const finalText = '{"kind":"final","content":"answer"}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: finalText }] } }),
        JSON.stringify({
          type: "result",
          is_error: false,
          result: finalText,
          total_cost_usd: 0.004,
          usage: { input_tokens: 12, output_tokens: 8 },
        }),
      ]),
    );

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(step.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cost_usd: 0.004,
    });
  });

  it("parses a 'tools' step from stream-json result line", async () => {
    const toolsJson = '{"kind":"tools","calls":[{"name":"list_ps_tables","arguments":"{}"}]}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock(makeStreamJsonResult(toolsJson)),
    );

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "list tables" }],
    });
    expect(step.kind).toBe("tools");
    if (step.kind === "tools") {
      expect(step.calls[0].name).toBe("list_ps_tables");
    }
  });

  it("falls back to accumulated text when no result line is seen (older CLI)", async () => {
    // Simulate a CLI that emits assistant text chunks but no result line.
    const bareJson = '{"kind":"final","content":"raw"}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: bareJson }] } }),
        // No result line — older binary
      ]),
    );

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(step.kind).toBe("final");
    if (step.kind === "final") {
      expect(step.content).toBe("raw");
    }
  });

  it("throws LLM_CLI_AUTH when result line is_error=true with 401", async () => {
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        JSON.stringify({ type: "result", is_error: true, api_error_status: 401, result: "invalid credentials" }),
      ]),
    );

    await expect(
      claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "LLM_CLI_AUTH" });
  });

  it("throws LLM_CLI_API_ERROR when result line is_error=true with non-auth status", async () => {
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        JSON.stringify({ type: "result", is_error: true, api_error_status: 503, result: "upstream timeout" }),
      ]),
    );

    await expect(
      claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "LLM_CLI_API_ERROR" });
  });

  it("invokes onTextDelta for each token-level text_delta and forwards accumulated text", async () => {
    const finalText = '{"kind":"final","content":"answer"}';
    // Newer claude builds emit incremental stream_event content_block_delta
    // events with --include-partial-messages; we forward each one through
    // onTextDelta and also pass the running cumulative text.
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"kind":"fina' } },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: 'l","content":"answer"}' } },
        }),
        // The cumulative assistant envelope follows; runner skips it because
        // text_delta events were already seen for this message.
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: finalText }] } }),
        JSON.stringify({ type: "result", is_error: false, result: finalText }),
      ]),
    );

    const deltas: { chars: number; totalChars: number; accumulated: string }[] = [];
    await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
      onTextDelta: (chars, totalChars, accumulated) => deltas.push({ chars, totalChars, accumulated }),
    });

    expect(deltas.length).toBe(2);
    expect(deltas[0].accumulated).toBe('{"kind":"fina');
    expect(deltas[1].accumulated).toBe(finalText);
    expect(deltas[1].totalChars).toBe(finalText.length);
  });

  it("falls back to text_full when no deltas arrive (older binary or flag ignored)", async () => {
    const finalText = '{"kind":"final","content":"ok"}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock([
        // No stream_event deltas — only the cumulative assistant envelope.
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: finalText }] } }),
        JSON.stringify({ type: "result", is_error: false, result: finalText }),
      ]),
    );

    const deltas: { chars: number; totalChars: number; accumulated: string }[] = [];
    await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
      onTextDelta: (chars, totalChars, accumulated) => deltas.push({ chars, totalChars, accumulated }),
    });

    expect(deltas.length).toBe(1);
    expect(deltas[0].accumulated).toBe(finalText);
  });

  it("uses --output-format stream-json --verbose --include-partial-messages flags", async () => {
    const finalText = '{"kind":"final","content":"ok"}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock(makeStreamJsonResult(finalText)),
    );

    await claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] });

    const callArgs = mockRunCliProcessStreaming.mock.calls[0][0];
    expect(callArgs.args).toContain("--output-format");
    expect(callArgs.args).toContain("stream-json");
    expect(callArgs.args).toContain("--verbose");
    expect(callArgs.args).toContain("--include-partial-messages");
  });

  it("always includes CLI_SAFETY_ARGS in argv, unconditionally", async () => {
    const finalText = '{"kind":"final","content":"ok"}';
    mockRunCliProcessStreaming.mockImplementation(
      makeStreamingMock(makeStreamJsonResult(finalText)),
    );

    await claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] });

    const callArgs = mockRunCliProcessStreaming.mock.calls[0][0];
    const toolsIdx = callArgs.args.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(callArgs.args[toolsIdx + 1]).toBe("");
    expect(callArgs.args).toContain("--no-session-persistence");
    for (const flag of CLI_SAFETY_ARGS) {
      expect(callArgs.args).toContain(flag);
    }
  });
});
