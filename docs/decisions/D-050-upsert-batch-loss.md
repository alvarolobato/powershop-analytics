---
id: D-050
title: upsert() must not lose a whole batch to one bad row
date: 2026-08-28
---

# D-050: upsert() must not lose a whole batch to one bad row

*Decided: 2026-08-28*

**Context**: On 2026-08-28 02:52:29 UTC the nightly sync failed with:

```
ERROR: null value in column "reg_lineas" of relation "ps_lineas_ventas" violates not-null constraint
```

The failing `execute_values` batch (`etl/db/postgres.py::upsert()`, called from
`etl/sync/ventas.py::_sync_table()` in `BATCH_SIZE=5_000`-row chunks) contained
one garbage row (`mes = -1801453568`, `precio_neto_si = 'NaN'::numeric`)
followed by roughly 60 entirely-NULL rows. `upsert()` rolled back and
re-raised on any failure, so the **entire 5,000-row batch was discarded**,
not just the ~61 bad rows — every good row in that batch was lost.

Production evidence from `etl_sync_run_tables` (full history; container logs
only reach back to 4 June) shows two live, in-scope failure classes:

| bucket | count | first | last |
|---|---:|---|---|
| not-null violation | 5 | 2026-05-14 | 2026-08-28 |
| FK violation | 19 | 2026-04-18 | 2026-08-15 |

(4D connectivity — 142 occurrences — is an infrastructure problem, out of
scope here. `int(None)`/`NoneType` crashes stopped in April, also out of
scope.)

