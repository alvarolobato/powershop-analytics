---
id: D-055
title: A key in schema.yaml must be read through the config loader, never process.env alone
date: 2026-08-29
---

# D-055: A key in schema.yaml must be read through the config loader, never process.env alone

*Decided: 2026-08-29*

**Context**: `config/schema.yaml` declared six `dashboard.agentic_*` keys with
`requires_restart: []`, the admin UI wrote them to `config.yaml` through
`writeConfig`, and the UI reported success. But `dashboard/lib/llm-tools/config.ts`
read `process.env` and nothing else, so the file was never consulted.

The owner raised the agentic caps to 40 rounds / 100 calls on 2026-08-28. The
values were written correctly and were visible in both the host and the
container's mounted `/config/config.yaml`. Production kept running the
hardcoded defaults — 8 rounds / 24 calls — and kept producing
`Exceeded maximum tool calls (24).` The only way to detect it was that the
error text embeds the live limit and `llm_errors.limits` recorded
`{"maxRounds": 8, "maxToolCalls": 24}`.

Two reviewers checked this independently. The first concluded the caps had
never been raised (it read the wrong file). The second found the file was
correct and the *code* was wrong. Verifying that config.yaml contains a value
proves nothing on its own — the check that matters is whether the code reads it.

**Decision**:

1. Every key declared in `config/schema.yaml` must be read through
   `getSystemConfig()` / `getConfigValue()`. Reading `process.env` alone for a
   schema-declared key is a bug, because it makes the admin UI and `config.yaml`
   silently inert for that key.
2. Read `process.env` **first**, then the loader, then the schema default. The
   loader applies the same `env > config.yaml > default` order itself, but it
   caches on the config file's mtime — so a process that changes an env var
   after first read (every test using `vi.stubEnv`; any runtime mutating env)
   keeps getting the stale pre-stub value and the env override silently loses
   to `config.yaml`, inverting D-023.
3. The single documented exception is `lib/admin-api-auth.ts`, which reads env
   only *on purpose* so the admin key cannot be escalated through the UI that
   the key protects. Any future exception needs the same kind of comment saying
   why.

**Alternatives rejected**:
- *Have the entrypoint export config.yaml into env.* Would fix this instance
  and leave the general trap in place, plus it breaks `requires_restart: []` —
  the value would only change on restart.
- *Let the loader own env precedence entirely (no direct env read).* Clean in
  principle, but the mtime cache makes it wrong in practice; see point 2.

**Rationale**: A setting that reports success and does nothing is worse than one
that fails loudly — the owner had no reason to doubt it, and three months of
cap-exceeded errors were attributed to the caps being too low rather than to the
raise never landing.

**Known remaining exceptions** (audited 2026-08-29; 8 schema keys still read
env-only, all deliberate-by-context but none previously documented as such):

- `postgres.dsn` / `postgres.host` / `postgres.port` / `postgres.user` /
  `postgres.password` / `postgres.db` (`lib/db-shared.ts`) — these bootstrap the
  database connection. Wiring them through the loader is possible (it reads a
  YAML file, not the DB) but touches the connection path for every component,
  so it needs its own change and its own verification.
- `dashboard.admin_cookie_secure` (`app/admin/login/actions.ts`) — on the admin
  auth path, adjacent to `admin-api-auth.ts`'s deliberate env-only read. Likely
  belongs under the same exception, but that should be an explicit security
  decision rather than an inherited one.

Anything added to `schema.yaml` from now on goes through the loader unless it
carries a comment saying why not.

**See**: `dashboard/lib/llm-tools/config.ts`,
`dashboard/lib/llm-tools/__tests__/config.test.ts`,
`config/schema.yaml` (Agentic section), [D-023](D-023-central-config-yaml.md).
