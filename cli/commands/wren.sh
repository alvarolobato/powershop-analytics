#!/usr/bin/env bash
#
# Sólo queda `validate`. WrenAI se retiró de producción el 2026-08-30 (el
# dashboard hace el mismo trabajo y sus seis contenedores costaban 1,2 GB en
# una máquina que estaba matando al ETL por falta de memoria), así que `push`,
# `status` y `crosscheck` -- que hablaban con wren-ui y qdrant -- ya no tienen
# con quién hablar.
#
# `validate` sí se queda: ejecuta los pares SQL contra PostgreSQL y no depende
# de WrenAI para nada. Es la comprobación que evita que un par mal escrito
# llegue al bundle del modelo.
# ps wren — WrenAI knowledge management
set -e

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WREN_SCRIPT="${REPO_ROOT}/scripts/wren-push-metadata.py"
PYTHON="${REPO_ROOT}/.venv/bin/python3"
if [ ! -f "$PYTHON" ]; then
    PYTHON="python3"
fi

RED='\033[0;31m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

WREN_URL="${WREN_URL:-http://localhost:3000}"

usage() {
    cat <<EOF
Usage: ps wren <subcommand> [args]

Subcommands:
  push            Push all source knowledge (instructions + SQL pairs) to WrenAI
                  Source entries (is_default=1) are replaced; user entries are preserved.
  validate        Validate all SQL pairs by executing against PostgreSQL mirror.
                  Prints first result for each pair — lets you spot magnitude errors.
                  Requires POSTGRES_DSN env var (or uses default localhost).
  crosscheck      Run cross-validation: compare same metric from different data paths.
                  Detects JOIN errors, filter gaps, ETL sync issues.
                  Requires POSTGRES_DSN env var (or uses default localhost).
  status          Show current knowledge counts (instructions and SQL pairs)

Options:
  --url URL       WrenAI UI URL (default: http://localhost:3000)

Examples:
  ps wren push                     Push all knowledge to WrenAI
  ps wren push --url http://host:3000
  ps wren validate                 Execute all SQL pairs, show first result
  ps wren crosscheck               Compare metric pairs across tables
  ps wren status                   Show counts

Notes:
  - 'push' uses a merge strategy: source knowledge is refreshed on each run.
    User-created knowledge via the WrenAI UI is preserved.
  - SQL pairs are tracked by question text. Source pairs with matching questions
    are replaced; user pairs with different questions survive.
  - Instructions use the is_default SQLite flag: source=1 (replaced), user=0 (kept).
EOF
}

cmd_validate() {
    local dsn="${POSTGRES_DSN:-postgresql://postgres:change_me@localhost:5432/powershop}"
    echo -e "${CYAN}Validating SQL pairs against PostgreSQL...${NC}"
    echo -e "${YELLOW}DSN: ${dsn}${NC}"
    POSTGRES_DSN="$dsn" "$PYTHON" "$WREN_SCRIPT" --validate
}

SUBCMD="${1:-}"
if [ -z "$SUBCMD" ] || [ "$SUBCMD" = "-h" ] || [ "$SUBCMD" = "--help" ]; then
    usage
    exit 0
fi
shift

# Handle --url option
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --url)
            WREN_URL="$2"
            shift 2
            ;;
        *)
            break
            ;;
    esac
done

case "$SUBCMD" in
    validate)   cmd_validate ;;
    *)
        echo -e "${RED}ps wren: unknown subcommand '${SUBCMD}'${NC}" >&2
        usage >&2
        exit 1
        ;;
esac
