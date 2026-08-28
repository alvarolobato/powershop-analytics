/**
 * Safe CLI process runner: spawn argv array (no shell), timeout, stdout/stderr caps.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { RunProcessResult } from "./types";
import { CliRunnerError } from "./errors";
import { sanitize, sanitizeArgv, sanitizeTail } from "../sanitize";

export interface RunCliProcessParams {
  file: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

/** Max bytes of stdout/stderr we keep on a CliRunnerError for the UI/log layer. */
const TAIL_MAX_BYTES = 4096;

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
 * Write `input` to the child's stdin without letting an EPIPE crash the server.
 *
 * When the CLI exits before draining stdin — a rejected flag, an auth
 * failure, anything that fails fast — the write end breaks and Node emits
 * `error` on the stdin stream. That is a SEPARATE emitter from
 * `child.on("error")` below, which only covers spawn-level failures, so
 * nothing was listening for it: an unhandled `error` on a stream takes down
 * the whole Node process, not just this request.
 *
 * Not hypothetical here: prompts routinely carry a full dashboard spec plus
 * chat history plus the agentic tool catalog, comfortably past the ~64KB
 * pipe buffer, so the write does not always complete synchronously and the
 * race is real on a fast-failing invocation (a bad flag, a stale auth
 * token).
 */
function writeStdinSafely(
  stdinStream: NodeJS.WritableStream | null,
  input: string | undefined,
): void {
  if (!stdinStream) return;
  // Absorb EPIPE/ECONNRESET: the child closing stdin early is normal, not
  // fatal — the exit code (surfaced separately via assertCliSuccess) already
  // tells the caller what happened.
  stdinStream.on("error", () => {
    /* child closed stdin before the write completed */
  });
  try {
    if (input !== undefined) stdinStream.write(input, "utf8");
    stdinStream.end();
  } catch {
    /* synchronous throw on an already-destroyed stream — same non-fatal case */
  }
}

/**
 * Spawn `file` with `args` (no shell). Always resolves when the child exits; sets `timedOut`
 * if the watchdog fired before then. Use `assertCliSuccess` to throw on timeout, truncation,
 * or non-zero exit.
 */
