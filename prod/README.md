# Production deployment

Production runs on `alvarolobato@192.168.1.238` (a Mac) under
`/Users/alvarolobato/powershop`. Same OS, same Docker, same compose file as
local dev — just a separate `.env` and the override file in this directory.

## First-time bootstrap

Run on the **prod box** once:

```bash
ssh alvarolobato@192.168.1.238
bash <(curl -fsSL https://raw.githubusercontent.com/alvarolobato/powershop-analytics/main/scripts/prod-bootstrap.sh)
```

Or, equivalently, from your local Mac:

```bash
ps prod bootstrap
```

The bootstrap:

1. Stops any running stack at `/Users/alvarolobato/powershop`.
2. Renames the existing flat directory to `powershop.backup.<timestamp>`.
3. `git clone`s the repo into `/Users/alvarolobato/powershop`.
4. Moves `data/`, `.env`, and `wren-config.yaml` from the backup into the
   fresh checkout.
5. Installs the launchd token-sync agent (see
   `scripts/install-claude-token-launchd.sh`).
6. Prints next steps: `claude /login` (interactive) then `ps stack up`.

After bootstrap, the box is a normal git checkout. Routine updates from local
are one command:

```bash
ps prod deploy           # git pull + compose up -d --build
ps prod logs dashboard   # tail dashboard logs
ps prod status           # services + token-state summary
ps prod restart          # restart the whole stack
ps prod token-status     # show prod's Claude OAuth expiry
ps prod login            # interactive ssh -t to run `claude /login`
ps prod ssh              # open a shell on prod
```

## Why a separate compose file?

The base `docker-compose.yml` is identical between local and prod. The
override in this directory pins production-only knobs that don't belong in
the dev path:

- `restart: always` (vs `unless-stopped` on dev, which respects manual stops)
- JSON-file log rotation (`max-size: 20m`, `max-file: 5`) so the box doesn't
  fill the disk after a few months of uptime.

Add prod-only adjustments here as they appear. Don't fork the base file.

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
