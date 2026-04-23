import { describe, it, expect } from "vitest";
import { assertCliSuccess } from "@/lib/llm-provider/cli/process";
import type { RunProcessResult } from "@/lib/llm-provider/cli/types";
import { CliRunnerError } from "@/lib/llm-provider/cli/errors";

describe("assertCliSuccess", () => {
  it("throws LLM_CLI_TIMEOUT when timedOut", () => {
    const r: RunProcessResult = {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      truncatedStdout: false,
      truncatedStderr: false,
    };
    expect(() => assertCliSuccess(r, "t")).toThrow(CliRunnerError);
    expect(() => assertCliSuccess(r, "t")).toThrow(/timed out/i);
  });

  it("throws LLM_CLI_TRUNCATED when streams truncated", () => {
    const r: RunProcessResult = {
      exitCode: 0,
      stdout: "x",
      stderr: "",
      timedOut: false,
      truncatedStdout: true,
      truncatedStderr: false,
    };
    expect(() => assertCliSuccess(r, "t")).toThrow(/capture limit/i);
  });

  it("throws LLM_CLI_EXIT on non-zero exit", () => {
    const r: RunProcessResult = {
      exitCode: 2,
      stdout: "",
      stderr: "boom",
      timedOut: false,
      truncatedStdout: false,
      truncatedStderr: false,
    };
    expect(() => assertCliSuccess(r, "t")).toThrow(/exited with code 2/);
  });

  it("passes on exit 0 without timeout or truncation", () => {
    const r: RunProcessResult = {
      exitCode: 0,
      stdout: "{}",
      stderr: "",
      timedOut: false,
      truncatedStdout: false,
      truncatedStderr: false,
    };
    expect(() => assertCliSuccess(r, "t")).not.toThrow();
  });
});
