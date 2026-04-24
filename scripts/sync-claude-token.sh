#!/bin/bash
# Syncs the live Claude OAuth token from macOS Keychain to ~/.claude/.credentials.json
# Run this on the host if the dashboard reports "spawn claude ENOENT" or auth errors.
# The token lasts ~7 days; the container mounts ~/.claude as read-write so it can
# refresh using the refresh_token automatically between host syncs.

set -e

CREDS="$HOME/.claude/.credentials.json"

# Extract from Keychain
TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "ERROR: No 'Claude Code-credentials' entry in macOS Keychain." >&2
  echo "Make sure Claude Code is installed and you're logged in on this Mac." >&2
  exit 1
fi

# Write to credentials file
echo "$TOKEN" > "$CREDS"
chmod 600 "$CREDS"

# Show expiry
python3 -c "
import json, time
d = json.loads(open('$CREDS').read())
exp = d['claudeAiOauth']['expiresAt']
h = (exp - int(time.time()*1000)) // 1000 // 3600
print(f'Token synced. Expires in {h}h ({\"OK\" if h > 0 else \"EXPIRED\"}).')
"
