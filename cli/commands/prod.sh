#!/usr/bin/env bash
# ps prod — Drive the production stack from your local machine.
#
# Configuration (in priority order: env > ~/.config/powershop-analytics/.env > defaults):
#   PROD_HOST   ssh target. Default: alvarolobato@192.168.1.238
#   PROD_PATH   Path on prod where the repo lives. Default: /Users/alvarolobato/powershop
#   PROD_BRANCH Branch to keep prod on. Default: main
#
# Subcommands:
#   bootstrap          One-time conversion of prod's flat directory to a git checkout
#   deploy             git pull on prod + docker compose up -d --build
#   restart [svc]      docker compose restart [<service>]
#   status             docker compose ps + token-state summary
#   logs [svc]         docker compose logs -f --tail 100 [<service>]
#   token-status       Show the prod Claude OAuth expiry (no ssh shell)
#   login              Interactive ssh -t for `claude /login` on prod
#   ssh                Open a shell on prod
set -e

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

PROD_HOST="${PROD_HOST:-alvarolobato@192.168.1.238}"
PROD_PATH="${PROD_PATH:-/Users/alvarolobato/powershop}"
PROD_BRANCH="${PROD_BRANCH:-main}"

CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    cat <<'EOF'
Usage: ps prod <subcommand> [args]

Configuration (set in ~/.config/powershop-analytics/.env or shell env):
  PROD_HOST     ssh target (default: alvarolobato@192.168.1.238)
  PROD_PATH     repo path on prod (default: /Users/alvarolobato/powershop)
  PROD_BRANCH   branch to track (default: main)

Subcommands:
  bootstrap         One-time conversion of prod into a git checkout
  deploy            Pull latest on prod and rebuild/restart the stack
  restart [svc]     Restart all services or a specific one
  status            Show docker compose ps + token-state summary
  logs [svc]        Tail logs (follow); optional service name
  token-status      Show prod Claude OAuth expiry hours
  login             Open interactive ssh and run "claude /login" on prod
  ssh               Open a shell on prod
EOF
}

require_prod_host() {
    if [ -z "$PROD_HOST" ]; then
        echo -e "${RED}ps prod: PROD_HOST is empty. Set it in ~/.config/powershop-analytics/.env or the shell.${NC}" >&2
        exit 2
    fi
}

# Compose command with the prod override file. Single-line so it ships well
# through ssh "..." quoting; the prod override path is relative to PROD_PATH.
prod_compose_cmd() {
    printf 'docker compose -f docker-compose.yml -f prod/docker-compose.override.prod.yml'
}

# Remote runner. We pass the command through `bash -lc` so the user's PATH
# (Homebrew docker, etc.) is set up just like in an interactive login. The
# user's .bash_profile uses tput which writes "No value for $TERM" warnings
# to stderr when ssh is run without a TTY. Filter just those lines so real
# errors still surface; everything else passes through.
remote() {
    require_prod_host
    ssh "$PROD_HOST" "bash -lc $(printf '%q' "$*")" 2> >(grep -v 'tput: No value for \$TERM' >&2)
}

remote_tty() {
    require_prod_host
    ssh -t "$PROD_HOST" "bash -lc $(printf '%q' "$*")"
}

cmd_bootstrap() {
    require_prod_host
    echo -e "${CYAN}Bootstrap on $PROD_HOST → $PROD_PATH${NC}"
    # Copy the bootstrap script in (it may not be on prod yet) and run it.
    local tmp_remote="/tmp/prod-bootstrap-$(date +%s).sh"
    scp "${REPO_ROOT}/scripts/prod-bootstrap.sh" "${PROD_HOST}:${tmp_remote}"
    ssh -t "$PROD_HOST" "bash -lc 'PROD_PATH=$(printf %q "$PROD_PATH") BRANCH=$(printf %q "$PROD_BRANCH") bash $tmp_remote'"
    ssh "$PROD_HOST" "rm -f $tmp_remote"
}

