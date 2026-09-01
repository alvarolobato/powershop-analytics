"""Tests for etl/db/fourd.py's fetch-anomaly guard (D-051).

Context: on 2026-08-28 02:52:29 UTC a LineasVentas fetch returned one
garbage row (mes=-1801453568, precio_neto_si=NaN) immediately followed by
~60 entirely-NULL rows, all inside a single safe_fetch() result. Re-fetching
the same source range from live 4D returned clean data — this is transient
corruption (plausibly a p4d row-decode desync at a 100-row page boundary,
p4d.Cursor.pagesize=100), not poisoned source data. D-050 (see
test_upsert_batch_loss.py) stopped that from taking a whole upsert() batch
down; this guard catches it one layer upstream, at the 4D fetch itself, so a
corrupted-but-plausible-looking PK never reaches upsert() as a phantom row.

The guard has three jobs, tested here:
  1. scan_rows_for_anomalies() — detect all-NULL rows, a NULL PK column, and
     non-finite floats (NaN/Inf), without false-positiving on legitimate
     NULLs in non-PK columns of otherwise-normal rows.
  2. safe_fetch()'s refetch discriminator — re-execute the exact same query
     once when anomalies are found, and treat a clean refetch as proof the
     original was transient noise, or a reproducing refetch as proof it is
     real source data (in which case all_null/null_pk rows are dropped but
     non_finite_float rows are kept for downstream constraints to judge).
  3. The arity tripwire — zip(..., strict=True) guards against a row with
     the wrong number of values, which per etl/db/fourd.py's module
     docstring should never actually happen (p4d's fetchone() always
     appends exactly one value per column) — this pins that it fails loudly
     with useful detail if it ever does.

Pure unit tests use stub cursor/connection objects (no real 4D or Postgres
connection). The etl.main._run_sync integration test uses the real pg_conn
fixture (skipped automatically when PostgreSQL is not configured, same
convention as the rest of etl/tests/).
"""

from __future__ import annotations

import math
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from etl.db import fourd, postgres
from etl.db.fourd import (
    Anomaly,
    _build_evidence,
    _compress_index_ranges,
    drain_anomaly_log,
    safe_fetch,
    scan_rows_for_anomalies,
)

# ---------------------------------------------------------------------------
# Stub helpers — a queue of pre-configured fetches, one popped per
# conn.cursor() call. Lets a single stub connection stand in for both the
# original fetch and the refetch, with different (or identical) results.
# ---------------------------------------------------------------------------


class _QueuedCursor:
    def __init__(self, description: list[tuple], rows: list[tuple]) -> None:
        self.description = description
        self._rows = rows
        # p4d expone en `rowcount` el total que declara el servidor al EXECUTE,
        # y `_fetch_raw` lo compara con lo que llega para detectar una lectura
        # truncada (el driver la entrega como si fuera completa). Estos dobles
        # representan lecturas INTEGRAS, asi que declaran justo lo que sirven.
        # Un doble que declarase otra cosa estaria simulando una truncacion, y
        # eso se prueba aparte en test_lectura_truncada.py.
        self.rowcount = len(rows)

    def execute(self, sql: str) -> None:
        self.executed_sql = sql

    def fetchall(self) -> list[tuple]:
        return list(self._rows)

    def close(self) -> None:
        pass


class _RaisingCursor:
    def __init__(self, exc: Exception) -> None:
        self._exc = exc
        self.description = None

    def execute(self, sql: str) -> None:
        raise self._exc

    def close(self) -> None:
        pass


class _QueuedConn:
    """Connection stub returning one queued cursor per .cursor() call.

    Each queued item is either (description, rows) for a normal fetch, or
    an Exception instance to make that cursor raise on execute() (simulates
    a refetch that itself fails).
    """

    def __init__(self, fetches: list) -> None:
        self._fetches = list(fetches)
        self.cursor_calls = 0

    def cursor(self):
        self.cursor_calls += 1
        if not self._fetches:
            raise AssertionError(
                "safe_fetch called conn.cursor() more times than the test queued"
            )
        item = self._fetches.pop(0)
        if isinstance(item, Exception):
            return _RaisingCursor(item)
        description, rows = item
        return _QueuedCursor(description, rows)


def _desc(*names: str) -> list[tuple]:
    return [(name,) for name in names]


