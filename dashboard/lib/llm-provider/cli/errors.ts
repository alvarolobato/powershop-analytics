/**
 * CLI runner failures mapped for callers (HTTP-style codes where useful).
 */

export class CliRunnerError extends Error {
  readonly code: string;
  readonly exitCode: number | null;
  readonly stderrSnippet: string;

  constructor(
    code: string,
    message: string,
    opts?: { exitCode?: number | null; stderr?: string },
  ) {
    super(message);
    this.name = "CliRunnerError";
    this.code = code;
    this.exitCode = opts?.exitCode ?? null;
    this.stderrSnippet = (opts?.stderr ?? "").slice(0, 2000);
  }
}