cmd_deploy() {
    echo -e "${CYAN}Deploying to $PROD_HOST → $PROD_PATH (branch $PROD_BRANCH)${NC}"
    remote "cd $(printf %q "$PROD_PATH") && git fetch origin $(printf %q "$PROD_BRANCH") && git checkout $(printf %q "$PROD_BRANCH") && git pull --ff-only origin $(printf %q "$PROD_BRANCH") && $(prod_compose_cmd) up -d --build"
    echo -e "${GREEN}Deploy complete.${NC}"
}

cmd_restart() {
    local svc="${1:-}"
    if [ -n "$svc" ]; then
        echo -e "${CYAN}Restarting $svc on prod...${NC}"
        remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) restart $(printf %q "$svc")"
    else
        echo -e "${CYAN}Restarting full stack on prod...${NC}"
        remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) restart"
    fi
}

cmd_status() {
    echo -e "${CYAN}Services on $PROD_HOST:${NC}"
    remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) ps"
    echo
    cmd_token_status
}

cmd_logs() {
    local svc="${1:-}"
    if [ -n "$svc" ]; then
        remote_tty "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) logs -f --tail 100 $(printf %q "$svc")"
    else
        remote_tty "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) logs -f --tail 100"
    fi
}

cmd_token_status() {
    require_prod_host
    # Read the credentials snapshot file (managed by the launchd agent on prod).
    # We don't touch the Keychain remotely — that's the host claude's job.
    local out
    if ! out=$(remote 'cat $HOME/.claude/.credentials.json 2>/dev/null'); then
        echo -e "${YELLOW}Could not read prod credentials file. Has scripts/install-claude-token-launchd.sh run on prod?${NC}"
        return 0
    fi
    if [ -z "$out" ]; then
        echo -e "${YELLOW}Prod credentials file is empty or missing.${NC}"
        echo "  Run: ps prod login   # to (re)authenticate on prod"
        return 0
    fi
    echo -e "${CYAN}Prod token state:${NC}"
    PROD_CREDS_JSON="$out" python3 -c '
import json, os, time, sys
try:
    d = json.loads(os.environ["PROD_CREDS_JSON"])
    exp = d["claudeAiOauth"]["expiresAt"]
except Exception as e:
    print(f"  parse error: {e}")
    sys.exit(0)
hours = (exp - int(time.time() * 1000)) // 3600000
state = "OK" if hours > 6 else ("WARN: near expiry" if hours > 0 else "EXPIRED")
print(f"  access_token expires in {hours}h ({state})")
'
}

cmd_login() {
    require_prod_host
    echo -e "${CYAN}Opening interactive ssh to run \`claude /login\` on $PROD_HOST.${NC}"
    echo -e "${YELLOW}After /login completes, the next launchd cycle (within 2h) will sync the token.${NC}"
    echo -e "${YELLOW}For an immediate sync run: ssh $PROD_HOST bash $PROD_PATH/scripts/sync-claude-token.sh${NC}"
    echo
    ssh -t "$PROD_HOST" 'bash -lc "claude /login"'
}

cmd_ssh() {
    require_prod_host
    exec ssh -t "$PROD_HOST"
}

SUBCMD="${1:-}"
if [ -z "$SUBCMD" ] || [ "$SUBCMD" = "-h" ] || [ "$SUBCMD" = "--help" ] || [ "$SUBCMD" = "help" ]; then
    usage
    exit 0
fi
shift || true

case "$SUBCMD" in
    bootstrap)     cmd_bootstrap "$@" ;;
    deploy)        cmd_deploy "$@" ;;
    restart)       cmd_restart "$@" ;;
    status)        cmd_status "$@" ;;
    logs)          cmd_logs "$@" ;;
    token-status)  cmd_token_status "$@" ;;
    login)         cmd_login "$@" ;;
    ssh)           cmd_ssh "$@" ;;
    *)
        echo -e "${RED}ps prod: unknown subcommand '$SUBCMD'${NC}" >&2
        echo "" >&2
        usage >&2
        exit 1
        ;;
esac