@pytest.fixture(autouse=True)
def _clean_anomaly_log():
    """Isolate every test in this module from any other test's leftovers."""
    drain_anomaly_log()
    yield
    drain_anomaly_log()


# ---------------------------------------------------------------------------
# scan_rows_for_anomalies — pure unit tests
# ---------------------------------------------------------------------------


class TestScanRowsForAnomalies:
    def test_all_null_row_detected(self):
        columns = ["reg_lineas", "mes", "precio_neto_si"]
        rows = [(1, 3, 10.0), (None, None, None)]
        anomalies = scan_rows_for_anomalies(columns, rows, "reg_lineas")
        assert len(anomalies) == 1
        assert anomalies[0] == Anomaly(
            index=1, kind="all_null", row_repr=repr((None, None, None))
        )

    def test_null_pk_detected_when_row_not_fully_null(self):
        columns = ["reg_lineas", "mes"]
        rows = [(1, 3), (None, 3)]
        anomalies = scan_rows_for_anomalies(columns, rows, "reg_lineas")
        assert len(anomalies) == 1
        assert anomalies[0].index == 1
        assert anomalies[0].kind == "null_pk"

    def test_nan_and_inf_detected(self):
        columns = ["pk", "note", "amount"]
        rows = [
            (2, "x", float("nan")),
            (3, "y", float("inf")),
            (4, "z", float("-inf")),
        ]
        anomalies = scan_rows_for_anomalies(columns, rows, "pk")
        assert [a.index for a in anomalies] == [0, 1, 2]
        assert all(a.kind == "non_finite_float" for a in anomalies)

    def test_legitimate_none_in_non_pk_column_is_not_anomalous(self):
        """A row with a real PK, some data, and a NULL in an unrelated
        column (e.g. an optional field) must NOT be flagged — only rows
        that look like decode corruption should trip the guard."""
        columns = ["pk", "note", "amount"]
        rows = [(1, None, 10.0)]
        assert scan_rows_for_anomalies(columns, rows, "pk") == []

    def test_no_guard_pk_still_catches_all_null_and_non_finite(self):
        columns = ["a", "b"]
        rows = [(None, None), (1, float("nan")), (2, 3)]
        anomalies = scan_rows_for_anomalies(columns, rows, None)
        assert [a.index for a in anomalies] == [0, 1]
        assert anomalies[0].kind == "all_null"
        assert anomalies[1].kind == "non_finite_float"

    def test_all_null_takes_priority_over_null_pk(self):
        columns = ["pk", "b"]
        rows = [(None, None)]
        anomalies = scan_rows_for_anomalies(columns, rows, "pk")
        assert len(anomalies) == 1
        assert anomalies[0].kind == "all_null"

    def test_unknown_guard_pk_column_raises(self):
        with pytest.raises(ValueError, match="not among the fetched columns"):
            scan_rows_for_anomalies(["a", "b"], [(1, 2)], "does_not_exist")

    def test_clean_rows_return_empty_list(self):
        columns = ["a", "b"]
        rows = [(1, "x"), (2, "y"), (3, None)]
        assert scan_rows_for_anomalies(columns, rows, "a") == []


# ---------------------------------------------------------------------------
# _compress_index_ranges / _build_evidence — pure unit tests
# ---------------------------------------------------------------------------


class TestCompressIndexRanges:
    def test_empty(self):
        assert _compress_index_ranges([]) == ""

    def test_single_index(self):
        assert _compress_index_ranges([5]) == "5"

    def test_contiguous_run(self):
        assert _compress_index_ranges([1, 2, 3]) == "1-3"

    def test_mixed_singles_and_runs(self):
        assert _compress_index_ranges([1, 2, 3, 7, 9, 10]) == "1-3,7,9-10"


