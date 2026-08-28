---
id: D-051
title: safe_fetch() guards against transient p4d row-decode corruption
date: 2026-08-28
---

# D-051: safe_fetch() guards against transient p4d row-decode corruption

*Decided: 2026-08-28*

**Context**: The 2026-08-28 02:52:29 UTC incident (see
[D-050](D-050-upsert-batch-loss.md)) fetched one garbage `LineasVentas` row
(`mes = -1801453568`, `precio_neto_si = NaN`) immediately followed by ~60
entirely-NULL rows, all inside a single `safe_fetch()` result. D-050 stopped
that from taking a whole `upsert()` batch down with it, but it acts one
layer downstream — after the corrupted rows have already been fetched. Two
follow-up findings, from reading the installed `p4d` driver source
(`p4d/p4d.py`, verified directly against the version pinned in
`etl/requirements-dev.txt`), motivate closing the gap one layer earlier:

1. **A short/truncated row is structurally impossible** at the Python
   boundary. `p4d.Cursor.fetchone()` builds each row with
   `for col in range(numcols): ... row.append(...)` — exactly one value
   appended per column, every time (one exception: the `VK_REAL` branch is
   missing an `else`, see below, but that *raises*, it does not produce a
   short row). The ~60 NULL rows in the incident arrived as **full-arity
   tuples of `None`**, not truncated tuples. This means an arity check
   inside `safe_fetch()` is a free tripwire — it should never fire — not
   the actual instrument that catches this class of corruption.
2. **p4d pages results 100 rows at a time**
   (`p4d.Cursor.pagesize = 100`, `fourd_exec_statement(query, pagesize)`),
   re-fetching pages over the socket mid-resultset. A transient network
   hiccup during a mid-result page fetch plausibly desyncs the C parser
   *within that page* — half-parsing one row into garbage typed values,
   failing field parses (null flags) for the rest of the page, then
   resyncing cleanly at the next page boundary. One garbage row + ~60 NULL
   rows ≈ the tail of one 100-row page. This yields a falsifiable
   prediction: **the anomalous run should be confined to one aligned
   100-row window and end at an index ≡ 99 (mod 100)**.

Re-fetching the same source range from live 4D after the incident returned
clean data, and a 43,430-row bulk fetch of the same table showed no
anomalies at all — consistent with transient corruption, not poisoned
source data.

Why this matters beyond the raw incident count: [D-050](D-050-upsert-batch-loss.md)'s
pre-filter only catches a `NULL`/`NaN` **primary key**. A misaligned decode
can just as plausibly produce a **plausible-looking finite** PK for a row
whose other fields are still garbage. Such a row sails through D-050's
filter and gets upserted as a **phantom row under a bogus key** —
permanent, invisible, silently poisoning analytics. It is also outside the
watermark's self-healing window: `etl.main._run_sync` advances the
watermark even when a sync ultimately fails, and delta fetches only look
back 1 day (`lookback_days`), so a corrupted row older than that window is
never naturally re-fetched by a later run.

**Decision**:

1. `etl/db/fourd.py::safe_fetch()` scans every fetch (`scan_rows_for_anomalies()`)
   for rows that look like decode corruption rather than real data: a
   **multi-column** row where every value is `None` (`"all_null"`), the
   caller-supplied PK column being `None` (`"null_pk"`, opt-in via
   `guard_pk=...`), or any `float` value being NaN or ±Inf
   (`"non_finite_float"`). This scan always runs — it's a handful of Python
   comparisons per row, not a query. `"all_null"` is deliberately restricted
   to rows with more than one column: a single-column result whose one
   value is `None` is indistinguishable from an ordinary legitimate NULL
   (a nullable lookup, `SELECT MAX(...)` on an empty set, etc.) — the
   incident pattern is specifically about a *multi-column* row collapsing
   to NULL across the board. (Caught in review: the naive one-line reading
   of the spec broke the pre-existing `test_none_values_preserved` unit
   test, which fetches a single `None` value from a one-column table — a
   real, if narrow, false-positive the unrestricted rule would have
   introduced for any future single-column nullable `safe_fetch()` caller.)
2. When the scan finds nothing (the overwhelming majority of fetches),
   `safe_fetch()` is a zero-cost pass-through — no extra round-trip, no
   log entry.
3. When it finds anomalies, the evidence is recorded **before** the
   anomalous result is discarded, then the *exact same query* is
   re-executed exactly once, to discriminate transient corruption from
   real source data:
   - refetch comes back clean → `"clean_after_refetch"`: trust the
     refetch, return it wholesale — the original was noise.
   - refetch still has anomalies → `"persisted_source_data"`: this is
     real. `"non_finite_float"` rows are kept (downstream NOT NULL / other
     constraints get to judge them, same as any other real row); `"all_null"`
     / `"null_pk"` rows are dropped — there is no legitimate insert they
     could ever become.
   - the refetch itself raises → the pending evidence is still flushed
     (`"refetch_failed"`), and the exception propagates unchanged (a dead
     4D connection is a real failure, not something this guard should mask).
