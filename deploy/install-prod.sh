#!/usr/bin/env bash
# PowerShop Analytics — production installer
#
# Installs the stack under /opt/powershop (configurable) using the `beta`
# channel by default. Ports bind to 0.0.0.0 so the host is reachable from
# the LAN; a Cloudflare Tunnel / reverse proxy is expected to gate any
# public exposure.
#
# Usage (run as a user in the `docker` group, or with sudo if the install
# dir is not writable):
#
#   curl -fsSL https://raw.githubusercontent.com/alvarolobato/powershop-analytics/main/deploy/install-prod.sh | bash
#
# Environment overrides:
#   PS_PROD_HOME      — installation directory (default: /opt/powershop)
#   VERSION           — release tag to pin (default: latest prerelease for beta
#                       channel, latest stable release for stable channel)
#   CHANNEL           — 'beta' (default) or 'stable'. Sets ETL_VERSION /
#                       DASHBOARD_VERSION to `beta` or `latest` in .env
#                       (docker-compose.prod.yml prepends the `:` at image-pull time).
#   NONINTERACTIVE    — '1' to skip .env prompts (you must write .env yourself)
#
# The script NEVER writes IPs or credentials into the repo or any committed
# file — all secrets live only on the host in `$PS_PROD_HOME/.env`.

set -euo pipefail

REPO="alvarolobato/powershop-analytics"
PROJECT_DIR="${PS_PROD_HOME:-/opt/powershop}"
RELEASE_BASE="https://github.com/${REPO}/releases/download"
API_BASE="https://api.github.com/repos/${REPO}"
CHANNEL="${CHANNEL:-beta}"

