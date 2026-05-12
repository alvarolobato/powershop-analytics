# Production deployment

Production runs on a dedicated Mac, configured via `PROD_HOST` and
`PROD_PATH` in `~/.config/powershop-analytics/.env`. It is a **flat Docker
Hub deployment** — no
git checkout. The directory contains only `docker-compose.yml`, `.env`,
`wren-config.yaml`, `.version`, and the `data/` bind mounts.

ETL and Dashboard images are pre-built and pulled from Docker Hub
(`alvarolobato264/powershop-etl`, `alvarolobato264/powershop-dashboard`).
WrenAI images come from `ghcr.io/canner/*`.

## Initial setup

Production was set up via `deploy/install-prod.sh` which:

1. Created `~/powershop/` with `data/{postgres,qdrant,wren}/` subdirectories.
2. Downloaded `docker-compose.prod.yml` (as `docker-compose.yml`) and
   `wren-config.yaml` from the latest GitHub release.
3. Generated `.env` with credentials and version pins.
4. Wrote `.version` to track the installed release.

## Routine operations (from your local Mac)

All `ps prod` commands run over SSH — no git, no source code needed on prod:

```bash
ps prod deploy           # pull latest Docker Hub images + restart
ps prod update           # download new compose/config from GitHub release + deploy
ps prod status           # containers + version + health checks + token state
ps prod logs dashboard   # tail dashboard logs
ps prod restart          # restart the whole stack
ps prod version          # show prod version
ps prod health           # run health checks against all services
ps prod push-config      # upload local wren-config.yaml to prod
ps prod token-status     # show prod's Claude OAuth expiry
ps prod login            # interactive ssh -t to run `claude /login`
ps prod ssh              # open a shell on prod
```

### Deploy vs Update

- **`ps prod deploy`** — pulls the latest tags of the images already
  referenced in prod's `docker-compose.yml` and restarts. Use this when a new
  image has been pushed to Docker Hub (e.g. after a release builds images).

- **`ps prod update`** — checks the latest GitHub release, downloads a new
  `docker-compose.yml` and `wren-config.yaml` from the release assets, then
  does a deploy. Use this when compose or config file changes are needed (new
  services, version bumps, config changes).

## Release pipeline

1. Code merges to `main`.
2. Nightly `release-beta.yml` creates a prerelease tag (e.g. `v0.1.0-beta.3`).
3. `release-docker.yml` builds multi-arch ETL + Dashboard images and pushes to
   Docker Hub with `:<tag>` and `:beta` tags. Stable releases also get `:latest`.
4. `release.yml` attaches `docker-compose.prod.yml`, `wren-config.yaml`, and
   installer scripts as release assets.
5. Run `ps prod deploy` (images only) or `ps prod update` (full) to apply.

## OAuth token sync

The dashboard's CLI provider uses host `claude` via a credentials snapshot.
On a Mac (local or prod) the launchd agent in
`scripts/launchd/com.powershop.claude-token-sync.plist.template` runs every
2 hours and copies the macOS Keychain entry into
`~/.claude/.credentials.json`. The container reads the file but never writes
it — see `dashboard/docker-entrypoint.sh` and D-025 in
`DECISIONS-AND-CHANGES.md`.

When the access token actually expires (~8 h after issuance) and host
`claude` cannot refresh through Cloudflare, run `ps prod login` from local
to open an interactive ssh session and `claude /login` once. The next
launchd cycle (within 2 h) picks up the fresh token.
