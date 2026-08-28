/**
 * Guards the two Compose files against silent divergence.
 *
 * `docker-compose.yml` runs locally; `docker-compose.prod.yml` is what ships as
 * a release asset and becomes production's `docker-compose.yml`. They are
 * separate files, and twice a change was made to one and not the other with
 * nothing to catch it:
 *
 *  - D-007 removed `SHOULD_FORCE_DEPLOY` in March because it makes the
 *    wren-ai-service entrypoint wait for a `WREN_UI_PORT` that is not in its
 *    env, fail, and exit. The fix went into docker-compose.yml only, so
 *    production kept restarting — 32,644 times before anyone looked.
 *  - `DASHBOARD_CONTEXT_DIR` (D-040) was added to docker-compose.yml with its
 *    bind mount. The prod file never got either, so the container fell back to
 *    an unwritable /app/data and every context-log write failed with EACCES.
 *    Writes are best-effort, so "Contexto original" was simply always empty.
 *
 * Both bugs are invisible locally and only appear in production, which is the
 * worst place to find them. This does not demand the files be identical — they
 * legitimately differ on build-vs-image, ports and bind mounts. It pins the
 * specific things that broke.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parse } from "yaml";

const repoRoot = path.resolve(__dirname, "../..");

function loadCompose(file: string): Record<string, any> {
  return parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
}

const dev = loadCompose("docker-compose.yml");
const prod = loadCompose("docker-compose.prod.yml");

/**
 * Env keys that may legitimately differ, each with the reason it differs.
 *
 * An earlier version of this file filtered to `DASHBOARD_*` keys before
 * consulting this set — and no entry starts with `DASHBOARD_`, so the set was
 * dead code and the "parity guard" was really comparing one key. Broadened to
 * every env key on the service, which immediately surfaced that
 * CLAUDE_CODE_OAUTH_TOKEN and HOME were missing from prod: the CLI provider
 * needs both, and /admin/config can switch provider at runtime.
 */
const ENV_EXEMPT: Record<string, string> = {
  // Local mounts the schema from the repo; the prod image bakes it in.
  CONFIG_SCHEMA_PATH: "prod bakes the schema into the image",
  // Local runs its own collector; prod has no collector service at all.
  OTEL_SERVICE_NAME: "no collector in prod",
  OTEL_EXPORTER_OTLP_ENDPOINT: "no collector in prod",
  OTEL_TRACES_SAMPLER: "no collector in prod",
  OTEL_TRACES_SAMPLER_ARG: "no collector in prod",
  OTEL_LOG_LEVEL: "no collector in prod",
  OTEL_SDK_DISABLED: "prod-only: silences exports to a collector that isn't there",
  ENVIRONMENT: "local-only telemetry label",
  NEXT_PUBLIC_GIT_SHA: "injected at build time locally",
  // Reverse-proxy / custom-domain settings that only exist in a real deployment.
  APP_PUBLIC_URL: "prod-only deployment URL",
  WREN_PUBLIC_URL: "prod-only deployment URL",
  CONFIG_FILE: "etl: prod resolves its own default path",
};

function envKeys(compose: Record<string, any>, service: string): Set<string> {
  const env = compose.services?.[service]?.environment ?? {};
  const all = Array.isArray(env)
    ? env.map((e: string) => e.split("=")[0])
    : Object.keys(env);
  return new Set(all.filter((k) => !(k in ENV_EXEMPT)));
}

describe("docker-compose.yml vs docker-compose.prod.yml", () => {
  it("never sets SHOULD_FORCE_DEPLOY on wren-ai-service in either file", () => {
    for (const [name, compose] of [["dev", dev], ["prod", prod]] as const) {
      const env = compose.services?.["wren-ai-service"]?.environment ?? {};
      const keys = Array.isArray(env) ? env.map((e: string) => e.split("=")[0]) : Object.keys(env);
      expect(
        keys,
        `${name}: SHOULD_FORCE_DEPLOY makes wren-ai-service crash-loop (D-007)`,
      ).not.toContain("SHOULD_FORCE_DEPLOY");
    }
  });

  it.each(["dashboard", "etl"])(
    "sets the same env keys on the %s service in both files",
    (service) => {
      const devKeys = envKeys(dev, service);
      const prodKeys = envKeys(prod, service);
      // "missing in prod" is the dangerous direction — it is how
      // DASHBOARD_CONTEXT_DIR shipped broken for months, and how the CLI
      // provider's credentials were absent from prod entirely.
      expect(
        [...devKeys].filter((k) => !prodKeys.has(k)),
        `${service}: set in docker-compose.yml but NOT in docker-compose.prod.yml`,
      ).toEqual([]);
      expect(
        [...prodKeys].filter((k) => !devKeys.has(k)),
        `${service}: set in docker-compose.prod.yml but NOT in docker-compose.yml`,
      ).toEqual([]);
    },
  );

  it("silences OTel exports on the prod etl service", () => {
    // The etl image runs under opentelemetry-instrument and prod has no
    // collector; without this, 95% of that container's log lines were failed
    // OTLP exports, burying the sync errors you actually need to read.
    const env = prod.services?.etl?.environment ?? {};
    const val = Array.isArray(env)
      ? env.find((e: string) => e.startsWith("OTEL_SDK_DISABLED="))?.split("=")[1]
      : env.OTEL_SDK_DISABLED;
    expect(String(val ?? "")).toMatch(/true/);
  });

  it("backs DASHBOARD_CONTEXT_DIR with a writable mount wherever it is set", () => {
    for (const [name, compose] of [["dev", dev], ["prod", prod]] as const) {
      const svc = compose.services?.dashboard ?? {};
      const env = svc.environment ?? {};
      const dir = Array.isArray(env)
        ? env.find((e: string) => e.startsWith("DASHBOARD_CONTEXT_DIR="))?.split("=")[1]
        : env.DASHBOARD_CONTEXT_DIR;
      if (!dir) continue;
      const mounts: string[] = svc.volumes ?? [];
      // Exact target match, not a substring: a truncated DASHBOARD_CONTEXT_DIR
      // (say a missing trailing letter) would still satisfy `includes` while
      // breaking at runtime.
      const backing = mounts.find((m) => {
        const parts = m.split(":");
        return parts.length >= 2 && parts[1] === dir;
      });
      expect(backing, `${name}: DASHBOARD_CONTEXT_DIR=${dir} has no bind mount — writes will EACCES`).toBeTruthy();
      expect(backing, `${name}: ${dir} must be writable (:rw)`).not.toMatch(/:ro$/);
    }
  });

  it("caps log growth on every production service", () => {
    // Unbounded json-file logs reached 961 MB (qdrant) and 636 MB
    // (wren-ai-service) in production before anyone noticed.
    const missing = Object.entries(prod.services ?? {})
      .filter(([, svc]: [string, any]) => !svc?.logging)
      .map(([name]) => name);
    expect(missing, "prod services without a logging driver (unbounded log growth)").toEqual([]);
  });
});