class TestBuildEvidenceIndexRangeAndPageFields:
    def test_run_ending_at_18799_is_page_aligned(self):
        """Mirrors the incident shape: a run confined to one 100-row-aligned
        p4d page, ending at an index ≡ 99 (mod 100) — the falsifiable
        prediction the page-desync hypothesis makes (see fourd.py's
        safe_fetch docstring and docs/skills/data-access.md)."""
        anomalies = [
            Anomaly(index=i, kind="all_null", row_repr="(None, None)")
            for i in range(18700, 18800)
        ]
        rows = [(i,) for i in range(18800)]  # last_index + 1 == len(rows)

        evidence = _build_evidence("SELECT * FROM LineasVentas", rows, anomalies)

        assert evidence["first_index"] == 18700
        assert evidence["last_index"] == 18799
        assert evidence["index_ranges"] == "18700-18799"
        assert evidence["run_start_mod_100"] == 0
        assert evidence["run_end_mod_100"] == 99
        assert evidence["page_aligned_end"] is True
        # `page_size` registra el tamano REAL con el que se leyo, que es
        # configurable (`P4D_PAGE_SIZE`, hoy 5000). Los campos `*_mod_100`
        # siguen razonando sobre 100 a proposito: viven asi en
        # `etl_fetch_anomalies` con historico, y atarlos al valor configurable
        # los volveria incomparables entre pasadas.
        from etl.db.fourd import _P4D_FETCH_PAGE_SIZE

        assert evidence["page_size"] == _P4D_FETCH_PAGE_SIZE
        assert evidence["anomaly_count"] == 100
        assert evidence["kinds"] == {"all_null": 100}
        # last_index + 1 == len(rows): no "first good row after" sample.
        assert all(s["label"] != "first_good_row_after_run" for s in evidence["sample"])

    def test_non_page_aligned_run(self):
        anomalies = [Anomaly(index=41, kind="null_pk", row_repr="(...)")]
        rows = [(i,) for i in range(50)]
        evidence = _build_evidence("SELECT 1", rows, anomalies)
        assert evidence["run_end_mod_100"] == 41
        assert evidence["page_aligned_end"] is False


# ---------------------------------------------------------------------------
# safe_fetch() — the refetch discriminator (D-051 spec section E, items 1-5)
# ---------------------------------------------------------------------------


