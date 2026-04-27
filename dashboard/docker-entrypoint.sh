#!/bin/sh
# Claude Code CLI auth bootstrap for the dashboard container.
#
# IMPORTANT — do NOT auto-refresh the OAuth token from inside the container.
# OAuth refresh-token rotation invalidates the previous refresh_token on every
# successful refresh. On macOS hosts the source of truth for the refresh token
# is the Keychain entry "Claude Code-credentials"; the container only sees a
# copy that scripts/sync-claude-token.sh wrote into ~/.claude/.credentials.json.
# If the container refreshes, the new refresh_token lands in the file but the
# Keychain still holds the old (now-invalidated) one, which forces the host
# claude CLI to re-login. Apr 2026 incident: that exact flow logged the user
# out of host claude. We therefore only seed config and report token state —
# we do NOT call /api/auth/oauth/token. When the access token expires, the
# user runs `bash scripts/sync-claude-token.sh` on the host to re-sync from
# Keychain. The Keychain itself is the only thing that should ever rotate the
# refresh token (driven by host claude or `claude /login`).

CREDS="$HOME/.claude/.credentials.json"

# Seed ~/.claude.json from the read-only host copy if present. We deliberately
# do not bind-mount the file rw because both host and container CLIs write to
# it on startup, atomically replacing the inode and corrupting the host view
# (Apr 2026 incident: dozens of .claude.json.corrupted.* backups).
if [ -f /host-claude.json ] && [ ! -f "$HOME/.claude.json" ]; then
  cp /host-claude.json "$HOME/.claude.json"
  chmod 600 "$HOME/.claude.json"
  echo "[claude-auth] Seeded ~/.claude.json from host copy."
fi

if [ -f "$CREDS" ] && command -v node >/dev/null 2>&1; then
  node - <<'JSEOF'
const fs = require('fs');

const credsPath = process.env.HOME + '/.claude/.credentials.json';
let creds;
try { creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch { process.exit(0); }

const oauth = creds?.claudeAiOauth;
if (!oauth?.expiresAt) {
  console.log('[claude-auth] credentials.json has no expiresAt — cannot report token state.');
  process.exit(0);
}

const expiresIn = oauth.expiresAt - Date.now();
const hours = Math.round(expiresIn / 3600000);
if (expiresIn <= 0) {
  console.log(`[claude-auth] WARNING: access token expired ${Math.abs(hours)}h ago.`);
  console.log('[claude-auth] Run on the host to re-sync from Keychain:');
  console.log('[claude-auth]   bash scripts/sync-claude-token.sh && ps stack restart');
  console.log('[claude-auth] (We never refresh from inside the container — refresh-token');
  console.log('[claude-auth]  rotation would invalidate the host Keychain copy.)');
} else {
  console.log(`[claude-auth] Token valid for ${hours}h.`);
}
JSEOF
fi

exec "$@"
