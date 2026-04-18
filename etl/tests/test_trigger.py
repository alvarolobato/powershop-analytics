"""Unit tests for the manual ETL trigger mechanism.

Covers:
  RISK-TRIG-1  check_and_consume_trigger returns True when a pending row exists
  RISK-TRIG-2  check_and_consume_trigger returns False when no pending row exists
  RISK-TRIG-3  Manual trigger fires run_full_sync with trigger='manual'
  RISK-TRIG-4  A second trigger while a run is active does NOT start a second run
  RISK-TRIG-5  run_full_sync passes trigger param to create_run
  RISK-TRIG-6  Scheduled runs still use trigger='scheduled'
  RISK-TRIG-7  check_and_consume_trigger marks row status='picked_up'
  RISK-TRIG-8  Integration: real PG trigger row → check_and_consume_trigger → manual run
"""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_pg_conn(fetchone_result=None):
    """Return a mock psycopg2 connection whose cursor().fetchone() returns *fetchone_result*."""
    conn = MagicMock(name="conn_pg")
    cursor = MagicMock()
    cursor.__enter__ = lambda s: s
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = fetchone_result
    conn.cursor.return_value = cursor
    return conn


# ---------------------------------------------------------------------------
# RISK-TRIG-1/2/7: check_and_consume_trigger unit tests
# ---------------------------------------------------------------------------


class TestCheckAndConsumeTrigger:
    def test_returns_true_when_pending_row(self):
        from etl.db.postgres import check_and_consume_trigger

        conn = _make_pg_conn(fetchone_result=(1,))
        assert check_and_consume_trigger(conn) is True
        conn.commit.assert_called_once()

    def test_returns_false_when_no_pending_row(self):
        from etl.db.postgres import check_and_consume_trigger

        conn = _make_pg_conn(fetchone_result=None)
        assert check_and_consume_trigger(conn) is False
        conn.commit.assert_called_once()

    def test_marks_status_picked_up(self):
        """The UPDATE must set status='picked_up' — verify the SQL sent to the cursor."""
        from etl.db.postgres import check_and_consume_trigger

        conn = _make_pg_conn(fetchone_result=(1,))
        check_and_consume_trigger(conn)

        cursor = conn.cursor.return_value
        executed_sql: str = cursor.execute.call_args.args[0]
        assert "picked_up" in executed_sql.lower(), (
            f"Expected 'picked_up' in executed SQL, got:\n{executed_sql}"
        )

    def test_rolls_back_on_exception(self):
        from etl.db.postgres import check_and_consume_trigger

        conn = MagicMock(name="conn_pg")
        conn.cursor.side_effect = RuntimeError("DB error")
        try:
            check_and_consume_trigger(conn)
        except RuntimeError:
            pass
        conn.rollback.assert_called_once()


# ---------------------------------------------------------------------------
# Shared constants used by unit and integration tests below
# ---------------------------------------------------------------------------

_SYNC_FN_PATHS = [
    "etl.sync.articulos.sync_articulos",
    "etl.sync.articulos.sync_catalogos",
    "etl.sync.maestros.sync_tiendas",
    "etl.sync.maestros.sync_clientes",
    "etl.sync.maestros.sync_proveedores",
    "etl.sync.maestros.sync_gc_comerciales",
    "etl.sync.ventas.sync_ventas",
    "etl.sync.ventas.sync_lineas_ventas",
    "etl.sync.ventas.sync_pagos_ventas",
    "etl.sync.mayorista.sync_gc_albaranes",
    "etl.sync.mayorista.sync_gc_lin_albarane",
    "etl.sync.mayorista.sync_gc_facturas",
    "etl.sync.mayorista.sync_gc_lin_facturas",
    "etl.sync.mayorista.sync_gc_pedidos",
    "etl.sync.mayorista.sync_gc_lin_pedidos",
    "etl.sync.compras.sync_compras",
    "etl.sync.compras.sync_lineas_compras",
    "etl.sync.compras.sync_facturas",
    "etl.sync.compras.sync_albaranes",
    "etl.sync.compras.sync_facturas_compra",
    "etl.sync.stock.sync_stock",
    "etl.sync.stock.sync_traspasos",
]