class TestSafeFetchGuard:
    def test_all_null_row_clean_after_refetch_returns_refetch_wholesale(self):
        """Item 1: all-NULL row detected; refetch invoked exactly once;
        clean refetch returned wholesale; evidence has correct indices,
        page_aligned_end, and refetch_outcome="clean_after_refetch"."""
        columns = _desc("reg_lineas", "mes", "precio_neto_si")
        first_rows = [(1, 3, 10.0), (None, None, None)]
        second_rows = [(1, 3, 10.0), (2, 4, 20.0)]
        conn = _QueuedConn([(columns, first_rows), (columns, second_rows)])

        result = safe_fetch(conn, "SELECT * FROM LineasVentas", guard_pk="reg_lineas")

        assert conn.cursor_calls == 2, "refetch must be invoked exactly once"
        assert result == [
            {"reg_lineas": 1, "mes": 3, "precio_neto_si": 10.0},
            {"reg_lineas": 2, "mes": 4, "precio_neto_si": 20.0},
        ]

        events = drain_anomaly_log()
        assert len(events) == 1
        ev = events[0]
        assert ev["refetch_outcome"] == "clean_after_refetch"
        assert ev["first_index"] == 1
        assert ev["last_index"] == 1
        assert ev["anomaly_count"] == 1
        assert ev["kinds"] == {"all_null": 1}
        assert ev["total_rows"] == 2
        assert ev["refetch_total_rows"] == 2
        assert ev["page_aligned_end"] is False

    def test_persisted_anomaly_drops_null_rows_keeps_non_finite_float(self):
        """Item 2: identical anomaly in both fetches -> persisted_source_data;
        null_pk/all_null dropped, non_finite_float retained."""
        columns = _desc("reg_lineas", "note", "precio_neto_si")
        rows = [
            (1, "x", 1.0),
            (None, "y", 1.0),  # null_pk -> dropped
            (3, "z", float("nan")),  # non_finite_float -> kept
            (4, "w", 1.0),
        ]
        conn = _QueuedConn([(columns, rows), (columns, rows)])

        result = safe_fetch(conn, "SELECT * FROM LineasVentas", guard_pk="reg_lineas")

        assert conn.cursor_calls == 2
        assert [r["reg_lineas"] for r in result] == [1, 3, 4]
        kept_nan_row = next(r for r in result if r["reg_lineas"] == 3)
        assert math.isnan(kept_nan_row["precio_neto_si"])

        events = drain_anomaly_log()
        assert len(events) == 1
        assert events[0]["refetch_outcome"] == "persisted_source_data"
        assert events[0]["kinds"] == {"null_pk": 1, "non_finite_float": 1}

    def test_all_null_batch_persists_as_source_data_drops_all(self):
        """The 4th outcome combination worth pinning: an all-NULL run that
        reproduces is real (persisted_source_data) and every row in it is
        dropped — none of it is safe to hand downstream."""
        columns = _desc("reg_lineas", "mes")
        rows = [(1, 1), (None, None), (None, None)]
        conn = _QueuedConn([(columns, rows), (columns, rows)])

        result = safe_fetch(conn, "SELECT * FROM t", guard_pk="reg_lineas")

        assert [r["reg_lineas"] for r in result] == [1]
        events = drain_anomaly_log()
        assert events[0]["refetch_outcome"] == "persisted_source_data"
        assert events[0]["kinds"] == {"all_null": 2}

    def test_nan_and_inf_no_false_positive_on_legitimate_none(self):
        """Item 3: NaN and Inf detected (covered directly in
        TestScanRowsForAnomalies); here: a row with a legitimate None in a
        non-PK column, and nothing else anomalous, triggers no refetch and
        no log entry — the zero-cost happy path must not misfire on it."""
        columns = _desc("pk", "note", "amount")
        rows = [(1, None, 10.0)]
        conn = _QueuedConn([(columns, rows)])

        result = safe_fetch(conn, "SELECT * FROM t", guard_pk="pk")

        assert conn.cursor_calls == 1
        assert result == [{"pk": 1, "note": None, "amount": 10.0}]
        assert drain_anomaly_log() == []

    def test_refetch_failure_flushes_evidence_and_propagates(self):
        columns = _desc("reg_lineas", "mes")
        first_rows = [(None, None)]
        boom = RuntimeError("4D connection dropped mid-refetch")
        conn = _QueuedConn([(columns, first_rows), boom])

        with pytest.raises(RuntimeError, match="4D connection dropped"):
            safe_fetch(conn, "SELECT * FROM t", guard_pk="reg_lineas")

        events = drain_anomaly_log()
        assert len(events) == 1
        assert events[0]["refetch_outcome"] == "refetch_failed"
        assert events[0]["refetch_total_rows"] is None

    def test_arity_mismatch_raises_runtime_error_with_index_and_repr(self):
        """Item 4: a short row is structurally impossible from real p4d
        (see the module docstring) — this is a tripwire, not the
        instrument. Pinned via a fake cursor returning a malformed row."""
        columns = _desc("a", "b", "c")
        rows = [(1, 2, 3), (4, 5)]  # second row has one fewer value
        conn = _QueuedConn([(columns, rows)])

        with pytest.raises(RuntimeError) as exc_info:
            safe_fetch(conn, "SELECT a, b, c FROM t")

        msg = str(exc_info.value)
        assert "row index 1" in msg
        assert "(4, 5)" in msg
        assert "expected 3 column(s), got 2 value(s)" in msg

    def test_clean_fetch_no_refetch_no_log_entries(self):
        """Item 5: pins the zero-cost happy path — a fully clean fetch
        never triggers a second round-trip or an evidence entry."""
        columns = _desc("a", "b")
        rows = [(1, "x"), (2, "y"), (3, "z")]
        conn = _QueuedConn([(columns, rows)])

        result = safe_fetch(conn, "SELECT a, b FROM t")

        assert conn.cursor_calls == 1
        assert result == [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}, {"a": 3, "b": "z"}]
        assert drain_anomaly_log() == []


# ---------------------------------------------------------------------------
# etl.main._run_sync integration — drains into etl_fetch_anomalies +
# error_msg, without double-reporting via the D-050 skip log (item 6).
# ---------------------------------------------------------------------------

_SCHEMA_SQL = Path(__file__).parent.parent / "schema" / "init.sql"
_SYNC_NAME = "_test_d051_fetch_anomaly_guard"


def _apply_schema(conn) -> None:
    """Apply the full DDL so etl_fetch_anomalies (and etl_watermarks) exist."""
    sql = _SCHEMA_SQL.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


