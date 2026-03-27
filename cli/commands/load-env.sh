#!/bin/bash
# load-env.sh - Load centralized credentials into the environment
# Sourced by ps.sh to ensure all subcommands have access to credentials.

# Helper to load a config file if variables are not already set
load_config() {
    local fileName="$1"
    local repoRoot="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

    # Priority:
    # 1. Environment variables (already set, do nothing)
    # 2. local/fileName (worktree-specific)
    # 3. ~/.config/powershop-analytics/fileName (centralized)

    local foundPath=""
    if [ -f "${repoRoot}/local/${fileName}" ]; then
        foundPath="${repoRoot}/local/${fileName}"
    elif [ -f "${HOME}/.config/powershop-analytics/${fileName}" ]; then
        foundPath="${HOME}/.config/powershop-analytics/${fileName}"
    fi

    if [ -n "$foundPath" ]; then
        # Use python to safely parse the .conf file (handles multiline/quotes)
        # and only print exports for variables NOT already in the environment.
        PYTHON_CODE=$(cat <<'EOF'
import os, re, sys
found_path = sys.argv[1]
if not os.path.exists(found_path): sys.exit(0)
with open(found_path, 'r') as f:
    content = f.read()
# Match KEY=VALUE where VALUE can be single/double quoted and multiline (\x27=', \x22=")
pattern = re.compile(r'^\s*(\w+)\s*=\s*(?P<quote>[\x27\x22])(.*?)(?P=quote)\s*$', re.MULTILINE | re.DOTALL)
for match in pattern.finditer(content):
    key = match.group(1)
    value = match.group(3)
    if key not in os.environ:
        escaped_value = value.replace("'", "'\"'\"'")
        print(f"export {key}='{escaped_value}'")
# Also match simple non-quoted values
simple_pattern = re.compile(r'^\s*(\w+)\s*=\s*([^ \n\x27\x22#][^\n]*?)\s*$', re.MULTILINE)
for match in simple_pattern.finditer(content):
    key = match.group(1)
    value = match.group(2).strip()
    if key not in os.environ:
        escaped_value = value.replace("'", "'\"'\"'")
        print(f"export {key}='{escaped_value}'")
EOF
)
        eval "$(python3 -c "$PYTHON_CODE" "$foundPath")"
    fi
}

# Load credentials
load_config "credentials.conf"
