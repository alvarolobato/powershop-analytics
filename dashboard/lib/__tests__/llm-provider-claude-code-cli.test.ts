import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunCliProcess } = vi.hoisted(() => ({
  mockRunCliProcess: vi.fn(),
}));

vi.mock("@/lib/llm-provider/cli/process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runCliProcess: mockRunCliProcess,
  };
});

import {
  claudeCliSingleShot,
  claudeCliAgenticStep,
} from "@/lib/llm-provider/cli/claude-code";
import { CliRunnerError } from "@/lib/llm-provider/cli/errors";
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

describe("claudeCliSingleShot", () => {
  beforeEach(() => {
    mockRunCliProcess.mockReset();
  });

  it("invokes the CLI with the configured args and returns trimmed stdout", async () => {
    mockRunCliProcess.mockResolvedValueOnce(okResult("  hello world  "));

    const out = await claudeCliSingleShot({ cfg, prompt: "do the thing" });
    expect(out).toBe("hello world");

    const callArgs = mockRunCliProcess.mock.calls[0][0];
    expect(callArgs.file).toBe("claude");
    expect(callArgs.args).toContain("-p");
    expect(callArgs.args).toContain("--model");
    expect(callArgs.args).toContain("sonnet");
    expect(callArgs.args[0]).toBe("--quiet"); // cliExtraArgs prepended
    expect(callArgs.stdin).toBe("do the thing");
    expect(callArgs.timeoutMs).toBe(5000);
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
    mockRunCliProcess.mockReset();
  });

  it("parses a 'final' step from a JSON envelope wrapping the model output", async () => {
    const envelope = JSON.stringify({
      result: '{"kind":"final","content":"answer"}',
    });
    mockRunCliProcess.mockResolvedValueOnce(okResult(envelope));

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(step.kind).toBe("final");
    if (step.kind === "final") {
      expect(step.content).toBe("answer");
    }
  });

  it("parses a 'tools' step from a JSON envelope", async () => {
    const envelope = JSON.stringify({
      result: '{"kind":"tools","calls":[{"name":"list_ps_tables","arguments":"{}"}]}',
    });
    mockRunCliProcess.mockResolvedValueOnce(okResult(envelope));

    const step = await claudeCliAgenticStep({
      cfg,
      messages: [{ role: "user", content: "list tables" }],
    });
    expect(step.kind).toBe("tools");
    if (step.kind === "tools") {
      expect(step.calls[0].name).toBe("list_ps_tables");
    }
  });

  it("falls back to raw stdout when stdout is the bare model JSON (no CLI envelope wrapper)", async () => {
    // The CLI dropped its envelope wrapper (older binary version): stdout is
    // the bare step JSON instead of `{"result": "..."}`. We still parse it.
    mockRunCliProcess.mockResolvedValueOnce(
      okResult('{"kind":"final","content":"raw"}'),
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

  it("throws LLM_CLI_AUTH when envelope is_error=true with 401", async () => {
    const envelope = JSON.stringify({
      is_error: true,
      api_error_status: 401,
      result: "invalid credentials",
    });
    mockRunCliProcess.mockResolvedValueOnce(okResult(envelope));

    await expect(
      claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "LLM_CLI_AUTH" });
  });

  it("throws LLM_CLI_API_ERROR when envelope is_error=true with non-auth status", async () => {
    const envelope = JSON.stringify({
      is_error: true,
      api_error_status: 503,
      result: "upstream timeout",
    });
    mockRunCliProcess.mockResolvedValueOnce(okResult(envelope));

    await expect(
      claudeCliAgenticStep({ cfg, messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "LLM_CLI_API_ERROR" });
  });
});
