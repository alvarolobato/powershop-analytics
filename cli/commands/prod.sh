#!/usr/bin/env bash
# ps prod — Drive the production stack from your local machine.
#
# Production uses a flat Docker Hub deployment (no git checkout).
# The compose file pulls pre-built images from Docker Hub.
#
# Configuration (in priority order: env > ~/.config/powershop-analytics/.env > defaults):
#   PROD_HOST   ssh target (e.g. user@host). No default — must be set in .env.
#   PROD_PATH   Deployment directory on prod. No default — must be set in .env.
#
# Subcommands:
#   deploy             Pull latest Docker Hub images and restart the stack
#   update             Full update: download new compose/config from latest release + deploy
#   restart [svc]      docker compose restart [<service>]
#   status             docker compose ps + version + health checks + token state
#   logs [svc]         docker compose logs -f --tail 100 [<service>]
#   version            Show the version running on prod
#   health             Run health checks against prod services
#   token-status       Show the prod Claude OAuth expiry (no ssh shell)
#   login              Interactive ssh -t for `claude /login` on prod
#   ssh                Open a shell on prod
set -e

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

PROD_HOST="${PROD_HOST:-}"
PROD_PATH="${PROD_PATH:-}"

GITHUB_REPO="alvarolobato/powershop-analytics"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}"
GITHUB_RELEASE_DL="https://github.com/${GITHUB_REPO}/releases/download"

CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
NC='\033[0m'

usage() {
    cat <<'EOF'
Usage: ps prod <subcommand> [args]

Configuration (set in ~/.config/powershop-analytics/.env or shell env):
  PROD_HOST     ssh target (e.g. user@host; required — set in .env)
  PROD_PATH     deployment dir on prod (required — set in .env)

Stack operations:
  deploy                Pull latest Docker Hub images and restart the stack
  update            Full update: new compose/config from latest GitHub release + deploy
  restart [svc]     Restart all services or a specific one
  status            Container status + version + health checks + token state
  logs [svc]        Tail logs (follow); optional service name
  version           Show prod version (.version file)
  health            Run health checks against all prod services

Maintenance:
    [--dry-run]           Print knowledge counts without pushing; still transfers files
  token-status          Show prod Claude OAuth expiry hours
  login                 Open interactive ssh and run "claude /login" on prod
  ssh                   Open a shell on prod
EOF
}

require_prod_host() {
    if [ -z "$PROD_HOST" ]; then
        echo -e "${RED}ps prod: PROD_HOST is not set. Add it to ~/.config/powershop-analytics/.env${NC}" >&2
        echo -e "${RED}  Example: PROD_HOST=user@192.168.1.100${NC}" >&2
        exit 2
    fi
    if [ -z "$PROD_PATH" ]; then
        echo -e "${RED}ps prod: PROD_PATH is not set. Add it to ~/.config/powershop-analytics/.env${NC}" >&2
        echo -e "${RED}  Example: PROD_PATH=/home/user/powershop${NC}" >&2
        exit 2
    fi
}

# Compose command for the flat prod deployment (single compose file).
prod_compose_cmd() {
    printf 'docker compose'
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

# ---------------------------------------------------------------------------
# deploy — pull latest images from Docker Hub and restart
# ---------------------------------------------------------------------------
cmd_deploy() {
    local skip_knowledge=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --skip-knowledge) skip_knowledge=true; shift ;;
            *) echo -e "${RED}ps prod deploy: unknown option '$1'${NC}" >&2; exit 1 ;;
        esac
    done

    echo -e "${CYAN}Deploying to $PROD_HOST → $PROD_PATH${NC}"
    echo -e "${DIM}Pulling latest Docker Hub images...${NC}"
    remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) pull"
    echo -e "${DIM}Restarting stack...${NC}"
    # --remove-orphans: al retirar WrenAI (D-058) el compose perdió seis
    # servicios, y sin esta bandera sus contenedores quedan en el proyecto como
    # huérfanos -- parados pero presentes, y `docker compose` avisando en cada
    # operación. Prod corre un único proyecto en su directorio, así que lo que
    # borra es exactamente lo que ya no está declarado.
    remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) up -d --remove-orphans"
    echo -e "${GREEN}Deploy complete.${NC}"

    # WrenAI se retiró de producción (2026-08-30): el dashboard hace el mismo
    # trabajo y sus seis contenedores costaban 1,2 GB en una máquina de 16 GB
    # que estaba matando al ETL por falta de memoria. El conocimiento que
    # consumía este paso vive ahora sólo en `dashboard/lib/knowledge.ts`, que
    # viaja dentro de la imagen del dashboard: no hay nada que empujar.
    if [ "$skip_knowledge" = false ]; then
        echo -e "${DIM}Knowledge push omitido: WrenAI ya no forma parte del stack.${NC}"
    fi

    echo
    echo -e "${GREEN}All done.${NC} Run 'ps prod health' to verify."
}

