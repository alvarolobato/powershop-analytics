import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";

const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { runCliProcess } from "@/lib/llm-provider/cli/process";

type MockChild = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function baseChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  // `on` is needed because writeStdinSafely() registers an "error" listener
  // on the stdin stream before writing (EPIPE guard) — see process.ts.
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null));
  });
  return child;
}

describe("runCliProcess (mocked spawn)", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes stdin utf-8 and resolves stdout on exit 0", async () => {
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("ok"));
        child.emit("close", 0);
      });
      return child;
    });

    const r = await runCliProcess({
      file: "/bin/true",
      args: [],
      stdin: "payload",
      timeoutMs: 5000,
      maxStdoutBytes: 1000,
      maxStderrBytes: 500,
    });

    expect(r.stdout).toBe("ok");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    const child = mockSpawn.mock.results[0].value as MockChild;
    expect(child.stdin.write).toHaveBeenCalledWith("payload", "utf8");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("sets timedOut when watchdog fires and child exits after kill", async () => {
    vi.useFakeTimers();
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      return child;
    });

    const p = runCliProcess({
      file: "x",
      args: [],
      timeoutMs: 50,
      maxStdoutBytes: 100,
      maxStderrBytes: 100,
    });
    await vi.advanceTimersByTimeAsync(60);
    const r = await p;
    expect(r.timedOut).toBe(true);
  });

  it("caps stdout bytes across multiple chunks", async () => {
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.alloc(40, "a"));
        child.stdout.emit("data", Buffer.alloc(40, "b"));
        child.emit("close", 0);
      });
      return child;
    });

    const r = await runCliProcess({
      file: "x",
      args: [],
      timeoutMs: 2000,
      maxStdoutBytes: 50,
      maxStderrBytes: 100,
    });
    expect(r.stdout.length).toBe(50);
    expect(r.truncatedStdout).toBe(true);
  });

  it("rejects when child emits error", async () => {
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
      return child;
    });

    await expect(
      runCliProcess({
        file: "missing-binary",
        args: [],
        timeoutMs: 1000,
        maxStdoutBytes: 100,
        maxStderrBytes: 100,
      }),
    ).rejects.toThrow("spawn ENOENT");
  });

  it("spawns with a neutral cwd (tmpdir), not the server's own cwd", async () => {
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await runCliProcess({
      file: "/bin/true",
      args: [],
      timeoutMs: 1000,
      maxStdoutBytes: 100,
      maxStderrBytes: 100,
    });

    const spawnOpts = mockSpawn.mock.calls[0][2] as { cwd?: string };
    expect(spawnOpts.cwd).toBe(tmpdir());
    expect(spawnOpts.cwd).not.toBe(process.cwd());
  });

  it("does not reject or throw when the child's stdin emits EPIPE mid-write", async () => {
    mockSpawn.mockImplementation(() => {
      const child = baseChild();
      // Simulate the child stdin breaking (child exited before draining
      // stdin): writeStdinSafely() must have registered an "error" listener
      // that absorbs this instead of it propagating as an unhandled stream
      // error.
      child.stdin.on.mockImplementation((event: string, handler: (err: Error) => void) => {
        if (event === "error") {
          queueMicrotask(() => handler(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
        }
      });
      queueMicrotask(() => child.emit("close", 1));
      return child;
    });

    const largePayload = "x".repeat(200_000); // comfortably past the ~64KB pipe buffer
    await expect(
      runCliProcess({
        file: "/bin/false",
        args: [],
        stdin: largePayload,
        timeoutMs: 1000,
        maxStdoutBytes: 100,
        maxStderrBytes: 100,
      }),
    ).resolves.toMatchObject({ exitCode: 1 });
  });
});
