# Skill: Cutting a release

**Use when**: Creating a new version of the platform (major / minor / patch) and building the Docker images that production will run. For pushing those images onto the prod Mac, see [prod-deploy.md](prod-deploy.md).

## Versioning scheme

Semantic versioning: `vMAJOR.MINOR.PATCH` (e.g. `v0.5.0`). Pre-releases are `vMAJOR.MINOR.PATCH-beta.N`.

| Bump | Spanish | When |
|------|---------|------|
| **major** | número mayor | Breaking platform changes (rare — this is a single-deployment app, so reserve for big shifts). |
| **minor** | número menor | New features or notable changes. Resets patch to `0`. |
| **patch** | dot release | Bug fixes and small changes. |

Versions live as **git tags + GitHub releases**. Production tracks the running version in its `.version` file. Docker images are tagged with the version plus a rolling tag (`:latest` for stable, `:beta` for pre-releases).

## What a release produces

Publishing a GitHub release fires two workflows automatically (via the `release: published` event):

- **`release-docker.yml`** — builds and pushes `alobato/powershop-etl` and `alobato/powershop-dashboard` for `linux/amd64,linux/arm64`. Tags: `:<version>` always, plus `:latest` (stable) or `:beta` (pre-release). Takes ~18 min.
- **`release.yml`** — attaches `docker-compose.prod.yml`, `wren-config.yaml`, and the install scripts as release assets. `ps prod update` downloads these.

## Canonical path — stable release

Create the release with **your own `gh` user token** so the `release: published` event fires:

```bash
# 1. Make sure main is green and synced
git fetch origin && git log --oneline -1 origin/main
gh api repos/alvarolobato/powershop-analytics/actions/workflows/ci.yml/runs?branch=main\&per_page=1 \
  --jq '.workflow_runs[0].conclusion'      # expect: success

# 2. Pick the next version. Latest stable:
git tag --sort=-v:refname | grep -vE '(-beta|-rc)' | head -1     # e.g. v0.4.0
#   minor bump -> v0.5.0 ; patch bump -> v0.4.1 ; major bump -> v1.0.0

# 3. Write release notes (see "Changelog" below), then create the release
gh release create v0.5.0 --target main --title "v0.5.0" --notes-file /tmp/notes.md

# 4. Watch the image build to completion (~18 min)
gh run list --workflow=release-docker.yml --limit 1
gh run watch <run-id> --exit-status
```

When the build is green the images exist on Docker Hub (`:v0.5.0` + `:latest`) and production can be updated — see [prod-deploy.md](prod-deploy.md).

### Why create the release manually

Releases created by `GITHUB_TOKEN` **do not** fire the `release: published` event (GitHub's recursion guard). So a release made by `ai-auto-release.yml` / `release-beta.yml` would *not* trigger `release-docker.yml` on its own — those workflows dispatch the image build explicitly to compensate. Creating the release from your interactive `gh` (a user token) is the simplest path that builds images with no extra step.

## Changelog

`ai-auto-release.yml` contains the canonical changelog recipe. To reproduce it locally, list merged PRs since the last tag and group by label (`enhancement`/`ai-idea` → Features, `bug`/`ai-bug` → Bug Fixes, rest → Other):

```bash
SINCE=$(gh release view "$(git tag --sort=-v:refname | grep -vE '\-beta' | head -1)" \
  --json publishedAt --jq .publishedAt)
gh pr list --state merged --base main --search "merged:>=${SINCE}" \
  --json number,title,labels \
  --jq '.[] | "- \(.title) (#\(.number))"'
```

## Beta / pre-release

`release-beta.yml` cuts `vX.Y.Z-beta.N` nightly (and on demand). It computes the next beta number, creates a prerelease, and **explicitly dispatches** `release-docker.yml` (because of the `GITHUB_TOKEN` guard above). Manual trigger:

```bash
gh workflow run release-beta.yml -f base_version=0.5.0 -f force=true
```

Beta images get `:vX.Y.Z-beta.N` + the rolling `:beta` tag.

## Automated stable release (optional)

`ai-auto-release.yml` runs weekly (Sun 20:00 UTC) and can be dispatched with a bump type. It computes the next version, generates the changelog, gates on CI, and creates the release — but, per the guard above, **does not build images by itself**. If you use it, dispatch the build afterwards:

```bash
gh workflow run ai-auto-release.yml -f version_bump=minor   # creates the release
gh workflow run release-docker.yml -f tag=v0.5.0            # then build the images
```

## Rebuild images for an existing tag

If a build failed or you need to re-push images for an already-published tag:

```bash
gh workflow run release-docker.yml -f tag=v0.5.0
```

## Gotchas

- **Stable `:latest` only updates on stable releases.** A beta build moves `:beta`, not `:latest`. Production's `ps prod update` resolves the latest **stable** release, so cut a stable release when you intend to ship to prod.
- **Don't deploy before the image build is green.** `:latest` still points at the previous version until `release-docker.yml` finishes. Updating prod early pulls stale images while writing the new `.version`.
- **`ai-auto-release.yml` skips when CI on main is not `success`** or there are no commits since the last tag.
