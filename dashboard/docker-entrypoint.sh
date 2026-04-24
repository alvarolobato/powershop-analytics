#!/bin/sh
# Refresh the Claude OAuth access token on container startup using the refresh_token.
# This keeps the container authenticated even when the short-lived access_token expires
# (typically every 7 days). The host only needs to run sync-claude-token.sh when the
# refresh_token itself expires (~90 days) or after re-login.

CREDS="$HOME/.claude/.credentials.json"

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
