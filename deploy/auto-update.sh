#!/usr/bin/env bash
# auto-update.sh — Automated Docker image update for production
# Run via cron: 0 4 * * * /path/to/auto-update.sh >> /var/log/powershop-update.log 2>&1

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
LOG_PREFIX="[powershop-update]"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} $*"; }

# Change to project directory
cd "$(dirname "$0")/.."

log "Checking for image updates..."

# Pull latest images
PULL_OUTPUT=$(docker compose -f "$COMPOSE_FILE" pull 2>&1)

# Check if any images were updated
if echo "$PULL_OUTPUT" | grep -q "Downloaded newer image"; then
    log "New images found. Updating services..."

    # Restart services
    docker compose -f "$COMPOSE_FILE" up -d

    # Wait for health checks
    log "Waiting for services to be healthy..."
    sleep 30

    # Health checks
    HEALTHY=true

    # Check PostgreSQL
    if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -q 2>/dev/null; then
        log "ERROR: PostgreSQL is not ready"
        HEALTHY=false
    fi

    # Check WrenAI (check if port 3000 responds)
    if ! curl -sf http://localhost:3000 > /dev/null 2>&1; then
        log "WARNING: WrenAI UI may not be ready yet (can take a few minutes)"
    fi

    # Check Dashboard
    if ! curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
        log "WARNING: Dashboard App may not be ready yet"
    fi

    if [ "$HEALTHY" = true ]; then
        log "Update completed successfully."
    else
        log "WARNING: Some services may not be fully healthy. Check logs."
    fi

    # Clean up old images
    docker image prune -f > /dev/null 2>&1 || true
else
    log "All images are up to date. No update needed."
fi
