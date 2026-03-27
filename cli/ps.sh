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
  sql          4D SQL operations (schema, query, explore)
  soap         SOAP web service operations
  config       Show current configuration

Help commands:
  ps help                  Show this help
  ps <command> --help      Show help for a command

Examples:
  ps sql schema            Discover database schema
  ps sql query "SELECT ..."  Run a read-only SQL query
  ps sql tables            List all tables with row counts
  ps sql describe <table>  Show columns for a table
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
