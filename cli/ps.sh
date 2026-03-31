#!/usr/bin/env bash
#
# ps.sh - PowerShop Analytics unified CLI dispatcher
# Invoked by the repo-root stub (ps). Parses command group and delegates to cli/commands/<group>.sh.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMMANDS_DIR="${SCRIPT_DIR}/commands"

RED='\033[0;31m'
NC='\033[0m'

usage() {
    cat <<EOF
Usage: ps <command> [options] [args]

Available commands:
  setup        First-time setup and prerequisites check
  stack        Docker Compose stack management (up/down/status/logs/open/destroy)
  etl          ETL operations (run/status/tables/logs)
  sql          4D SQL operations (schema, query, explore)
  wren         WrenAI knowledge management (push/validate/status)
  config       Show current configuration

Help commands:
  ps help                  Show this help
  ps <command> --help      Show help for a command

Examples:
  ps setup                 First-time setup (create .env, symlink)
  ps setup check           Verify prerequisites
  ps stack up              Start all containers
  ps stack status          Show container status
  ps stack logs [svc]      Tail logs
  ps etl run               Run ETL sync once
  ps sql tables            List all 4D tables
  ps sql query "SELECT ..."  Run a read-only SQL query
  ps sql describe <table>  Show columns for a table
  ps wren push             Push knowledge to WrenAI (merge strategy)
  ps wren validate         Validate SQL pairs against PostgreSQL
  ps wren status           Show knowledge counts
  ps config                Show loaded configuration
EOF
}

GROUP="${1:-}"
if [ -z "$GROUP" ] || [ "$GROUP" = "-h" ] || [ "$GROUP" = "--help" ] || [ "$GROUP" = "help" ]; then
    usage
    exit 0
fi

GROUP_SCRIPT="${COMMANDS_DIR}/${GROUP}.sh"
if [ ! -f "$GROUP_SCRIPT" ]; then
    echo -e "${RED}ps: unknown command '${GROUP}'${NC}" >&2
    echo "" >&2
    usage >&2
    exit 1
fi

shift
export REPO_ROOT

# Load credentials into environment before executing command
# shellcheck source=cli/commands/load-env.sh
source "${COMMANDS_DIR}/load-env.sh"

run_ret=0
"$GROUP_SCRIPT" "$@" || run_ret=$?
exit $run_ret
