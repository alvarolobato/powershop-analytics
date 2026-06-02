# Skill: Deploying a release to production

**Use when**: Pushing a released version (or freshly built images) onto the production Mac. For *creating* the release and building the images first, see [release.md](release.md). For the full command reference and cold-start install, see [../deployment/prod-cli.md](../deployment/prod-cli.md) and [../deployment/production.md](../deployment/production.md).

## How prod runs

Production is a flat Docker Hub deployment on a dedicated Mac (`~/powershop/` by default): just `docker-compose.yml`, `.env`, `wren-config.yaml`, `.version`, and `./data/` bind mounts. ETL + Dashboard images are pulled pre-built from Docker Hub; the version is recorded in `.version`. All operations go over SSH via the `ps prod *` CLI from your local Mac (`PROD_HOST` / `PROD_PATH` in `~/.config/powershop-analytics/.env`).

## Before you deploy

1. **Images for the target version are built and pushed** — `release-docker.yml` is green (see [release.md](release.md)). Otherwise `docker compose pull` fetches stale `:latest`.
2. **Prod is reachable** — `ssh "$PROD_HOST" echo ok`. A transient `No route to host` usually means you're off the prod LAN/VPN or the Mac is asleep; retry.
3. **OAuth token is healthy** — `ps prod token-status`. If near expiry, `ps prod login` (the launchd agent syncs the new token within ~5 min). See [D-025](../decisions/D-025-oauth-single-refresher.md).

## Which command

| Situation | Command | What it does |
|-----------|---------|--------------|
| New release (compose/config may have changed) — **the normal case** | `ps prod update` | Resolves the latest **stable** GitHub release, downloads its `docker-compose.prod.yml` + `wren-config.yaml`, writes `.version`, then runs `deploy`. |
| Only new images, same compose/config | `ps prod deploy` | `docker compose pull` + `up -d`, then auto knowledge push. |
| Only `wren-config.yaml` changed | `ps prod push-config` | Uploads config, restarts `wren-ai-service`. |
| Only WrenAI knowledge changed (source MDs) | `ps prod push-knowledge` | Transfers source MDs, re-indexes instructions + SQL pairs. |

After a new release, use **`ps prod update`** — it both refreshes the stack files and pulls the new images. `update` short-circuits with "Already on latest version" when `.version` already matches.

```bash
ps prod update                  # full update to the latest stable release
ps prod update                  # (idempotent — reports "already on latest")
ps prod deploy --skip-knowledge # pull+restart without the knowledge push
```

## Knowledge push is automatic

`ps prod deploy` (and therefore `ps prod update`) waits for `wren-ui` to be healthy and then pushes WrenAI knowledge automatically — no separate step after a deploy. Pass `--skip-knowledge` to suppress it. For a mid-sprint knowledge-only refresh (source MDs changed, no deploy planned), use `ps prod push-knowledge` (add `--dry-run` to preview counts).

## Verify

```bash
ps prod status   # version + container states + token expiry
ps prod health   # curl checks: PostgreSQL, WrenAI UI/AI-service, Dashboard
ps prod version  # just the .version on prod
```

## Gotchas

- **`ps prod update` targets the latest *stable* release.** It uses the GitHub `releases/latest` API (stable only), falling back to the newest pre-release **only if no stable release exists**. To ship a normal deploy, cut a stable release (see [release.md](release.md)) — a beta won't be picked up while any stable exists.
- **Wait for the image build before updating.** `:latest` lags until `release-docker.yml` finishes; updating early writes the new `.version` but pulls old images.
- **Namespace/version pins.** The compose file pulls `${DOCKERHUB_NAMESPACE}/powershop-{etl,dashboard}:${ETL_VERSION:-latest}` / `:${DASHBOARD_VERSION:-latest}`. Prod normally rides `:latest`; pin `ETL_VERSION` / `DASHBOARD_VERSION` in prod's `.env` only to freeze a specific version.