info()    { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m[OK]\033[0m    %s\n' "$*"; }
warn()    { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
die()     { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

# sudo wrapper — only escalates if we can't write the target directory.
maybe_sudo() {
  if [ -w "$(dirname "$PROJECT_DIR")" ] || [ -w "$PROJECT_DIR" ] 2>/dev/null; then
    "$@"
  else
    sudo "$@"
  fi
}

prompt_required() {
  local label="$1" value=""
  while [ -z "$value" ]; do
    read -rp "  ${label}: " value
  done
  printf '%s' "$value"
}

# Silent prompt for secrets — never echoes to the terminal.
prompt_required_secret() {
  local label="$1" value=""
  while [ -z "$value" ]; do
    read -rsp "  ${label}: " value
    printf '\n' >&2
  done
  printf '%s' "$value"
}

prompt_default() {
  local label="$1" default="$2" value=""
  read -rp "  ${label} [${default}]: " value
  printf '%s' "${value:-$default}"
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24
  fi
}

# Single-quote a value for safe inclusion in a dotenv file. Docker Compose's
# env-file parser treats everything after an unquoted `#` as a comment and
# splits on whitespace; single-quoted values are taken literally. The parser
# does NOT support escaping a single quote inside a single-quoted value, so
# reject inputs that contain a single quote (or a newline) rather than write
# a value that would be mis-parsed at runtime.
dotenv_quote() {
  local label="$1" v="$2"
  case "$v" in
    *\'*) die "${label} contains a single quote (') — not supported in .env values. Please pick a different value." ;;
  esac
  case "$v" in
    *$'\n'*) die "${label} contains a newline — not supported in .env values." ;;
  esac
  printf "'%s'" "$v"
}

check_prerequisites() {
  info "Checking prerequisites..."
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "'docker compose' v2 is not available."
  command -v curl >/dev/null 2>&1 || die "curl is required."
  success "Prerequisites OK"
}

resolve_version() {
  if [ -n "${VERSION:-}" ]; then
    echo "$VERSION"
    return
  fi
  local tag=""
  if [ "$CHANNEL" = "beta" ]; then
    # /releases/latest only returns stable releases, and /releases?per_page=1
    # returns the most recent release regardless of prerelease status — which
    # can be a stable tag even when the user asked for beta. Walk the first
    # page of releases and pick the most recent prerelease explicitly.
    tag=$(curl -fsSL "${API_BASE}/releases?per_page=30" \
      | awk '
          BEGIN { RS="},"; }
          /"prerelease"[[:space:]]*:[[:space:]]*true/ {
            if (match($0, /"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
              tag = substr($0, RSTART, RLENGTH)
              sub(/.*"tag_name"[[:space:]]*:[[:space:]]*"/, "", tag)
              sub(/".*/, "", tag)
              print tag
              exit
            }
          }
        ')
  else
    tag=$(curl -fsSL "${API_BASE}/releases/latest" \
      | grep -m1 '"tag_name"' \
      | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  fi
  [ -n "$tag" ] || die "Could not determine latest ${CHANNEL} release. Set VERSION=<tag> to override."
  echo "$tag"
}

download_asset() {
  local version="$1" filename="$2" dest="$3"
  local url="${RELEASE_BASE}/${version}/${filename}"
  info "Downloading ${filename} (${version})..."
  curl -fsSL "$url" -o "$dest" || die "Failed to download ${url}"
}

create_env() {
  local env_file="$1"
  local resolved_version="$2"
  if [ "${NONINTERACTIVE:-0}" = "1" ]; then
    warn "NONINTERACTIVE=1 — skipping .env generation. You MUST write ${env_file} before starting the stack."
    return
  fi

  # When the user pinned a specific VERSION, write that exact tag into .env
  # so the rolling :beta / :latest tag doesn't drift out of sync with the
  # compose file that was downloaded for this release.
  local etl_tag dash_tag
  if [ -n "${VERSION:-}" ]; then
    etl_tag="$resolved_version"; dash_tag="$resolved_version"
  elif [ "$CHANNEL" = "beta" ]; then
    etl_tag="beta"; dash_tag="beta"
  else
    etl_tag="latest"; dash_tag="latest"
  fi

  echo ""
  info "Configuring .env — press Enter to accept defaults."
  echo ""
  local p4d_host p4d_user p4d_password postgres_password openrouter_key pg_pass
  pg_pass=$(random_password)
  p4d_host=$(prompt_required "4D server hostname or IP (LAN)")
  p4d_user=$(prompt_required "4D SQL username")
  p4d_password=$(prompt_required_secret "4D SQL password")
  postgres_password=$(prompt_default "PostgreSQL password" "$pg_pass")
  openrouter_key=$(prompt_required_secret "OpenRouter API key")

  # Host interface binding. Default 0.0.0.0 so the LAN can reach this host;
  # Cloudflare Tunnel handles any public exposure.
  local bind_addr
  bind_addr=$(prompt_default "Bind address for host ports" "0.0.0.0")

  # Quote all user-supplied values before writing them into .env — a '#',
  # space, or other meta-character in a secret would otherwise be mis-parsed
  # by docker-compose (everything after '#' is treated as a comment).
  local p4d_host_q p4d_user_q p4d_password_q postgres_password_q openrouter_key_q bind_addr_q soap_url_q soap_wsdl_q
  p4d_host_q=$(dotenv_quote "P4D_HOST" "$p4d_host")
  p4d_user_q=$(dotenv_quote "P4D_USER" "$p4d_user")
  p4d_password_q=$(dotenv_quote "P4D_PASSWORD" "$p4d_password")
  postgres_password_q=$(dotenv_quote "POSTGRES_PASSWORD" "$postgres_password")
  openrouter_key_q=$(dotenv_quote "OPENROUTER_API_KEY" "$openrouter_key")
  bind_addr_q=$(dotenv_quote "HOST_BIND" "$bind_addr")
  soap_url_q=$(dotenv_quote "SOAP_URL" "http://${p4d_host}:8080/4DSOAP/")
  soap_wsdl_q=$(dotenv_quote "SOAP_WSDL" "http://${p4d_host}:8080/4DSOAP/?wsdl")

  # Write to a secure temp file in the invoking user's space (never the
  # project dir — which may be sudo-owned under /opt). Create with 0600
  # before writing any secret, and clean up on any exit path.
  local tmp_env
  tmp_env=$(mktemp) || die "Failed to create temporary file for ${env_file}"
  chmod 600 "$tmp_env" || { rm -f "$tmp_env"; die "Failed to secure temporary .env file"; }
  trap 'rm -f "$tmp_env"' EXIT

  cat >"$tmp_env" <<EOF
# PowerShop Analytics — production environment
# Generated by install-prod.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Channel: ${CHANNEL}
#
# Do not commit this file. Secrets live only on the host.

# --- Release channel ---
# Images are pulled from Docker Hub using these tags. For beta use 'beta'.
# For stable use 'latest' or pin to a specific tag (e.g. 'v0.1.0').
ETL_VERSION=${etl_tag}
DASHBOARD_VERSION=${dash_tag}

# --- Docker Hub namespace ---
# DOCKERHUB_NAMESPACE=alvarolobato264

# --- 4D source database ---
P4D_HOST=${p4d_host_q}
P4D_PORT=19812
P4D_USER=${p4d_user_q}
P4D_PASSWORD=${p4d_password_q}
SOAP_URL=${soap_url_q}
SOAP_WSDL=${soap_wsdl_q}

# --- PostgreSQL mirror ---
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${postgres_password_q}
POSTGRES_DB=powershop

# --- ETL scheduler ---
ETL_CRON_HOUR=2

# --- WrenAI / LLM ---
OPENROUTER_API_KEY=${openrouter_key_q}
WREN_LLM_MODEL=openrouter/anthropic/claude-sonnet-4-20250514

# --- Host port bindings ---
# 0.0.0.0 exposes on every interface (LAN-reachable). Use 127.0.0.1 to restrict
# to loopback and rely entirely on Cloudflare Tunnel / reverse proxy.
HOST_BIND=${bind_addr_q}
HOST_PORT=3000
DASHBOARD_PORT=4000
AI_SERVICE_FORWARD_PORT=5555

# --- WrenAI service versions (upstream, change on explicit upgrade) ---
WREN_BOOTSTRAP_VERSION=0.1.5
WREN_ENGINE_VERSION=0.22.0
IBIS_SERVER_VERSION=0.22.0
WREN_AI_SERVICE_VERSION=0.29.0
WREN_UI_VERSION=0.32.2
WREN_PRODUCT_VERSION=0.29.1
WREN_ENGINE_PORT=8080
WREN_ENGINE_SQL_PORT=7432
IBIS_SERVER_PORT=8000
WREN_AI_SERVICE_PORT=5555
PLATFORM=linux/amd64
TELEMETRY_ENABLED=true
EOF

  maybe_sudo install -m 0600 "$tmp_env" "$env_file"
  rm -f "$tmp_env"
  trap - EXIT
  success ".env written with 0600 permissions"
}

main() {
  echo ""
  echo "=================================================="
  echo "  PowerShop Analytics — production installer"
  echo "  Channel: ${CHANNEL}"
  echo "  Project dir: ${PROJECT_DIR}"
  echo "=================================================="
  echo ""

  check_prerequisites

  local version
  version=$(resolve_version)
  info "Installing version: ${version}"

  maybe_sudo mkdir -p \
    "${PROJECT_DIR}" \
    "${PROJECT_DIR}/data/postgres" \
    "${PROJECT_DIR}/data/qdrant" \
    "${PROJECT_DIR}/data/wren"

  # Make the project dir tree writable by the invoking user so subsequent
  # `docker compose` commands don't need sudo. This includes data subdirs,
  # which containers will re-own on first start.
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    maybe_sudo chown -R "${SUDO_USER}:${SUDO_USER}" "${PROJECT_DIR}" 2>/dev/null || true
  fi
  success "Directories ready: ${PROJECT_DIR}"

  local compose="${PROJECT_DIR}/docker-compose.yml"
  local wren_cfg="${PROJECT_DIR}/wren-config.yaml"
  local tmp_compose tmp_wren
  tmp_compose=$(mktemp) && download_asset "$version" "docker-compose.prod.yml" "$tmp_compose"
  tmp_wren=$(mktemp)    && download_asset "$version" "wren-config.yaml"        "$tmp_wren"
  maybe_sudo install -m 0644 "$tmp_compose" "$compose"
  maybe_sudo install -m 0644 "$tmp_wren"    "$wren_cfg"
  rm -f "$tmp_compose" "$tmp_wren"
  success "Stack files installed"

  local env_file="${PROJECT_DIR}/.env"
  if [ -f "$env_file" ]; then
    warn ".env already exists — leaving it alone. Delete it to reconfigure."
  else
    create_env "$env_file" "$version"
  fi

  # Record installed version
  echo "$version" | maybe_sudo tee "${PROJECT_DIR}/.version" >/dev/null

  echo ""
  echo "=================================================="
  success "Installation complete."
  echo
  echo "  Next steps (from ${PROJECT_DIR}):"
  echo "    cd ${PROJECT_DIR}"
  echo "    docker compose pull    # fetch the ${CHANNEL} images"
  echo "    docker compose up -d"
  echo
  echo "  Reachable on the LAN once up:"
  echo "    WrenAI UI     http://<host-ip>:\${HOST_PORT:-3000}"
  echo "    Dashboard     http://<host-ip>:\${DASHBOARD_PORT:-4000}"
  echo "    PostgreSQL    <host-ip>:5432"
  echo
  echo "  Update to the latest ${CHANNEL} build:"
  echo "    cd ${PROJECT_DIR} && docker compose pull && docker compose up -d"
  echo "=================================================="
}

main "$@"
