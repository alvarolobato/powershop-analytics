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
  // Same test the loader applies (trim, then treat "" as unset), so the admin
  // config page and the runtime can never report different values for the same
  // key. A whitespace-only env var previously meant "unset" here but was
  // authoritative in the loader, which showed up as `source: env, value: 0` on
  // the admin page for a key the runtime was reading from config.yaml.
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  try {
    const value = getSystemConfig()[configKey]?.value;
    if (value !== null && value !== undefined) {
      const s = String(value).trim();
      if (s !== "") return s;
    }
  } catch (err) {
    // A bare `catch {}` here would be the very defect D-055 exists to outlaw,
    // one layer up: `coerce()` throws on ANY malformed value in config.yaml,
    // and getSystemConfig builds the whole map — so a single typo in an
    // unrelated key (`dashboard.port: "not-a-number"`) makes EVERY
    // schema-backed setting silently revert to its default. config.yaml is
    // hand-editable by design (D-023), so that is a realistic operator
    // mistake, and silence is exactly what made the original bug survive for
    // months. Warned once per process per key so a hot path cannot spam.
    if (!warnedKeys.has(configKey)) {
      warnedKeys.add(configKey);
      console.warn(
        `[config] loader unavailable while reading "${configKey}"; falling back to the built-in default. ` +
          `A malformed value ANYWHERE in config.yaml causes this for every key:`,
        err,
      );
    }
  }
  return undefined;
}

/** Keys already warned about, so a hot path warns once rather than per call. */
const warnedKeys = new Set<string>();
