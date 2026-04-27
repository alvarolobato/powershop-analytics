#!/bin/bash
# Syncs the live Claude OAuth token from macOS Keychain to ~/.claude/.credentials.json
# Run this on the host whenever the dashboard container reports auth errors.
#
# The container DOES NOT refresh the OAuth token on its own. OAuth refresh-token
# rotation invalidates the previous refresh_token on every successful refresh,
# so if the container refreshed it would invalidate the Keychain copy that the
# host claude CLI relies on — forcing the user to `claude /login` again.
# (Apr 2026 incident: that exact flow logged the user out.)
#
# The Keychain is the single source of truth. The host's claude CLI rotates it
# automatically when needed. The container only ever reads a snapshot of the
# Keychain via this script. When the snapshot's access_token expires, run this
# script again — do NOT rely on container-side refresh.

set -e

CREDS="$HOME/.claude/.credentials.json"

# Extract from Keychain
TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "ERROR: No 'Claude Code-credentials' entry in macOS Keychain." >&2
  echo "Make sure Claude Code is installed and you're logged in on this Mac:" >&2
  echo "  claude /login" >&2
  exit 1
fi

# Write to credentials file
mkdir -p "$(dirname "$CREDS")"
echo "$TOKEN" > "$CREDS"
chmod 600 "$CREDS"

# Show expiry
python3 -c "
import json, time
d = json.loads(open('$CREDS').read())
exp = d['claudeAiOauth']['expiresAt']
h = (exp - int(time.time()*1000)) // 1000 // 3600
print(f'Token synced from Keychain. Access token expires in {h}h ({\"OK\" if h > 0 else \"EXPIRED\"}).')
print('Container will read this file once on startup and never write back to it.')
print('Re-run this script after host re-login or when the token nears expiry.')
"