_POSTGRES_HELPER_PATHS = [
    "etl.db.postgres.create_run",
    "etl.db.postgres.finish_run",
    "etl.db.postgres.get_watermark",
    "etl.db.postgres.set_watermark",
    "etl.db.postgres.record_table_sync",
    "etl.db.postgres.update_trigger_run_id",
]


def _run_full_sync_mocked(trigger: str = "scheduled") -> dict:
    """Run run_full_sync with all external calls mocked; return captured mocks."""
    from etl.main import run_full_sync

    captured: dict = {}
    with ExitStack() as stack:
        for path in _SYNC_FN_PATHS:
            m = stack.enter_context(patch(path, return_value=100))
            captured[path.rsplit(".", 1)[-1]] = m

        for path in _POSTGRES_HELPER_PATHS:
            short = path.rsplit(".", 1)[-1]
            m = stack.enter_context(patch(path))
            captured[short] = m

        captured["create_run"].return_value = 99
        stack.enter_context(
            patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
        )
        stack.enter_context(patch("etl.main._get_rows_total", return_value=None))

        conn_4d, conn_pg = MagicMock(), MagicMock()
        run_full_sync(conn_4d, conn_pg, trigger=trigger)

    return captured


# ---------------------------------------------------------------------------
# RISK-TRIG-5: run_full_sync passes trigger to create_run
# ---------------------------------------------------------------------------


class TestRunFullSyncTriggerParam:
    def test_manual_trigger_passed_to_create_run(self):
        mocks = _run_full_sync_mocked(trigger="manual")
        mocks["create_run"].assert_called_once()
        args = mocks["create_run"].call_args.args
        assert args[1] == "manual", f"Expected trigger='manual', got {args[1]!r}"

    def test_scheduled_trigger_passed_to_create_run(self):
        mocks = _run_full_sync_mocked(trigger="scheduled")
        mocks["create_run"].assert_called_once()
        args = mocks["create_run"].call_args.args
        assert args[1] == "scheduled", f"Expected trigger='scheduled', got {args[1]!r}"

    def test_default_trigger_is_scheduled(self):
        """run_full_sync() with no trigger arg defaults to 'scheduled'."""
        from etl.main import run_full_sync

        captured_trigger: list[str] = []

        def _capture_create_run(conn_pg, trigger):
            captured_trigger.append(trigger)
            return 1

        with ExitStack() as stack:
            for path in _SYNC_FN_PATHS:
                stack.enter_context(patch(path, return_value=0))
            for path in _POSTGRES_HELPER_PATHS:
                stack.enter_context(patch(path))
            stack.enter_context(
                patch("etl.db.postgres.create_run", _capture_create_run)
            )
            stack.enter_context(
                patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
            )
            stack.enter_context(patch("etl.main._get_rows_total", return_value=None))
            run_full_sync(MagicMock(), MagicMock())

        assert captured_trigger == ["scheduled"]

    def test_update_trigger_run_id_called_for_manual(self):
        mocks = _run_full_sync_mocked(trigger="manual")
        mocks["update_trigger_run_id"].assert_called_once()

    def test_update_trigger_run_id_not_called_for_scheduled(self):
        mocks = _run_full_sync_mocked(trigger="scheduled")
        mocks["update_trigger_run_id"].assert_not_called()


# ---------------------------------------------------------------------------
# RISK-TRIG-3 & RISK-TRIG-4: scheduler loop behaviour
# ---------------------------------------------------------------------------