A precedent for "pre-filter, count, log" already existed in
`etl/sync/stock.py::sync_stock()` (issue #820): rows with a missing PK
component are validated and skipped before `upsert()` is even called, with a
`logger.warning` count at the end of the run. That pattern only logs,
though — it does not reach `etl_sync_run_tables`, so an operator has to go
digging in container logs (which don't even retain history back to the
5-May not-null incident) to find out anything was dropped.

**Decision**:

1. `upsert()` (`etl/db/postgres.py`) pre-filters rows whose primary key is
   `NULL` or `NaN` **before** attempting the insert. A `NULL`/`NaN` PK can
   never satisfy the PK's `NOT NULL` constraint — there is no outcome in
   which inserting it succeeds, so rejecting it in Python is strictly
   cheaper and clearer than letting Postgres reject the whole batch after
   the fact. This directly covers the 2026-08-28 incident: the ~60 NULL
   rows all had `reg_lineas = NULL`.
2. If the batch insert still fails for a reason the pre-filter cannot
   predict (e.g. an FK violation — 19 of them, 2026-04-18 to 2026-08-15),
   `upsert()` falls back to inserting the surviving rows **one at a time
   inside SAVEPOINTs**, so only the row(s) that actually violate a
   constraint are lost — not their batch-mates. Every `SAVEPOINT` is
   `RELEASE`d on both the success path and the failure path (see
   "SAVEPOINT-release correction" below).
3. Every row `upsert()` drops (either layer) is appended to a
   process-global skip log (`postgres.drain_skip_log()`/`_skip_log`) instead
   of being silently discarded. This is safe because the ETL runs as a
   single sequential worker per process (already assumed by
   `try_acquire_run_lock()` / `fail_orphan_running_runs()` in the same
   file) — one table's sync always fully drains the log before the next
   table's sync starts.
4. `etl/main.py::_run_sync()` drains that log after every `sync_fn` call
   (success or failure) and folds the count plus a sample of reasons into
   `etl_sync_run_tables.error_msg` — using the existing per-table status
   row, not a new channel. This applies to every table synced through
   `_run_sync` (all `upsert()` callers), not just `ps_lineas_ventas`: the
   fix lives in `upsert()` itself, the single shared implementation point.
5. `NOT NULL` and FK constraints are **not** weakened or disabled. They are
   doing their job — flagging genuinely bad rows. The fix is about not
   letting a legitimate rejection take down its innocent batch-mates.

**What gets skipped vs what fails the sync**: a row is skipped (counted,
logged, and the table sync still reports `status="ok"` if nothing else
failed) only when Postgres itself would never accept it — NULL/NaN PK, or an
FK/constraint violation confirmed by an actual failed INSERT attempt. Any
other failure (e.g. the 4D connection dying mid-fetch, a genuine PostgreSQL
outage) still fails the whole table sync loudly, exactly as before.

**SAVEPOINT-release correction (2026-08-28, post-review finding 2)**:
`_upsert_rowwise()` issued `ROLLBACK TO SAVEPOINT etl_upsert_row` on a
failed row but never `RELEASE SAVEPOINT etl_upsert_row` on that path (only
the success path released it). `ROLLBACK TO SAVEPOINT` undoes a
savepoint's changes but does not destroy the savepoint — verified live:
savepoints accumulated and were never released. A large fallback batch with
many bad rows would nest thousands of unreleased subtransactions in one
transaction, risking Postgres `pg_subtrans` SLRU pressure on an instance
that also serves the Dashboard App and WrenAI. Fixed by adding
`RELEASE SAVEPOINT etl_upsert_row` on the failure path too, immediately
after the `ROLLBACK TO SAVEPOINT`. Pinned by
`etl/tests/test_upsert_batch_loss.py::TestUpsertRowwiseFallback::test_row_by_row_fallback_releases_savepoint_on_failure_too`,
which counts `SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT`
statements and asserts every savepoint issued is released exactly once.

**Decoding issue flagged, not fixed**: the garbage row's values
(`mes = -1801453568`, a 4D `Long Real`/`mes` field far outside any plausible
month value; `precio_neto_si = NaN`) sitting immediately before ~60
entirely-NULL rows in the same fetch is consistent with a decode/buffer
desync somewhere in the `p4d` driver or `etl/db/fourd.py::safe_fetch()` row
decoding — one row half-decoded into garbage, then the parser losing
alignment and returning NULLs until the next natural row boundary. This is
a `p4d`/4D-driver-level hypothesis that needs live 4D access and much more
investigation to confirm; it is not fixed here (see AGENTS.md's "fix only if
clearly in scope and low risk" — a blind fix here is neither). Tracked for
follow-up rather than guessed at.

**Alternatives rejected**:
- *Changing `upsert()`'s return type to a result object and updating every
  caller's return-value contract* — rejected because several `sync_*`
  functions' plain-`int` return values are asserted directly in
  `etl/tests/test_sync_ventas.py` (real-4D integration tests); breaking that
  contract for no functional gain (the skip-log approach delivers the same
  visibility without it) wasn't worth the blast radius across 8 call sites.
- *Threading a `run_id`/skip-count parameter through every `sync_*`
  function* — rejected for the same reason: `_run_sync()` already owns
  `run_id` and already calls `record_table_sync()` once per table; draining
  a log there is the smallest change that reaches every caller.
- *Disabling or downgrading the NOT NULL / FK constraints* — rejected
  outright; the constraints are correct, the batching behaviour was the bug.

**Rationale**: The batch is an implementation detail of `execute_values()`
for round-trip efficiency; it must not become a unit of data-loss. Silently
dropping rows is its own hazard (this codebase has a recurring problem with
swallowed failures), so every row `upsert()` drops is now counted and
visible in `etl_sync_run_tables.error_msg` — the same place an operator
already looks for sync failures — rather than only in ephemeral container
logs.

**See**: `etl/db/postgres.py::upsert()`, `etl/db/postgres.py::_upsert_rowwise()`,
`etl/db/postgres.py::drain_skip_log()`, `etl/main.py::_run_sync()`,
`etl/sync/ventas.py::_sync_table()`, `etl/tests/test_upsert_batch_loss.py`,
issue #820 (the `sync_stock` precedent this generalizes).
