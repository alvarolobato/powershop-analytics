import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * `dashboard/config/schema.yaml` is a build-context copy of the canonical
 * repo-root `config/schema.yaml`. It exists only because the dashboard image is
 * built with `./dashboard` as its Docker build context — in `docker-compose.yml`
 * and, more importantly, in `.github/workflows/release-docker.yml`, which builds
 * the image that production actually pulls. A `COPY` cannot reach outside its
 * build context, so the file the image bakes in has to live under `dashboard/`.
 *
 * Keeping a second copy is a real cost, and it already went wrong once: the two
 * files drifted to 26 keys vs 47, so production ran on a schema missing
 * `dashboard.port` and every `fourd.*` / `postgres.*` / `etl.*` / `wren.*` key.
 * Local dev never noticed, because `docker-compose.yml` bind-mounts the canonical
 * file over the baked-in one — and `docker-compose.prod.yml` has no such mount.
 *
 * The duplicate is fine as long as it cannot drift silently, which is what this
 * test is for — the same shape as the `knowledge.ts` drift guard. If it fails,
 * do not hand-edit the copy: run `npm run sync:schema`.
 */
describe("config/schema.yaml build-context copy", () => {
  const canonical = path.resolve(__dirname, "../../../config/schema.yaml");
  const copy = path.resolve(__dirname, "../../config/schema.yaml");

  it("is byte-identical to the canonical repo-root schema", () => {
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.existsSync(copy)).toBe(true);

    const a = fs.readFileSync(canonical, "utf8");
    const b = fs.readFileSync(copy, "utf8");

    if (a !== b) {
      const keys = (s: string) =>
        s.split("\n").filter((l) => l.startsWith("- key:")).length;
      throw new Error(
        `dashboard/config/schema.yaml has drifted from config/schema.yaml ` +
          `(${keys(a)} keys vs ${keys(b)}). The dashboard image bakes in the copy, ` +
          `so production would run on the stale one. Run: npm run sync:schema`,
      );
    }
    expect(b).toBe(a);
  });
});
