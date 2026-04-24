/**
 * Safe CLI process runner: spawn argv array (no shell), timeout, stdout/stderr caps.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunProcessResult } from "./types";
import { CliRunnerError } from "./errors";

/**
 * Create a fresh isolated HOME directory for a single claude invocation.
 * Auth comes from CLAUDE_CODE_OAUTH_TOKEN env var (inherited from process.env),
 * so no credentials need to be copied. Isolation prevents concurrent writes to
 * a shared ~/.claude.json from corrupting the config file.
 */
function isolatedClaudeHome(): string {
  const tmp = mkdtempSync(join(tmpdir(), "claude-home-"));
  try {
    mkdirSync(join(tmp, ".claude"), { recursive: true });
  } catch {
    // ignore — claude will create it
  }
  return tmp;
}

export interface RunCliProcessParams {
  file: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

class CappedBufferCollector {
  readonly chunks: Buffer[] = [];
  private total = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    const space = this.maxBytes - this.total;
    if (space <= 0) {
      this.truncated = true;
      return;
    }
    if (chunk.length <= space) {
      this.chunks.push(chunk);
      this.total += chunk.length;
    } else {
      this.chunks.push(chunk.subarray(0, space));
      this.total += space;
      this.truncated = true;
    }
  }

  toStringUtf8(): string {
    if (this.chunks.length === 0) return "";
    if (this.chunks.length === 1) return this.chunks[0].toString("utf8");
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Spawn `file` with `args` (no shell). Always resolves when the child exits; sets `timedOut`
 * if the watchdog fired before then. Use `assertCliSuccess` to throw on timeout, truncation,
 * or non-zero exit.
 */
export async function runCliProcess(params: RunCliProcessParams): Promise<RunProcessResult> {
  const { file, args, stdin, timeoutMs, maxStdoutBytes, maxStderrBytes } = params;

  // Each invocation gets its own fresh HOME so concurrent processes don't
  // corrupt a shared ~/.claude.json via simultaneous writes.
  // Auth is provided by CLAUDE_CODE_OAUTH_TOKEN (inherited from process.env).
  const tmpHome = isolatedClaudeHome();

  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: tmpHome },
      windowsHide: true,
    });

    const stdoutAcc = new CappedBufferCollector(maxStdoutBytes);
    const stderrAcc = new CappedBufferCollector(maxStderrBytes);
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
    timer.unref();

    child.stdout?.on("data", (chunk: Buffer) => stdoutAcc.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrAcc.push(chunk));

    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin, "utf8");
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({
        exitCode,
        stdout: stdoutAcc.toStringUtf8(),
        stderr: stderrAcc.toStringUtf8(),
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
