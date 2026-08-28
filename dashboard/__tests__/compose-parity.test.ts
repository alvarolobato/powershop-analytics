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

/** DASHBOARD_* env keys that may legitimately differ between dev and prod — each needs a reason, not just a name. */
const DASHBOARD_ENV_EXEMPT = new Set<string>([
  // Add DASHBOARD_* keys here only; keysOf() already filters to that prefix.
]);

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

  it("sets every DASHBOARD_* env key on the dashboard service in both files", () => {
    const keysOf = (c: Record<string, any>) => {
      const env = c.services?.dashboard?.environment ?? {};
      const all = Array.isArray(env) ? env.map((e: string) => e.split("=")[0]) : Object.keys(env);
      return new Set(all.filter((k) => k.startsWith("DASHBOARD_") && !DASHBOARD_ENV_EXEMPT.has(k)));
    };
    const devKeys = keysOf(dev);
    const prodKeys = keysOf(prod);

    const missingInProd = [...devKeys].filter((k) => !prodKeys.has(k));
    const missingInDev = [...prodKeys].filter((k) => !devKeys.has(k));

    // Directional message: "missing in prod" is the dangerous direction — it is
    // how DASHBOARD_CONTEXT_DIR shipped broken for months.
    expect(missingInProd, "set in docker-compose.yml but NOT in docker-compose.prod.yml").toEqual([]);
    expect(missingInDev, "set in docker-compose.prod.yml but NOT in docker-compose.yml").toEqual([]);
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
      const backing = mounts.find((m) => m.includes(`:${dir}`));
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
