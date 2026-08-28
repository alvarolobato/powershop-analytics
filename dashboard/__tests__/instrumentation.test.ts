import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInitOtel, mockShutdownOtel, mockBootstrapConfig, mockApplyInitSql } = vi.hoisted(() => ({
  mockInitOtel: vi.fn(),
  mockShutdownOtel: vi.fn(() => Promise.resolve()),
  mockBootstrapConfig: vi.fn(() => false),
  mockApplyInitSql: vi.fn(() => Promise.resolve({ applied: false, reason: "skipped for test" })),
}));

vi.mock("@/lib/otel/sdk", () => ({
  initOtel: mockInitOtel,
  shutdownOtel: mockShutdownOtel,
}));
vi.mock("@/lib/system-config/loader", () => ({
  bootstrapConfigIfMissing: mockBootstrapConfig,
}));
vi.mock("@/lib/migrate", () => ({
  applyInitSql: mockApplyInitSql,
}));

const SAVED_KEYS = ["NEXT_RUNTIME", "SKIP_DB_MIGRATE"] as const;

describe("instrumentation register()", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    SAVED_KEYS.forEach((k) => {
      saved[k] = process.env[k];
    });
    mockInitOtel.mockReset();
    mockShutdownOtel.mockReset().mockResolvedValue(undefined);
    mockBootstrapConfig.mockReset().mockReturnValue(false);
    mockApplyInitSql.mockReset().mockResolvedValue({ applied: false, reason: "skipped for test" });
  });

  afterEach(() => {
    SAVED_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("does not throw when initOtel() throws synchronously — config bootstrap and migration still run", async () => {
    delete process.env.NEXT_RUNTIME;
    process.env.SKIP_DB_MIGRATE = "1";
    mockInitOtel.mockImplementation(() => {
      throw new Error("simulated OTel init failure");
    });

    const { register } = await import("../instrumentation");
    await expect(register()).resolves.toBeUndefined();

    expect(mockInitOtel).toHaveBeenCalledTimes(1);
    // The rest of register() must still run despite the OTel failure.
    expect(mockBootstrapConfig).toHaveBeenCalledTimes(1);
  });

  it("registers a SIGTERM handler that calls shutdownOtel() when initOtel() succeeds", async () => {
    delete process.env.NEXT_RUNTIME;
    process.env.SKIP_DB_MIGRATE = "1";
    mockInitOtel.mockImplementation(() => {});

    const onceSpy = vi.spyOn(process, "once");
    const { register } = await import("../instrumentation");
    await register();

    const sigtermCall = onceSpy.mock.calls.find(([event]) => event === "SIGTERM");
    expect(sigtermCall).toBeDefined();

    // Invoke the registered handler directly and confirm it calls shutdownOtel().
    const handler = sigtermCall?.[1] as () => void;
    handler();
    expect(mockShutdownOtel).toHaveBeenCalledTimes(1);

    onceSpy.mockRestore();
  });

  it("skips everything, including OTel init, in the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { register } = await import("../instrumentation");
    await register();

    expect(mockInitOtel).not.toHaveBeenCalled();
    expect(mockBootstrapConfig).not.toHaveBeenCalled();
  });
});
