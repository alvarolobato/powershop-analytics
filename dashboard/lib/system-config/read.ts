/**
 * Read one schema-declared setting as a raw string.
 *
 * Order is env, then config.yaml, then undefined (the caller supplies its
 * default) — D-023's `env var > config.yaml > default`.
 *
 * Env is read directly rather than left to the loader, even though
 * `getSystemConfig()` applies the same precedence: the loader caches on the
 * config file's mtime, so a process that changes an env var after the first
 * read (every test using `vi.stubEnv`; any runtime mutating env) keeps getting
 * the stale pre-stub value and the env override silently loses to config.yaml.
 *
 * Use this for any key declared in `config/schema.yaml`. Reading `process.env`
 * alone for such a key makes the admin UI and config.yaml inert for it, which
 * is how production ran 8/24 agentic caps for months while config.yaml said
 * 40/100. See D-055.
 */

import { getSystemConfig } from "@/lib/system-config/loader";

export function readConfigString(
  envName: string,
  configKey: string,
): string | undefined {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  try {
    const value = getSystemConfig()[configKey]?.value;
    if (value !== null && value !== undefined) {
      const s = String(value).trim();
      if (s !== "") return s;
    }
  } catch {
    // Loader unavailable (missing schema file, etc.) — caller's default wins.
  }
  return undefined;
}