# ---------------------------------------------------------------------------
# update — download new compose/config files from latest GitHub release, then deploy
# ---------------------------------------------------------------------------
cmd_update() {
    echo -e "${CYAN}Checking for updates...${NC}"

    # Determine current version on prod
    local current=""
    current=$(remote "cat $(printf %q "$PROD_PATH")/.version 2>/dev/null" || true)

    # Resolve latest release from GitHub API
    local latest=""
    latest=$(curl -fsSL "${GITHUB_API}/releases/latest" 2>/dev/null \
        | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')

    if [ -z "$latest" ]; then
        # Fall back to latest pre-release (beta channel)
        latest=$(curl -fsSL "${GITHUB_API}/releases" 2>/dev/null \
            | python3 -c 'import json,sys; releases=json.load(sys.stdin); print(next((r["tag_name"] for r in releases), ""))' 2>/dev/null || true)
    fi

    if [ -z "$latest" ]; then
        echo -e "${RED}Could not determine latest release from GitHub.${NC}" >&2
        exit 1
    fi

    if [ "$latest" = "$current" ]; then
        echo -e "${GREEN}Already on latest version: ${latest}${NC}"
        echo -e "${DIM}To force a re-pull of images, run: ps prod deploy${NC}"
        return 0
    fi

    echo -e "${CYAN}Updating from ${current:-unknown} to ${latest}...${NC}"

    # Download updated compose and config files to prod
    echo -e "${DIM}Downloading stack files from release ${latest}...${NC}"
    remote "cd $(printf %q "$PROD_PATH") && \
        curl -fsSL '${GITHUB_RELEASE_DL}/${latest}/docker-compose.prod.yml' -o docker-compose.yml && \
        mkdir -p otel/local && \
        curl -fsSL '${GITHUB_RELEASE_DL}/${latest}/otelcol-config.yaml' -o otel/otelcol-config.yaml"

    # Las etiquetas de imagen NO salen de .version: el compose lee
    # ${ETL_VERSION} y ${DASHBOARD_VERSION} de .env. Escribir solo .version
    # dejaba corriendo la imagen anterior mientras el comando anunciaba la
    # nueva -- un despliegue que decia "Deploy complete" sin desplegar nada.
    # Pasó de verdad con v0.10.0: .version decia v0.10.0 y los contenedores
    # llevaban cuatro horas en v0.9.2.
    echo -e "${DIM}Pinning image tags to ${latest} in .env...${NC}"
    remote "cd $(printf %q "$PROD_PATH") && \
        cp .env .env.bak.\$(date +%Y%m%d%H%M%S) && \
        for v in ETL_VERSION DASHBOARD_VERSION; do \
            if grep -q \"^\${v}=\" .env; then \
                sed -i '' \"s|^\${v}=.*|\${v}=${latest}|\" .env; \
            else \
                printf '%s=%s\\n' \"\${v}\" '${latest}' >> .env; \
            fi; \
        done && \
        echo '${latest}' > .version"

    # Comprobar que ha quedado escrito antes de seguir.
    local escritas
    local latest_re
    latest_re=$(printf '%s' "$latest" | sed 's/[.[\*^$()+?{|]/\\&/g')
    escritas=$(remote "cd $(printf %q "$PROD_PATH") && grep -cE '^(ETL|DASHBOARD)_VERSION=${latest_re}\$' .env" || echo 0)
    if [ "${escritas:-0}" -ne 2 ]; then
        echo -e "${RED}No se pudieron fijar ETL_VERSION y DASHBOARD_VERSION a ${latest} en .env${NC}" >&2
        echo -e "${DIM}El compose seguiría levantando la imagen anterior. Abortando antes de tocar los contenedores.${NC}" >&2
        exit 1
    fi

    echo -e "${GREEN}Stack files updated to ${latest}.${NC}"

    # Now deploy (pull images + restart)
    cmd_deploy

    # Y verificar contra los contenedores, no contra .version: es la unica
    # comprobacion que distingue un despliegue real de uno que solo lo dice.
    verificar_imagenes_en_ejecucion "$latest"
}

# ---------------------------------------------------------------------------
# verificar_imagenes_en_ejecucion — el despliegue no vale si los contenedores
# siguen en la etiqueta anterior. Comprueba lo que corre, no lo que se pidio.
# ---------------------------------------------------------------------------
verificar_imagenes_en_ejecucion() {
    local esperada="$1"
    # Los puntos de una version (v0.10.0) son comodines en una regex, asi que
    # se escapan: si no, v0y10z0 tambien casaria.
    local esperada_re
    esperada_re=$(printf '%s' "$esperada" | sed 's/[.[\*^$()+?{|]/\\&/g')

    local lineas
    lineas=$(remote "docker ps --filter name=powershop --format '{{.Names}} {{.Image}}' | grep -E 'powershop-(etl|dashboard)-' || true")

    # Comprobar PRESENCIA antes que etiqueta. Sin esto, un despliegue que deja
    # los contenedores muertos da la lista vacia, no hay ninguno "malo" y la
    # verificacion pasaria -- justo el agujero que este comando venia a tapar.
    local svc
    for svc in etl dashboard; do
        if ! printf '%s\n' "$lineas" | grep -q "powershop-${svc}-"; then
            echo -e "${RED}El contenedor de ${svc} no esta corriendo tras el despliegue.${NC}" >&2
            echo -e "${DIM}Contenedores vistos:${NC}" >&2
            printf '%s\n' "${lineas:-(ninguno)}" >&2
            exit 1
        fi
    done

    local malas
    malas=$(printf '%s\n' "$lineas" | grep -vE ":${esperada_re}\$" || true)
    if [ -n "$malas" ]; then
        echo -e "${RED}Los contenedores NO corren ${esperada}:${NC}" >&2
        printf '%s\n' "$malas" >&2
        exit 1
    fi
    echo -e "${GREEN}Verificado: etl y dashboard corren ${esperada}.${NC}"
}


# ---------------------------------------------------------------------------
# restart
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# status — containers + version + health + token
# ---------------------------------------------------------------------------
cmd_status() {
    echo -e "${CYAN}Production: $PROD_HOST → $PROD_PATH${NC}"
    echo

    # Version
    local version
    version=$(remote "cat $(printf %q "$PROD_PATH")/.version 2>/dev/null" || echo "unknown")
    echo -e "  Version: ${GREEN}${version}${NC}"
    echo

    # Container status
    echo -e "${CYAN}Services:${NC}"
    remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) ps"
    echo

    # OTel Collector health (only when the service is in this compose stack)
    if remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) config --services 2>/dev/null | grep -q '^otel-collector$'"; then
        echo -e "${CYAN}OTel Collector:${NC}"
        if remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) exec -T otel-collector curl -fsSL --max-time 5 http://localhost:13133/ >/dev/null 2>&1"; then
            echo -e "  Status: ${GREEN}healthy${NC}"
        else
            echo -e "  Status: ${YELLOW}not responding${NC}"
        fi
        echo
    fi

    cmd_token_status
}

# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------
cmd_logs() {
    local svc="${1:-}"
    if [ -n "$svc" ]; then
        remote_tty "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) logs -f --tail 100 $(printf %q "$svc")"
    else
        remote_tty "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) logs -f --tail 100"
    fi
}

# ---------------------------------------------------------------------------
# version
# ---------------------------------------------------------------------------
cmd_version() {
    local version
    version=$(remote "cat $(printf %q "$PROD_PATH")/.version 2>/dev/null" || echo "unknown")
    echo "prod: ${version}"
}

# ---------------------------------------------------------------------------
# health — check all prod services
# ---------------------------------------------------------------------------
cmd_health() {
    require_prod_host
    echo -e "${CYAN}Running health checks on $PROD_HOST...${NC}"
    echo

    local all_ok=true
    local prod_ip
    prod_ip=$(echo "$PROD_HOST" | sed 's/.*@//')

    # PostgreSQL — check via docker exec on prod
    printf "  %-20s" "PostgreSQL:"
    if remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) exec -T postgres pg_isready -q" 2>/dev/null; then
        echo -e "${GREEN}healthy${NC}"
    else
        echo -e "${RED}unreachable${NC}"
        all_ok=false
    fi

    # WrenAI UI — curl from prod localhost
    printf "  %-20s" "WrenAI UI:"
    if remote "curl -fsSL --max-time 5 http://localhost:3000 >/dev/null 2>&1"; then
        echo -e "${GREEN}healthy${NC}"
    else
        echo -e "${YELLOW}not responding (may still be starting)${NC}"
        all_ok=false
    fi

    # WrenAI AI Service
    printf "  %-20s" "WrenAI AI Service:"
    if remote "curl -fsSL --max-time 5 http://localhost:5555 >/dev/null 2>&1"; then
        echo -e "${GREEN}healthy${NC}"
    else
        echo -e "${YELLOW}not responding${NC}"
        all_ok=false
    fi

    # Dashboard
    printf "  %-20s" "Dashboard:"
    if remote "curl -fsSL --max-time 5 http://localhost:4000/api/health >/dev/null 2>&1"; then
        echo -e "${GREEN}healthy${NC}"
    else
        echo -e "${YELLOW}not responding${NC}"
        all_ok=false
    fi

    # OTel Collector — health_check extension (exec into container; skipped if
    # not present in this compose stack, e.g. prod before the collector is added)
    if remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) config --services 2>/dev/null | grep -q '^otel-collector$'"; then
        printf "  %-20s" "OTel Collector:"
        if remote "cd $(printf %q "$PROD_PATH") && $(prod_compose_cmd) exec -T otel-collector curl -fsSL --max-time 5 http://localhost:13133/ >/dev/null 2>&1"; then
            echo -e "${GREEN}healthy${NC}"
        else
            echo -e "${YELLOW}not responding${NC}"
            all_ok=false
        fi
    fi

    echo
    if [ "$all_ok" = true ]; then
        echo -e "${GREEN}All services healthy.${NC}"
    else
        echo -e "${YELLOW}Some services are not healthy. Run 'ps prod logs' for details.${NC}"
    fi
}

