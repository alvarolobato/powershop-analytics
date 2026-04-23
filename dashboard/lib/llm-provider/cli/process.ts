/**
 * Safe CLI process runner: spawn argv array (no shell), timeout, stdout/stderr caps.
 */

import { spawn } from "node:child_process";
import type { RunProcessResult } from "./types";
import { CliRunnerError } from "./errors";

export interface RunCliProcessParams {
  file: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

function appendCapped(
  acc: { buf: Buffer; truncated: boolean },
  chunk: Buffer,
  maxBytes: number,
): void {
  const space = maxBytes - acc.buf.length;
  if (space <= 0) {
    acc.truncated = true;
    return;
  }
  if (chunk.length <= space) {
    acc.buf = Buffer.concat([acc.buf, chunk]);
  } else {
    acc.buf = Buffer.concat([acc.buf, chunk.subarray(0, space)]);
    acc.truncated = true;
  }
}

/**
 * Spawn `file` with `args` (no shell). Rejects on timeout; resolves with exit code and capped streams.
 */
export async function runCliProcess(params: RunCliProcessParams): Promise<RunProcessResult> {
  const { file, args, stdin, timeoutMs, maxStdoutBytes, maxStderrBytes } = params;

  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    const stdoutAcc = { buf: Buffer.alloc(0), truncated: false };
    const stderrAcc = { buf: Buffer.alloc(0), truncated: false };
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000);
      killTimer.unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdoutAcc, chunk, maxStdoutBytes));
    child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderrAcc, chunk, maxStderrBytes));

    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin, "utf8");
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: stdoutAcc.buf.toString("utf8"),
        stderr: stderrAcc.buf.toString("utf8"),
        timedOut,
        truncatedStdout: stdoutAcc.truncated,
        truncatedStderr: stderrAcc.truncated,
      });
    });
  });
}

/** Map raw process outcome to CliRunnerError when not successful. */
export function assertCliSuccess(
  result: RunProcessResult,
  label: string,
): void {
  if (result.timedOut) {
    throw new CliRunnerError(
      "LLM_CLI_TIMEOUT",
      `${label}: CLI timed out`,
      { exitCode: result.exitCode, stderr: result.stderr },
    );
  }
  if (result.truncatedStdout || result.truncatedStderr) {
    throw new CliRunnerError(
      "LLM_CLI_TRUNCATED",
      `${label}: CLI output exceeded capture limit`,
      { exitCode: result.exitCode, stderr: result.stderr },
    );
  }
  if (result.exitCode !== 0) {
    throw new CliRunnerError(
      "LLM_CLI_EXIT",
      `${label}: CLI exited with code ${result.exitCode}`,
      { exitCode: result.exitCode, stderr: result.stderr },
    );
  }
}
