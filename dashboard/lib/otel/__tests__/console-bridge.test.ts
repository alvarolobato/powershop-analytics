import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger, LogRecord } from "@opentelemetry/api-logs";
import { installConsoleBridge, uninstallConsoleBridge } from "../console-bridge";

function fakeLogger(emit: (record: LogRecord) => void): Logger {
  return { emit } as unknown as Logger;
}

describe("console-bridge", () => {
  afterEach(() => {
    uninstallConsoleBridge();
    vi.restoreAllMocks();
  });

  it("still writes to the real console (stdout) after bridging", () => {
    const realLog = vi.spyOn(console, "log").mockImplementation(() => {});
    installConsoleBridge(fakeLogger(() => {}));

    console.log("hello", 42);

    // spy captured the call BEFORE installConsoleBridge patched console.log,
    // so re-fetch: after patching, console.log is a new function that must
    // still invoke the pre-patch console.log we mocked.
    expect(realLog).toHaveBeenCalledWith("hello", 42);
  });

  it("emits an OTel log record for console.error with ERROR severity", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const emit = vi.fn();
    installConsoleBridge(fakeLogger(emit));

    console.error("boom", { code: 1 });

    expect(emit).toHaveBeenCalledTimes(1);
    const record = emit.mock.calls[0][0] as LogRecord;
    expect(record.severityText).toBe("ERROR");
    expect(record.body).toContain("boom");
  });

  it("emits INFO severity for console.log and console.info", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const emit = vi.fn();
    installConsoleBridge(fakeLogger(emit));

    console.log("a");
    console.info("b");

    expect(emit).toHaveBeenCalledTimes(2);
    expect((emit.mock.calls[0][0] as LogRecord).severityText).toBe("INFO");
    expect((emit.mock.calls[1][0] as LogRecord).severityText).toBe("INFO");
  });

  it("does not throw and still logs to stdout when the logger throws", () => {
    const realWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingLogger = fakeLogger(() => {
      throw new Error("exporter is on fire");
    });
    installConsoleBridge(throwingLogger);

    expect(() => console.warn("still works")).not.toThrow();
    expect(realWarn).toHaveBeenCalledWith("still works");
  });

  it("guards against re-entrant emit calling a patched console method", () => {
    const realError = vi.spyOn(console, "error").mockImplementation(() => {});
    let reentered = false;
    const reentrantLogger = fakeLogger(() => {
      // Simulate a bug where emitting a log record ends up calling a
      // patched console method again (e.g. through some internal logger).
      reentered = true;
      console.error("nested call from inside emit()");
    });
    installConsoleBridge(reentrantLogger);

    expect(() => console.error("outer")).not.toThrow();
    expect(reentered).toBe(true);
    // Both the outer and the nested console.error calls must still reach
    // the real console (no output swallowed)...
    expect(realError).toHaveBeenCalledWith("outer");
    expect(realError).toHaveBeenCalledWith("nested call from inside emit()");
  });

  it("is idempotent — calling install twice does not double-patch", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const emit = vi.fn();
    installConsoleBridge(fakeLogger(emit));
    installConsoleBridge(fakeLogger(emit)); // second call should be a no-op

    console.log("once");

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("uninstall restores the original console methods", () => {
    const original = console.log;
    installConsoleBridge(fakeLogger(() => {}));
    expect(console.log).not.toBe(original);

    uninstallConsoleBridge();

    expect(console.log).toBe(original);
  });
});
