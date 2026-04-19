"""Unit tests for the manual ETL trigger mechanism.

Covers:
  RISK-TRIG-1  check_and_consume_trigger returns trigger id (int) when a pending row exists
  RISK-TRIG-2  check_and_consume_trigger returns None when no pending row exists
  RISK-TRIG-3  Manual trigger fires run_full_sync with trigger='manual'
  RISK-TRIG-4  A second trigger while a run is active does NOT start a second run
  RISK-TRIG-5  run_full_sync passes trigger param to create_run
  RISK-TRIG-6  Scheduled runs still use trigger='scheduled'
  RISK-TRIG-7  Transient poll error is logged and loop continues; run_full_sync not called
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
    cursor.__enter__.return_value = cursor
    cursor.__exit__.return_value = False
    cursor.fetchone.return_value = fetchone_result
    conn.cursor.return_value = cursor
    return conn


# ---------------------------------------------------------------------------
# RISK-TRIG-1: check_and_consume_trigger returns trigger id (int) when a pending row exists
# ---------------------------------------------------------------------------


class TestCheckAndConsumeTrigger:
    def test_returns_trigger_id_when_pending_row(self):
        from etl.db.postgres import check_and_consume_trigger

        conn = _make_pg_conn(fetchone_result=(42,))
        assert check_and_consume_trigger(conn) == 42
        conn.commit.assert_called_once()

    def test_returns_none_when_no_pending_row(self):
        from etl.db.postgres import check_and_consume_trigger

        conn = _make_pg_conn(fetchone_result=None)
        assert check_and_consume_trigger(conn) is None
        conn.commit.assert_called_once()

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
# RISK-TRIG-5: run_full_sync passes trigger to create_run
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


def _run_full_sync_mocked(
    trigger: str = "scheduled", trigger_id: int | None = None
) -> dict:
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
        run_full_sync(conn_4d, conn_pg, trigger=trigger, trigger_id=trigger_id)

    return captured


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
        mocks = _run_full_sync_mocked(trigger="manual", trigger_id=1)
        mocks["update_trigger_run_id"].assert_called_once()
        args = mocks["update_trigger_run_id"].call_args.args
        assert args[1] == 1, f"Expected trigger_id=1, got {args[1]!r}"
        assert args[2] == 99, f"Expected run_id=99, got {args[2]!r}"

    def test_update_trigger_run_id_not_called_for_scheduled(self):
        mocks = _run_full_sync_mocked(trigger="scheduled")
        mocks["update_trigger_run_id"].assert_not_called()


# ---------------------------------------------------------------------------
# RISK-TRIG-3 & RISK-TRIG-4: scheduler loop behaviour
# ---------------------------------------------------------------------------


class TestSchedulerLoopTriggerCheck:
    def test_manual_trigger_fires_run_full_sync(self):
        """When a trigger is pending and no run is active, run_full_sync is called
        with trigger='manual' and the trigger_id."""
        with (
            patch("etl.db.postgres.check_and_consume_trigger", return_value=7),
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

            mock_sync.assert_called_once_with(
                conn_4d, conn_pg, trigger="manual", trigger_id=7
            )

    def test_second_trigger_while_active_is_not_consumed(self):
        """When a run is already active, check_and_consume_trigger is never called
        so the pending trigger row is preserved for the next poll tick."""
        with (
            patch("etl.db.postgres.check_and_consume_trigger") as mock_consume,
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
        """When check_and_consume_trigger returns None, run_full_sync is not called."""
        with (
            patch("etl.db.postgres.check_and_consume_trigger", return_value=None),
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

    def test_poll_exception_does_not_crash_loop(self):
        """RISK-TRIG-7: transient DB error in check_and_consume_trigger is logged;
        the loop continues and run_full_sync is not called."""
        with (
            patch(
                "etl.db.postgres.check_and_consume_trigger",
                side_effect=RuntimeError("transient"),
            ),
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
