import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_NAME,
  resolveServiceName,
  resolveServiceVersion,
  resolveDeploymentEnvironment,
  buildOtelResource,
} from "../resource";

const SAVED_KEYS = ["OTEL_SERVICE_NAME", "NEXT_PUBLIC_APP_PKG_VERSION", "ENVIRONMENT"] as const;

describe("resource", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    SAVED_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    SAVED_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe("resolveServiceName", () => {
    it("falls back to the canonical service name when OTEL_SERVICE_NAME is unset", () => {
      expect(resolveServiceName()).toBe("powershop-dashboard");
      expect(resolveServiceName()).toBe(DEFAULT_SERVICE_NAME);
    });

    it("falls back when OTEL_SERVICE_NAME is blank/whitespace", () => {
      process.env.OTEL_SERVICE_NAME = "   ";
      expect(resolveServiceName()).toBe(DEFAULT_SERVICE_NAME);
    });

    it("uses OTEL_SERVICE_NAME when set to a real value", () => {
      process.env.OTEL_SERVICE_NAME = "powershop-dashboard-staging";
      expect(resolveServiceName()).toBe("powershop-dashboard-staging");
    });
  });

  describe("resolveServiceVersion", () => {
    it("falls back to 0.0.0 when unset", () => {
      expect(resolveServiceVersion()).toBe("0.0.0");
    });

    it("uses NEXT_PUBLIC_APP_PKG_VERSION when set", () => {
      process.env.NEXT_PUBLIC_APP_PKG_VERSION = "0.4.2";
      expect(resolveServiceVersion()).toBe("0.4.2");
    });
  });

  describe("resolveDeploymentEnvironment", () => {
    it("falls back to development when unset", () => {
      expect(resolveDeploymentEnvironment()).toBe("development");
    });

    it("uses ENVIRONMENT when set", () => {
      process.env.ENVIRONMENT = "production";
      expect(resolveDeploymentEnvironment()).toBe("production");
    });
  });

  describe("buildOtelResource", () => {
    it("stamps service.name, service.version, deployment.environment", () => {
      process.env.OTEL_SERVICE_NAME = "powershop-dashboard";
      process.env.NEXT_PUBLIC_APP_PKG_VERSION = "1.2.3";
      process.env.ENVIRONMENT = "production";

      const resource = buildOtelResource();
      const attrs = resource.attributes;

      expect(attrs["service.name"]).toBe("powershop-dashboard");
      expect(attrs["service.version"]).toBe("1.2.3");
      expect(attrs["deployment.environment"]).toBe("production");
    });

    it("never throws even with everything unset", () => {
      expect(() => buildOtelResource()).not.toThrow();
    });
  });
});