class TestSchedulerLoopTriggerCheck:
    def test_manual_trigger_fires_run_full_sync(self):
        """When check_and_consume_trigger returns True and no run is active,
        run_full_sync is called with trigger='manual'."""
        with (
            patch("etl.db.postgres.check_and_consume_trigger", return_value=True),
            patch("etl.main._is_run_active", return_value=False),
            patch("etl.main.run_full_sync") as mock_sync,
            patch("schedule.run_pending"),
            patch("time.sleep", side_effect=StopIteration),
        ):
            import etl.main as main_mod

            conn_4d, conn_pg = MagicMock(), MagicMock()
            try:
                main_mod._run_scheduler_loop(conn_4d, conn_pg)
            except StopIteration:
                pass

            mock_sync.assert_called_once_with(conn_4d, conn_pg, trigger="manual")

    def test_second_trigger_while_active_is_not_consumed(self):
        """When a run is already active, the trigger row is NOT consumed and
        run_full_sync is NOT called (trigger stays pending for the next poll)."""
        with (
            patch(
                "etl.db.postgres.check_and_consume_trigger", return_value=True
            ) as mock_consume,
            patch("etl.main._is_run_active", return_value=True),
            patch("etl.main.run_full_sync") as mock_sync,
            patch("schedule.run_pending"),
            patch("time.sleep", side_effect=StopIteration),
        ):
            import etl.main as main_mod

            conn_4d, conn_pg = MagicMock(), MagicMock()
            try:
                main_mod._run_scheduler_loop(conn_4d, conn_pg)
            except StopIteration:
                pass

            mock_consume.assert_not_called()
            mock_sync.assert_not_called()

    def test_no_trigger_no_manual_run(self):
        """When check_and_consume_trigger returns False, run_full_sync is not called."""
        with (
            patch("etl.db.postgres.check_and_consume_trigger", return_value=False),
            patch("etl.main._is_run_active", return_value=False),
            patch("etl.main.run_full_sync") as mock_sync,
            patch("schedule.run_pending"),
            patch("time.sleep", side_effect=StopIteration),
        ):
            import etl.main as main_mod

            conn_4d, conn_pg = MagicMock(), MagicMock()
            try:
                main_mod._run_scheduler_loop(conn_4d, conn_pg)
            except StopIteration:
                pass

            mock_sync.assert_not_called()


# ---------------------------------------------------------------------------
# RISK-TRIG-8: Integration test (real PostgreSQL via pg_conn fixture)
# ---------------------------------------------------------------------------


class TestIntegrationTrigger:
    def test_integration_trigger_creates_manual_run(self, pg_conn):
        """Insert a trigger row, consume it, then run a mocked sync.

        Asserts check_and_consume_trigger marks status='picked_up' and that
        run_full_sync is called with trigger='manual'.
        Skipped automatically when no PostgreSQL config is present.
        """
        from etl.db.postgres import check_and_consume_trigger

        # Insert a pending trigger row
        with pg_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO etl_manual_trigger (status) VALUES ('pending') RETURNING id"
            )
            trigger_id = cur.fetchone()[0]
        pg_conn.commit()

        try:
            # check_and_consume_trigger must find it and return True
            found = check_and_consume_trigger(pg_conn)
            assert found is True, "check_and_consume_trigger should return True"

            # Row must be marked picked_up in the DB
            with pg_conn.cursor() as cur:
                cur.execute(
                    "SELECT status FROM etl_manual_trigger WHERE id = %s", (trigger_id,)
                )
                row = cur.fetchone()
            assert row is not None and row[0] == "picked_up", (
                f"Expected status='picked_up', got {row}"
            )

            # run_full_sync with mocked 4D — verify trigger='manual' reaches create_run
            with ExitStack() as stack:
                for path in _SYNC_FN_PATHS:
                    stack.enter_context(patch(path, return_value=0))

                mock_create_run = stack.enter_context(
                    patch("etl.db.postgres.create_run")
                )
                mock_create_run.return_value = 9999
                stack.enter_context(patch("etl.db.postgres.finish_run"))
                stack.enter_context(
                    patch("etl.db.postgres.get_watermark", return_value=None)
                )
                stack.enter_context(patch("etl.db.postgres.set_watermark"))
                stack.enter_context(patch("etl.db.postgres.record_table_sync"))
                stack.enter_context(patch("etl.db.postgres.update_trigger_run_id"))
                stack.enter_context(
                    patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
                )
                stack.enter_context(
                    patch("etl.main._get_rows_total", return_value=None)
                )

                from etl.main import run_full_sync

                conn_4d = MagicMock()
                run_full_sync(conn_4d, pg_conn, trigger="manual")

                mock_create_run.assert_called_once()
                call_trigger = mock_create_run.call_args.args[1]
                assert call_trigger == "manual", (
                    f"Expected trigger='manual' passed to create_run, got {call_trigger!r}"
                )
        finally:
            # Always clean up the trigger row
            with pg_conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM etl_manual_trigger WHERE id = %s", (trigger_id,)
                )
            pg_conn.commit()
