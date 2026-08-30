/**
 * Drift guard for the generated `lib/knowledge-index.ts`.
 *
 * `lib/knowledge.ts` has one in CI (`npm run build:knowledge && git diff
 * --exit-code lib/knowledge.ts`). The index needs the same protection, but the
 * workflow file is off limits to agents (D-029), so the guard lives here — it
 * runs in `npm test`, which CI already executes.
 *
 * If this fails: run `npm run build:knowledge` and commit the result. Never
 * hand-edit `lib/knowledge-index.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildChunks, renderModule, sourcesAvailable, OUTPUT } from "../../scripts/build-knowledge-index.mjs";

// The docs/ tree is absent inside the Docker image build (same reason
// package.json's `prebuild` guards on it), so skip rather than fail there.
const canRun = sourcesAvailable();

describe.skipIf(!canRun)("knowledge-index.ts drift guard", () => {
  it("matches what the source MDs generate", () => {
    const expected = renderModule(buildChunks({ warn: false }));
    const actual = readFileSync(OUTPUT, "utf8");
    expect(
      actual === expected,
      "lib/knowledge-index.ts is stale — run `npm run build:knowledge` and commit the result.",
    ).toBe(true);
  });

  it("carries the do-not-edit banner", () => {
    expect(readFileSync(OUTPUT, "utf8")).toContain("NO editar a mano");
  });
});
