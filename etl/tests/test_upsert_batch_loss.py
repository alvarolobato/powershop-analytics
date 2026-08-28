"""Tests for etl/db/postgres.py::upsert() batch-loss protection (D-050).

Context: on 2026-08-28 02:52:29 UTC the nightly sync failed with
'null value in column "reg_lineas" of relation "ps_lineas_ventas" violates
not-null constraint'. The failing execute_values() batch held one garbage
row plus ~60 entirely-NULL rows; because upsert() rolled back and re-raised
on any failure, the whole 5,000-row batch was lost, not just the bad rows.

Two layers now bound the blast radius (see upsert()'s docstring for the
full incident writeup):
  1. Pre-filter — rows whose PK is NULL/NaN are dropped before the insert
     is attempted (a NULL/NaN PK can never satisfy the PK's NOT NULL
     constraint, so there is no world in which keeping it helps).
  2. Row-by-row fallback via SAVEPOINTs — if the batch still fails for an
     unpredictable reason (e.g. an FK violation), the surviving rows are
     retried one at a time so only the offending row(s) are lost. Every
     SAVEPOINT is RELEASEd on both the success and failure path so a batch
     full of bad rows cannot leave thousands of unreleased subtransactions
     open.

Both layers record what they drop in the module-level skip log
(postgres.drain_skip_log()) instead of discarding it silently — the log is
what etl.main._run_sync folds into etl_sync_run_tables.error_msg.

Pure unit tests (_invalid_pk_reason, drain_skip_log) need no DB. The
batch-loss tests use the real pg_conn fixture (skipped automatically when
PostgreSQL is not configured, same convention as the rest of etl/tests/).
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from etl.db import postgres

# ---------------------------------------------------------------------------
# Pure unit tests — no DB required
# ---------------------------------------------------------------------------


class TestInvalidPkReason:
    def test_none_pk_is_invalid(self):
        row = {"reg_lineas": None, "mes": 3}
        reason = postgres._invalid_pk_reason(row, ["reg_lineas"])
        assert reason is not None
        assert "NULL" in reason
        assert "reg_lineas" in reason

    def test_nan_decimal_pk_is_invalid(self):
        row = {"reg_lineas": Decimal("NaN"), "mes": 3}
        reason = postgres._invalid_pk_reason(row, ["reg_lineas"])
        assert reason is not None
        assert "NaN" in reason

    def test_nan_float_pk_is_invalid(self):
        row = {"reg_lineas": float("nan"), "mes": 3}
        reason = postgres._invalid_pk_reason(row, ["reg_lineas"])
        assert reason is not None
        assert "NaN" in reason

    def test_valid_pk_is_none(self):
        row = {"reg_lineas": Decimal("123.99"), "mes": 3}
        assert postgres._invalid_pk_reason(row, ["reg_lineas"]) is None

    def test_composite_pk_any_null_column_is_invalid(self):
        row = {"codigo": "A1", "tienda_codigo": None, "talla": "M"}
        reason = postgres._invalid_pk_reason(row, ["codigo", "tienda_codigo", "talla"])
        assert reason is not None
        assert "tienda_codigo" in reason

    def test_composite_pk_all_present_is_valid(self):
        row = {"codigo": "A1", "tienda_codigo": "01", "talla": "M"}
        assert (
            postgres._invalid_pk_reason(row, ["codigo", "tienda_codigo", "talla"])
            is None
        )


class TestDrainSkipLog:
    def test_drain_returns_and_clears(self):
        postgres.drain_skip_log()  # start from a clean slate
        postgres._skip_log.append("test message 1")
        postgres._skip_log.append("test message 2")
        msgs = postgres.drain_skip_log()
        assert msgs == ["test message 1", "test message 2"]
        # Second drain is empty — the log was cleared, not copied.
        assert postgres.drain_skip_log() == []

    def test_drain_empty_log_returns_empty_list(self):
        postgres.drain_skip_log()
        assert postgres.drain_skip_log() == []


# ---------------------------------------------------------------------------
# Integration tests — real PostgreSQL (pg_conn fixture, skipped if unavailable)
# ---------------------------------------------------------------------------

_SCRATCH_TABLE = "test_upsert_d050_child"
_SCRATCH_PARENT = "test_upsert_d050_parent"


class _SavepointCountingCursor:
    """Wraps a real psycopg2 cursor and counts SAVEPOINT/RELEASE/ROLLBACK TO
    statements — used to pin the D-050 finding-2 fix (a savepoint rolled
    back on the failure path must also be released, or savepoints
    accumulate unreleased for the rest of the transaction)."""

    def __init__(self, real_cursor, counts: dict):
        self._cursor = real_cursor
        self._counts = counts

    def __enter__(self):
        self._cursor.__enter__()
        return self

    def __exit__(self, *exc_info):
        return self._cursor.__exit__(*exc_info)

    def execute(self, sql, params=None):
        text = sql.strip().upper()
        if text.startswith("RELEASE SAVEPOINT"):
            self._counts["release"] += 1
        elif text.startswith("ROLLBACK TO SAVEPOINT"):
            self._counts["rollback_to"] += 1
        elif text.startswith("SAVEPOINT"):
            self._counts["savepoint"] += 1
        if params is None:
            return self._cursor.execute(sql)
        return self._cursor.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _SavepointCountingConn:
    """Duck-types just enough of a psycopg2 connection for _upsert_rowwise
    (cursor()/commit()/rollback()) while counting SAVEPOINT statements
    issued through it."""

    def __init__(self, real_conn):
        self._conn = real_conn
        self.counts = {"savepoint": 0, "release": 0, "rollback_to": 0}

    def cursor(self):
        return _SavepointCountingCursor(self._conn.cursor(), self.counts)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()


def _drop_scratch_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {_SCRATCH_TABLE}")
        cur.execute(f"DROP TABLE IF EXISTS {_SCRATCH_PARENT}")
    conn.commit()


def _create_simple_scratch_table(conn) -> None:
    """A standalone table with a NOT NULL PK — no FK — for the pre-filter tests."""
    _drop_scratch_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE {_SCRATCH_TABLE} (
                reg_lineas NUMERIC PRIMARY KEY,
                mes INTEGER,
                precio_neto_si NUMERIC
            )
            """
        )
    conn.commit()


