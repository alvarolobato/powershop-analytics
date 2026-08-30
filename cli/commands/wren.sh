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
# ps wren — validacion de los pares SQL contra el espejo PostgreSQL
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

usage() {
    cat <<EOF
Usage: ps wren validate

Ejecuta cada par SQL de docs/dashboard/sql-pairs.md contra el espejo
PostgreSQL y muestra la primera fila de cada uno, para que un error de
magnitud (un total que sale x1000, un ranking vacio) se vea a simple vista.

Los pares alimentan el bundle de conocimiento del dashboard, asi que esto
sigue siendo util aunque WrenAI se retirara: es lo que evita que un par mal
escrito llegue al modelo.

Requiere POSTGRES_DSN (si no, usa localhost:5432/powershop).

Ejemplo:
  POSTGRES_DSN=postgresql://user:pass@host:5432/powershop ps wren validate

Nota: 'push', 'status' y 'crosscheck' se retiraron con WrenAI el 2026-08-30
(D-058). Hablaban con wren-ui y qdrant, que ya no existen.
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

case "$SUBCMD" in
    validate)   cmd_validate ;;
    *)
        echo -e "${RED}ps wren: unknown subcommand '${SUBCMD}'${NC}" >&2
        usage >&2
        exit 1
        ;;
esac
