import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initOtel, shutdownOtel, __resetOtelStateForTests, __isOtelInitializedForTests } from "../sdk";

const SAVED_KEYS = ["NEXT_PHASE", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME"] as const;

describe("sdk (real OTel packages, no mocking)", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    SAVED_KEYS.forEach((k) => {
      saved[k] = process.env[k];
    });
    __resetOtelStateForTests();
  });

  afterEach(async () => {
    await shutdownOtel();
    __resetOtelStateForTests();
    SAVED_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("never throws, even with an unreachable collector endpoint", async () => {
    // Point at a port nothing listens on — the exporter must fail silently
    // in the background, not synchronously during initOtel().
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1";
    expect(() => initOtel()).not.toThrow();
    expect(__isOtelInitializedForTests()).toBe(true);
  });

  it("is a no-op (idempotent) on a second call", () => {
    initOtel();
    expect(__isOtelInitializedForTests()).toBe(true);
    expect(() => initOtel()).not.toThrow();
    expect(__isOtelInitializedForTests()).toBe(true);
  });

  it("skips initialization entirely during `next build`", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    initOtel();
    expect(__isOtelInitializedForTests()).toBe(false);
  });

  it("shutdownOtel resolves quickly even with nothing to flush", async () => {
    const start = Date.now();
    await shutdownOtel();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("shutdownOtel after a real init completes within its timeout bound", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1";
    initOtel();
    const start = Date.now();
    await shutdownOtel(2000);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(__isOtelInitializedForTests()).toBe(false);
  });
});

describe("sdk fail-open on SDK construction/start errors", () => {
  afterEach(() => {
    vi.doUnmock("@opentelemetry/sdk-node");
    vi.resetModules();
  });

  it("catches a throwing NodeSDK.start() and leaves the app uninitialized, not crashed", async () => {
    vi.resetModules();
    vi.doMock("@opentelemetry/sdk-node", () => ({
      NodeSDK: class {
        start() {
          throw new Error("simulated bad configuration");
        }
        shutdown() {
          return Promise.resolve();
        }
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../sdk");

    expect(() => mod.initOtel()).not.toThrow();
    expect(mod.__isOtelInitializedForTests()).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[otel] SDK initialization failed"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
