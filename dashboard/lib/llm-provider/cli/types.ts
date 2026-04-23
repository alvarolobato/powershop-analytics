export interface RunProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
}