export async function runCliProcess(params: RunCliProcessParams): Promise<RunProcessResult> {
  const { file, args, stdin, timeoutMs, maxStdoutBytes, maxStderrBytes } = params;
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
      // Run from a neutral directory rather than inheriting the server's
      // cwd. Claude Code auto-discovers CLAUDE.md/AGENTS.md from the working
      // directory and walks up looking for more — this repo's own CLAUDE.md
      // documents real production operational rules (D-025's OAuth
      // single-refresher constraint, workflow-file restrictions, etc.).
      // Inheriting the dashboard container's cwd would fold all of that
      // into every dashboard prompt for free. A neutral cwd avoids it
      // structurally instead of relying on prompt/flag discipline elsewhere.
      cwd: tmpdir(),
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

    writeStdinSafely(child.stdin, stdin);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: stdoutAcc.toStringUtf8(),
        stderr: stderrAcc.toStringUtf8(),
        timedOut,
        truncatedStdout: stdoutAcc.truncated,
        truncatedStderr: stderrAcc.truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export interface RunCliProcessStreamingParams extends RunCliProcessParams {
  /** Called with each complete JSON line (stripped of newline). */
  onStdoutLine: (line: string) => void;
}

/**
 * Streaming variant of `runCliProcess`. Pipes stdout through a line-buffered
 * reader, calling `onStdoutLine` for each complete line. Preserves the same
 * timeout/kill, EAGAIN, and stderr-capture behaviour as `runCliProcess`.
 * Returns the same `RunProcessResult` shape (stdout = full captured tail).
 */
export async function runCliProcessStreaming(
  params: RunCliProcessStreamingParams,
): Promise<RunProcessResult> {
  const { file, args, stdin, timeoutMs, maxStdoutBytes, maxStderrBytes, onStdoutLine } = params;
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
      // Neutral cwd — see the matching comment in `runCliProcess` above.
      cwd: tmpdir(),
    });

    const stdoutAcc = new CappedBufferCollector(maxStdoutBytes);
    const stderrAcc = new CappedBufferCollector(maxStderrBytes);
    let timedOut = false;
    // Partial-line buffer: holds bytes that arrived without a trailing \n yet.
    let partial = "";

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

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutAcc.push(chunk);
      // Split the incoming chunk on newlines, re-joining with any partial tail.
      const text = partial + chunk.toString("utf8");
      const lines = text.split("\n");
      // Last element is either "" (chunk ended with \n) or an incomplete line.
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            onStdoutLine(trimmed);
          } catch {
            /* callback errors must not crash the runner */
          }
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => stderrAcc.push(chunk));

    writeStdinSafely(child.stdin, stdin);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      // Flush any remaining partial line (no trailing newline at EOF).
      if (partial.trim()) {
        try {
          onStdoutLine(partial.trim());
        } catch {
          /* ignore */
        }
      }
      resolve({
        exitCode,
        stdout: stdoutAcc.toStringUtf8(),
        stderr: stderrAcc.toStringUtf8(),
        timedOut,
        truncatedStdout: stdoutAcc.truncated,
        truncatedStderr: stderrAcc.truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Map raw process outcome to CliRunnerError when not successful.
 *
 * `command` is the argv (file + args) the runner spawned; we sanitize it
 * before attaching to the error so callers can render it in the UI without
 * leaking secrets that may have been passed via `--api-key`-style flags.
 */
export function assertCliSuccess(
  result: RunProcessResult,
  label: string,
  command?: readonly string[],
): void {
  const sanitizedCommand = command ? sanitizeArgv(command) : undefined;
  const stderrTail = sanitizeTail(result.stderr, TAIL_MAX_BYTES);
  const stdoutTail = sanitizeTail(result.stdout, TAIL_MAX_BYTES);

  if (result.timedOut) {
    throw new CliRunnerError("LLM_CLI_TIMEOUT", `${label}: CLI timed out`, {
      exitCode: result.exitCode,
      stderr: stderrTail,
      stdout: stdoutTail,
      command: sanitizedCommand,
      phase: "timeout",
      durationMs: result.durationMs,
    });
  }
  if (result.truncatedStdout || result.truncatedStderr) {
    throw new CliRunnerError(
      "LLM_CLI_TRUNCATED",
      `${label}: CLI output exceeded capture limit`,
      {
        exitCode: result.exitCode,
        stderr: stderrTail,
        stdout: stdoutTail,
        command: sanitizedCommand,
        phase: "truncated",
        durationMs: result.durationMs,
      },
    );
  }
  if (result.exitCode !== 0) {
    // The Claude Code CLI prints API failures as a JSON envelope on stdout
    // with `is_error: true` and an exit code of 1, leaving stderr empty.
    // Promote that into a structured auth/API error so the API layer can
    // surface a meaningful "Detalles" payload instead of "exited with code 1".
    const envelope = parseJsonEnvelope(result.stdout);
    if (envelope && envelope.is_error) {
      const apiStatus = envelope.api_error_status ?? null;
      const inner = sanitize(envelope.result ?? "");
      const isAuth =
        apiStatus === 401 ||
        apiStatus === 403 ||
        /authentication|invalid.*credentials|unauthorized/i.test(inner);
      const code = isAuth ? "LLM_CLI_AUTH" : "LLM_CLI_API_ERROR";
      const summary = inner.slice(0, 240) || `api_error_status=${apiStatus}`;
      throw new CliRunnerError(code, `${label}: ${summary}`, {
        exitCode: result.exitCode,
        stderr: stderrTail,
        stdout: stdoutTail,
        command: sanitizedCommand,
        phase: isAuth ? "auth" : "exit",
        durationMs: result.durationMs,
        innerErrorCode: apiStatus,
      });
    }
    throw new CliRunnerError(
      "LLM_CLI_EXIT",
      `${label}: CLI exited with code ${result.exitCode}`,
      {
        exitCode: result.exitCode,
        stderr: stderrTail,
        stdout: stdoutTail,
        command: sanitizedCommand,
        phase: "exit",
        durationMs: result.durationMs,
      },
    );
  }
}

/**
 * Best-effort parse of `claude --output-format json` envelopes.
 *
 * Returns null when stdout is not a parseable JSON object. We do NOT require
 * `type === "result"`: some upstream API failures surface envelopes with
 * `is_error:true` but no `type` field, and we still want to lift those into
 * `LLM_CLI_AUTH` / `LLM_CLI_API_ERROR` instead of a bare exit-code message.
 *
 * Arrays and primitives are rejected — only object envelopes are accepted.
 */
function parseJsonEnvelope(stdout: string): {
  is_error?: boolean;
  api_error_status?: number | null;
  result?: string | null;
  type?: string;
} | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, never>;
  } catch {
    return null;
  }
}