# ---------------------------------------------------------------------------
# token-status
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# login / ssh
# ---------------------------------------------------------------------------
cmd_login() {
    require_prod_host
    echo -e "${CYAN}Opening interactive ssh to run \`claude /login\` on $PROD_HOST.${NC}"
    echo -e "${YELLOW}After /login completes, the next launchd cycle (within 2h) will sync the token.${NC}"
    echo
    ssh -t "$PROD_HOST" 'bash -lc "claude /login"'
}

cmd_ssh() {
    require_prod_host
    exec ssh -t "$PROD_HOST"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
SUBCMD="${1:-}"
if [ -z "$SUBCMD" ] || [ "$SUBCMD" = "-h" ] || [ "$SUBCMD" = "--help" ] || [ "$SUBCMD" = "help" ]; then
    usage
    exit 0
fi
shift || true

case "$SUBCMD" in
    deploy)        cmd_deploy "$@" ;;
    update)        cmd_update "$@" ;;
    restart)       cmd_restart "$@" ;;
    status)        cmd_status "$@" ;;
    logs)          cmd_logs "$@" ;;
    version)       cmd_version "$@" ;;
    health)        cmd_health "$@" ;;
    token-status)    cmd_token_status "$@" ;;
    login)         cmd_login "$@" ;;
    ssh)           cmd_ssh "$@" ;;
    *)
        echo -e "${RED}ps prod: unknown subcommand '$SUBCMD'${NC}" >&2
        echo "" >&2
        usage >&2
        exit 1
        ;;
esac