@pytest.fixture
def clean_pg(pg_conn):
    _apply_schema(pg_conn)
    fourd.drain_anomaly_log()
    postgres.drain_skip_log()
    yield pg_conn
    with pg_conn.cursor() as cur:
        cur.execute(
            "DELETE FROM etl_fetch_anomalies WHERE sync_name = %s", (_SYNC_NAME,)
        )
        cur.execute("DELETE FROM etl_watermarks WHERE table_name = %s", (_SYNC_NAME,))
    pg_conn.commit()
    fourd.drain_anomaly_log()
    postgres.drain_skip_log()


def _sample_anomaly_event() -> dict:
    return {
        "sql_text": "SELECT * FROM LineasVentas WHERE FechaModifica >= {d '2026-08-27'}",
        "total_rows": 5000,
        "refetch_total_rows": 5000,
        "anomaly_count": 61,
        "first_index": 4939,
        "last_index": 4999,
        "index_ranges": "4939-4999",
        "page_size": 100,
        "page_aligned_end": True,
        "kinds": {"all_null": 60, "non_finite_float": 1},
        "sample": [],
        "refetch_outcome": "clean_after_refetch",
    }


class TestRunSyncDrainsFetchAnomalies:
    def test_drains_into_table_and_error_msg_without_double_reporting(self, clean_pg):
        def _sync_fn(conn_4d, conn_pg):
            fourd._anomaly_log.append(_sample_anomaly_event())
            # An unrelated D-050 skip in the very same sync, to prove the
            # two channels report independently rather than colliding.
            postgres._skip_log.append(
                "1 row(s) skipped: NULL primary key column 'reg_lineas'"
            )
            return 4939

        captured: dict = {}

        def _fake_record_table_sync(
            conn, run_id, table_name, rows_synced, duration_ms, **kwargs
        ):
            captured["error_msg"] = kwargs.get("error_msg")
            captured["status"] = kwargs.get("status")

        from etl import main as main_mod

        with patch(
            "etl.db.postgres.record_table_sync", side_effect=_fake_record_table_sync
        ):
            rows, ok = main_mod._run_sync(
                _SYNC_NAME,
                _sync_fn,
                conn_4d=MagicMock(),
                conn_pg=clean_pg,
                uses_watermark=False,
                run_id=999,
            )

        assert ok is True
        assert rows == 4939
        # Table status stays "ok": a clean-after-refetch note is
        # informational, not a sync failure (spec section B).
        assert captured["status"] == "ok"

        err = captured["error_msg"]
        assert err is not None
        assert (
            "fetch anomaly: 61 row(s) at idx 4939-4999 (clean_after_refetch); "
            "see etl_fetch_anomalies" in err
        )
        assert "skipped by upsert()" in err
        # The two notes must be genuinely separate — the fetch-anomaly note
        # must not itself mention "skipped by upsert()" or vice versa.
        assert err.count("fetch anomaly:") == 1
        assert err.count("skipped by upsert()") == 1

        # Both module-level logs fully drained — nothing leaks to the next sync.
        assert fourd.drain_anomaly_log() == []
        assert postgres.drain_skip_log() == []

        with clean_pg.cursor() as cur:
            cur.execute(
                "SELECT anomaly_count, first_index, last_index, refetch_outcome, "
                "page_aligned_end, kinds FROM etl_fetch_anomalies WHERE sync_name = %s",
                (_SYNC_NAME,),
            )
            row = cur.fetchone()
        assert row is not None
        assert row[0] == 61
        assert row[1] == 4939
        assert row[2] == 4999
        assert row[3] == "clean_after_refetch"
        assert row[4] is True
        assert row[5] == {"all_null": 60, "non_finite_float": 1}

    def test_evidence_insert_failure_does_not_fail_the_sync(self, clean_pg):
        def _sync_fn(conn_4d, conn_pg):
            fourd._anomaly_log.append(_sample_anomaly_event())
            return 1

        from etl import main as main_mod

        with (
            patch("etl.db.postgres.record_table_sync"),
            patch(
                "etl.db.postgres.insert_fetch_anomalies",
                side_effect=RuntimeError("simulated insert failure"),
            ),
        ):
            rows, ok = main_mod._run_sync(
                _SYNC_NAME,
                _sync_fn,
                conn_4d=MagicMock(),
                conn_pg=clean_pg,
                uses_watermark=False,
                run_id=999,
            )

        assert ok is True
        assert rows == 1
        # The failed insert must still have drained the in-memory log —
        # it isn't left stuck for the next sync to trip over.
        assert fourd.drain_anomaly_log() == []
