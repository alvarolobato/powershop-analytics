# Testing Strategy

One-page reference for contributors and agents. Read this before changing any area listed in **Must cover**.

---

## Test Tiers

### Tier A — Pure unit (mocked DB / 4D)
Fast, no external dependencies. All ETL sync logic, all Dashboard lib functions, API route handlers with mocked `query` / `validateReadOnly`.

- **When to run**: every commit, in CI
- **Requirements**: no live DB, no network

### Tier B — Contract tests (SQL shape)
Validate that SQL in SQL pairs and fixtures conforms to expected schema shapes. No live DB required.

- **When to run**: every PR, in CI
- **Requirements**: no live DB

### Tier C — Integration (optional, local only)
Dashboard API routes against a real local Postgres. Documents real behaviour that Tier A/B cannot catch.

- **When to run**: locally before merging risky changes
- **Requirements**: `POSTGRES_DSN` set, local stack running (`ps stack up`)
- **Never run in CI** — requires secrets

---

## Commands

### ETL (Python / pytest)

```bash
# Run all ETL tests (fast, Tier A + B)
docker compose run --rm etl python -m pytest etl/tests/ -x -q

# With coverage report
docker compose run --rm etl python -m pytest --cov=etl --cov-report=term-missing
```

### Dashboard (TypeScript / Vitest)

```bash
# Run all dashboard tests
cd dashboard && npm test

# With coverage report
cd dashboard && npm run test:coverage
```

### Local integration (Tier C)

```bash
# Requires local stack running and POSTGRES_DSN set
cd dashboard && POSTGRES_DSN=postgresql://... npx vitest run
```

---

## Coverage Thresholds

Both stacks track coverage but enforce **no blocking floor** until the first three CI runs establish a baseline. After that, thresholds will be added to the respective config files (`pytest.ini` / `vitest.config.ts`).

Check current coverage trends in the PR summaries — do not add new untested code to the areas listed below.

---

## Must Cover Before Risky Change

If you are changing any of the following, write or update tests **first** (TDD):

| File | Why it matters |
|------|---------------|
| `etl/main.py` | Pipeline orchestration, sync dispatch, error handling — a bug here breaks all nightly loads |
| `etl/sync/ventas.py` | Delta upsert for 911K Ventas + 1.7M LineasVentas — wrong watermark = data loss or duplicates |
| `dashboard/lib/date-params.ts` | Date substitution for every widget SQL — already covered, keep it that way |
| `dashboard/lib/db.ts` | `validateReadOnly` blocks writes; `query` is the single DB gateway — both must stay tested |
| `dashboard/app/api/anomaly-check/route.ts` | Anomaly detection — already covered, do not regress |
| `dashboard/app/api/etl/runs/route.ts` | ETL monitoring handler — surfaced in the dashboard; failure silences alerts |
| `dashboard/app/api/etl/stats/route.ts` | ETL stats handler — same as above |

**Rule of thumb**: if a bug here would break a nightly load or silently corrupt the dashboard, it belongs on this list.

---

## See also

- [docs/skills/testing-patterns.md](skills/testing-patterns.md) — TDD workflow, factory patterns, mocking strategies (Python + TypeScript)
