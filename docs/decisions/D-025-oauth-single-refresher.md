---
id: D-025
title: Single-refresher rule for Claude OAuth — host launchd is the only refresher
date: 2026-04-27
---

# D-025: Single-refresher rule for Claude OAuth — host launchd is the only refresher

*Decided: 2026-04-27*

**Context**: Issue #440. The dashboard's CLI provider needs the host's Claude OAuth credentials. On macOS those live in the Keychain entry `Claude Code-credentials`. Earlier this week (`8f22c97`) the container's entrypoint refreshed the token through `claude.ai/api/auth/oauth/token` whenever access expired within an hour. OAuth refresh-token rotation issues a new refresh_token on every successful refresh and revokes the previous one — so the container's refresh wrote the new refresh_token to `~/.claude/.credentials.json` while the Keychain still held the now-revoked old one. The next time host claude tried to use the Keychain it got 401 invalid_grant, forcing the user to `claude /login`. This actually happened to me as I was helping the user; D-025 is the post-mortem.
**Decision**:
- The Keychain entry is the **single source of truth** for the OAuth payload.
- Only **one process** ever refreshes it: the host claude CLI itself, during normal interactive use. Cloudflare blocks direct curl POSTs to the OAuth endpoint, so a shell-level refresh is not viable (issue #419, D-024).
- A launchd agent (`scripts/launchd/com.powershop.claude-token-sync.plist.template`, installed via `scripts/install-claude-token-launchd.sh`) runs every 2 hours and **only mirrors** the current Keychain contents into `~/.claude/.credentials.json`. It never refreshes, never mutates the Keychain, and writes the file atomically (temp + rename) so the dashboard container never observes a partial JSON.
- The container's `dashboard/docker-entrypoint.sh` has been stripped of its old refresh logic. It now only seeds `~/.claude.json` from the read-only host mount and reports remaining token lifetime in its boot logs.
- Production (configured via `PROD_HOST` / `PROD_PATH` in `.env`, also a Mac) follows the same rule. The new `prod/` directory contains a docker-compose override and a README; `cli/commands/prod.sh` exposes `ps prod {deploy,update,restart,status,logs,version,health,push-config,token-status,login,ssh}` so the prod box can be driven from local without a manual ssh shell.
- Default `DASHBOARD_LLM_PROVIDER` flipped from `openrouter` to `cli` in `config/schema.yaml` and the TypeScript loader fallback. OpenRouter remains supported but is no longer the default — the user explicitly does not want it active out of the box.
**Alternatives rejected**:
- **Container-side refresh**: causes the exact bug we are fixing.
- **Active refresh from a host bash script**: blocked by Cloudflare; the script tested as a curl POST returns the anti-bot HTML challenge page, no JSON.
- **Polling host claude with a no-op invocation to nudge it into refreshing**: empirically does NOT cause Keychain rotation (verified: invoking `claude -p "ok"` left the Keychain `mdat` unchanged).
**Rationale**: The honest answer is that the OAuth surface is not refreshable from anywhere other than the host claude binary, and the host claude binary only refreshes during normal interactive use. The launchd agent fans that user-driven refresh out to the dashboard container with a < 2 h propagation delay, which is well within the access-token lifetime (~8 h). When the access token actually expires and host claude cannot refresh through Cloudflare in time, the user runs `claude /login` once on the relevant host and the launchd cycle picks up the new token automatically.
**See**: `scripts/sync-claude-token.sh`, `scripts/install-claude-token-launchd.sh`, `scripts/launchd/com.powershop.claude-token-sync.plist.template`, `scripts/prod-bootstrap.sh`, `prod/docker-compose.override.prod.yml`, `prod/README.md`, `cli/commands/prod.sh`, `dashboard/docker-entrypoint.sh`, `config/schema.yaml`, `dashboard/lib/llm-provider/config.ts`, memory `project_dashboard_claude_cli_auth.md`.