def _create_parent_child_scratch_tables(conn) -> None:
    """Parent + child with an FK — for the row-by-row fallback test.

    Mirrors the class of failure behind the 19 FK-violation entries in
    etl_sync_run_tables (2026-04-18 .. 2026-08-15): a batch fails on a row
    referencing a parent that does not exist, and the pre-filter (which
    only checks the row's OWN pk) cannot predict that in advance.
    """
    _drop_scratch_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE {_SCRATCH_PARENT} (
                num_ventas NUMERIC PRIMARY KEY
            )
            """
        )
        cur.execute(
            f"""
            CREATE TABLE {_SCRATCH_TABLE} (
                reg_lineas NUMERIC PRIMARY KEY,
                num_ventas NUMERIC NOT NULL
                    REFERENCES {_SCRATCH_PARENT}(num_ventas),
                mes INTEGER
            )
            """
        )
    conn.commit()


@pytest.fixture
def scratch_conn(pg_conn):
    """pg_conn with the scratch tables cleaned up before and after the test."""
    postgres.drain_skip_log()  # isolate from any other test's leftovers
    yield pg_conn
    _drop_scratch_tables(pg_conn)
    postgres.drain_skip_log()


class TestUpsertPreFilter:
    """One garbage/NULL-PK row must not cost the batch's good rows (Layer 1)."""

    def test_batch_with_one_null_pk_row_persists_good_rows(self, scratch_conn):
        _create_simple_scratch_table(scratch_conn)

        good_rows = [
            {
                "reg_lineas": Decimal(f"{i}.99"),
                "mes": i,
                "precio_neto_si": Decimal("10.00"),
            }
            for i in range(1, 6)
        ]
        # The incident row: NULL PK, plus the kind of garbage seen alongside
        # it in the 2026-08-28 batch (huge bogus mes, NaN price) — none of
        # that matters once the PK itself is NULL; the row can never insert.
        bad_row = {
            "reg_lineas": None,
            "mes": -1801453568,
            "precio_neto_si": Decimal("NaN"),
        }
        batch = good_rows + [bad_row]

        attempted = postgres.upsert(
            scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"]
        )

        assert attempted == 5, "the 5 good rows should be attempted/inserted"

        with scratch_conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {_SCRATCH_TABLE}")
            (count,) = cur.fetchone()
        assert count == 5, "the 5 good rows must actually be in the database"

    def test_skip_is_recorded_not_silent(self, scratch_conn):
        _create_simple_scratch_table(scratch_conn)

        batch = [
            {"reg_lineas": Decimal("1.99"), "mes": 1, "precio_neto_si": Decimal(5)},
            {"reg_lineas": None, "mes": -1801453568, "precio_neto_si": Decimal("NaN")},
        ]

        postgres.upsert(scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"])

        skipped = postgres.drain_skip_log()
        assert len(skipped) == 1, "the dropped row must be recorded, not silently lost"
        assert "reg_lineas" in skipped[0]
        assert "NULL" in skipped[0]

    def test_batch_of_all_null_pk_rows_returns_zero_and_records_all(self, scratch_conn):
        """Mirrors the ~60 entirely-NULL rows observed in the same incident batch."""
        _create_simple_scratch_table(scratch_conn)

        batch = [{"reg_lineas": None, "mes": None, "precio_neto_si": None}] * 5

        attempted = postgres.upsert(
            scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"]
        )

        assert attempted == 0
        with scratch_conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {_SCRATCH_TABLE}")
            (count,) = cur.fetchone()
        assert count == 0
        assert len(postgres.drain_skip_log()) == 5

    def test_nan_decimal_pk_is_prefiltered_and_good_rows_survive(self, scratch_conn):
        _create_simple_scratch_table(scratch_conn)

        batch = [
            {"reg_lineas": Decimal("2.99"), "mes": 2, "precio_neto_si": Decimal(1)},
            {"reg_lineas": Decimal("NaN"), "mes": 3, "precio_neto_si": Decimal(2)},
        ]

        attempted = postgres.upsert(
            scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"]
        )

        assert attempted == 1
        skipped = postgres.drain_skip_log()
        assert len(skipped) == 1
        assert "NaN" in skipped[0]


class TestUpsertRowwiseFallback:
    """An unpredictable per-row failure (FK violation) must fall back to
    row-by-row insertion instead of losing the whole batch (Layer 2)."""

    def test_fk_violation_falls_back_and_persists_good_rows(self, scratch_conn):
        _create_parent_child_scratch_tables(scratch_conn)
        with scratch_conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {_SCRATCH_PARENT} (num_ventas) VALUES (%s), (%s)",
                (Decimal(1), Decimal(2)),
            )
        scratch_conn.commit()

        good_rows = [
            {"reg_lineas": Decimal("10.99"), "num_ventas": Decimal(1), "mes": 1},
            {"reg_lineas": Decimal("11.99"), "num_ventas": Decimal(2), "mes": 1},
        ]
        # References a parent that does not exist — the pre-filter cannot
        # catch this (reg_lineas itself is a perfectly valid, non-NULL PK);
        # only the DB's FK constraint will reject it.
        fk_violation_row = {
            "reg_lineas": Decimal("12.99"),
            "num_ventas": Decimal(999),
            "mes": 1,
        }
        batch = good_rows + [fk_violation_row]

        attempted = postgres.upsert(
            scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"]
        )

        assert attempted == 2, "both good rows should survive the FK-violating sibling"

        with scratch_conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {_SCRATCH_TABLE}")
            (count,) = cur.fetchone()
        assert count == 2

        skipped = postgres.drain_skip_log()
        assert len(skipped) == 1
        assert "12.99" in skipped[0] or "reg_lineas" in skipped[0]

    def test_all_rows_fk_violate_returns_zero_but_records_each(self, scratch_conn):
        _create_parent_child_scratch_tables(scratch_conn)
        # No parents inserted — every child row violates the FK.
        batch = [
            {"reg_lineas": Decimal("20.99"), "num_ventas": Decimal(500), "mes": 1},
            {"reg_lineas": Decimal("21.99"), "num_ventas": Decimal(501), "mes": 1},
        ]

        attempted = postgres.upsert(
            scratch_conn, _SCRATCH_TABLE, batch, pk_cols=["reg_lineas"]
        )

        assert attempted == 0
        skipped = postgres.drain_skip_log()
        assert len(skipped) == 2

        # The connection must still be usable afterwards (no aborted
        # transaction left behind by the SAVEPOINT fallback).
        with scratch_conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone() == (1,)

    def test_row_by_row_fallback_releases_savepoint_on_failure_too(self, scratch_conn):
        """D-050 finding 2: ROLLBACK TO SAVEPOINT does not destroy the
        savepoint — without an explicit RELEASE on the failure path too, a
        large fallback batch full of bad rows nests thousands of unreleased
        subtransactions in one transaction (pg_subtrans SLRU pressure risk
        on an instance shared with the Dashboard App and WrenAI). Every
        SAVEPOINT issued must be matched by exactly one RELEASE, whether the
        row succeeded or failed.
        """
        _create_parent_child_scratch_tables(scratch_conn)
        with scratch_conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {_SCRATCH_PARENT} (num_ventas) VALUES (%s)",
                (Decimal(1),),
            )
        scratch_conn.commit()

        # Two rows that succeed, two that FK-violate — exercises both the
        # success-path RELEASE and the failure-path RELEASE.
        rows = [
            {"reg_lineas": Decimal("60.99"), "num_ventas": Decimal(1), "mes": 1},
            {"reg_lineas": Decimal("61.99"), "num_ventas": Decimal(900), "mes": 1},
            {"reg_lineas": Decimal("62.99"), "num_ventas": Decimal(1), "mes": 1},
            {"reg_lineas": Decimal("63.99"), "num_ventas": Decimal(901), "mes": 1},
        ]
        columns = ["reg_lineas", "num_ventas", "mes"]
        row_stmt = (
            f"INSERT INTO {_SCRATCH_TABLE} (reg_lineas, num_ventas, mes) "
            "VALUES (%s, %s, %s) ON CONFLICT (reg_lineas) DO UPDATE SET "
            "num_ventas = EXCLUDED.num_ventas, mes = EXCLUDED.mes"
        )

        counting_conn = _SavepointCountingConn(scratch_conn)
        inserted = postgres._upsert_rowwise(
            counting_conn, _SCRATCH_TABLE, row_stmt, columns, rows, ["reg_lineas"]
        )

        assert inserted == 2
        counts = counting_conn.counts
        assert counts["savepoint"] == 4, "one SAVEPOINT per row"
        assert counts["rollback_to"] == 2, "only the 2 failing rows roll back"
        assert counts["release"] == 4, (
            "every savepoint must be released — including the 2 that were "
            "first rolled back — or savepoints accumulate unreleased for "
            "the rest of the transaction"
        )
        postgres.drain_skip_log()
