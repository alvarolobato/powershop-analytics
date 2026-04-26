#!/bin/sh
# Refresh the Claude OAuth access token on container startup using the refresh_token.
# This keeps the container authenticated even when the short-lived access_token expires
# (typically every 7 days). The host only needs to run sync-claude-token.sh when the
# refresh_token itself expires (~90 days) or after re-login.
#
# Issue #419: when refresh fails (e.g. Cloudflare blocks the token endpoint with
# a 403 challenge page) the access token can stay expired and every `claude`
# invocation in the dashboard returns a JSON envelope with `is_error:true`,
# `api_error_status:401` while exiting with code 1 and empty stderr.  We now
# detect that case in lib/llm-provider/cli/process.ts (LLM_CLI_AUTH) and surface
# it in the API response.  In addition, this entrypoint logs a one-line warning
# when the credentials file is already expired at boot so operators can act
# without having to wait for the first user-facing error.

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
const https = require('https');

const credsPath = process.env.HOME + '/.claude/.credentials.json';
let creds;
try { creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch { process.exit(0); }

const oauth = creds?.claudeAiOauth;
if (!oauth?.refreshToken) process.exit(0);

// Only refresh if access token expires within 1 hour
const expiresIn = oauth.expiresAt - Date.now();
if (expiresIn > 60 * 60 * 1000) {
  console.log(`[claude-auth] Token valid for ${Math.round(expiresIn/3600000)}h, skipping refresh.`);
  process.exit(0);
}
if (expiresIn <= 0) {
  // Issue #419: surface the expiry up front so operators can re-auth on the
  // host (the refresh below may still succeed or may be blocked by Cloudflare).
  console.log(`[claude-auth] WARNING: access token already expired ${Math.abs(Math.round(expiresIn/3600000))}h ago.`);
  console.log(`[claude-auth] If refresh below fails, run on the host:`);
  console.log(`[claude-auth]   claude /login   # then ps stack restart`);
}

console.log('[claude-auth] Access token near expiry, refreshing...');

const body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken });
const req = https.request({
  hostname: 'claude.ai',
  path: '/api/auth/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.log(`[claude-auth] Refresh failed (${res.statusCode}): ${data.slice(0,200)}`);
      // Cloudflare anti-bot pages return 403 with HTML; log a clear remediation hint.
      if (res.statusCode === 403 || /<html/i.test(data)) {
        console.log(`[claude-auth] Hint: token endpoint is blocked by Cloudflare/anti-bot. Re-authenticate on the host: \`claude /login\` then \`ps stack restart\`.`);
      }
      return;
    }
    try {
      const r = JSON.parse(data);
      creds.claudeAiOauth.accessToken = r.access_token;
      if (r.expires_in) creds.claudeAiOauth.expiresAt = Date.now() + r.expires_in * 1000;
      if (r.refresh_token) creds.claudeAiOauth.refreshToken = r.refresh_token;
      fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
      console.log(`[claude-auth] Token refreshed successfully.`);
    } catch (e) {
      console.log('[claude-auth] Failed to parse refresh response:', e.message);
    }
  });
});
req.on('error', (e) => console.log('[claude-auth] Refresh request error:', e.message));
req.write(body);
req.end();
JSEOF
fi

exec "$@"