4. `etl/db/fourd.py::dict(zip(...))` (the dict-building step) now uses
   `zip(..., strict=True)`, raising a `RuntimeError` with the SQL, expected
   vs. actual arity, absolute row index, and a truncated `repr()` of the row
   on mismatch. Per finding 1 above, this is a tripwire that should never
   fire — if it ever does, something p4d-internal is worse than the
   row-*content* corruption this guard is built to catch, and failing
   loudly with full detail beats silently zip-truncating.
5. Evidence is transported the same way [D-050](D-050-upsert-batch-loss.md)'s
   skip log is: a module-level list (`fourd._anomaly_log`, drained by
   `fourd.drain_anomaly_log()`) plus a `logger.warning` at detection time.
   Same single-sequential-worker safety argument as D-050. `etl.main._run_sync`
   drains it after every `sync_fn` call and persists one row per event into
   the new `etl_fetch_anomalies` table (`etl/db/postgres.py::insert_fetch_anomalies()`,
   best-effort — its own try/except + rollback, and a second defensive
   try/except at the call site — never fails the sync), and folds a
   one-line summary into `etl_sync_run_tables.error_msg`, capped at 2000
   chars same as D-050's note. **This is a separate channel from D-050's
   skip log**: rows the guard drops never reach `upsert()` in the first
   place (they are filtered out inside `safe_fetch()`, before the
   `sync_fn`'s return value is even built), so there is nothing for the two
   logs to double-report.
6. Table status stays `"ok"` when the refetch comes back clean — the data
   ultimately synced is correct; the note in `error_msg` is informational,
   not a failure signal.
7. Wired at exactly one call site for this change:
   `etl/sync/ventas.py::_sync_table()` now passes `guard_pk=pk_col_4d.lower()`
   (repurposing the previously-unused `pk_col_4d` parameter — it used to be
   documented as "kept for API compat" after an earlier ORDER BY removal).
   Every other `safe_fetch()` caller gets the always-on all-NULL /
   non-finite-float checks for free, with no signature change, and no
   `guard_pk`. `etl/sync/stock.py` is explicitly **not** wired — sanctioned
   as a follow-up, not part of this change (it has its own PK/skip pattern
   from issue #820 predating D-050).

**A genuine upstream driver bug, flagged not fixed**: while confirming
finding 2, the `VK_REAL`/`VK_FLOAT` branch in `p4d.Cursor.fetchone()` was
found to be missing an `else`:
```python
elif fieldtype == self.lib4d_sql.VK_REAL or fieldtype == self.lib4d_sql.VK_FLOAT:
    if output == b'':
        row.append(None)  #Empty output=null
    row.append(float(output))
```
An empty `Real` field appends `None` **and then unconditionally falls
through** to `float(output)` — `float(b'')` raises `ValueError`, crashing
`fetchone()` mid-row. This is plausibly some fraction of the 25 "other" ETL
failure bucket referenced in D-050's incident review. Per AGENTS.md
("fix only if clearly in scope and low risk" — patching a vendored,
pip-installed third-party driver is neither), **this is not patched,
vendored, or forked here**. It is documented in
`docs/skills/data-access.md` so the next investigation of an "other" ETL
failure knows where to look.

**Alternatives rejected**:
- *Business-plausibility validation* (e.g. `mes` range checks, price bounds)
  — rejected: heuristics like this rot as the business changes, and the
  refetch is a strictly better discriminator — it asks the actual source of
  truth, not a guessed rule, whether the data is real.
- *A retry loop around `upsert()`* — rejected; this guard operates at the
  fetch layer, before rows are even mapped for Postgres. Retrying the
  Postgres write would not address a bad value that decoded wrong at the
  4D/p4d boundary.
- *Patching/vendoring the p4d driver to fix the arity/VK_REAL issues
  directly* — rejected; out of scope and higher risk than a guard at the
  boundary we already own (`safe_fetch()`).
- *A literal "reproduces at the exact same index with the exact same value"
  check for `persisted_source_data`* — simplified to "the refetch's own
  anomaly scan is non-empty" instead. The spec's row-count-drift allowance
  ("row-count drift between fetches is fine") already concedes that
  positions are not guaranteed stable across two fetches, so a strict
  positional/value identity check would be more fragile than it's worth;
  the drop/keep action taken downstream (drop `all_null`/`null_pk`, keep
  `non_finite_float`) is identical either way, so the extra precision would
  not change behaviour, only the wording of `refetch_outcome`.

**Rationale**: A refetch is a strictly stronger discriminator than any
heuristic — it asks the actual system of record, not a guessed rule,
whether the data is real. The two extra queries this can cost (the
detection scan is free; the refetch only runs when something is actually
wrong) are cheap against silently poisoning a table with a phantom row that
outlives the 1-day delta lookback window.

**See**: `etl/db/fourd.py::safe_fetch()`, `scan_rows_for_anomalies()`,
`drain_anomaly_log()`; `etl/db/postgres.py::insert_fetch_anomalies()`;
`etl/main.py::_run_sync()`; `etl/sync/ventas.py::_sync_table()`;
`etl/schema/init.sql` (`etl_fetch_anomalies`);
`etl/tests/test_fetch_anomaly_guard.py`; `docs/skills/data-access.md`;
[D-050](D-050-upsert-batch-loss.md) (the downstream layer this complements).
