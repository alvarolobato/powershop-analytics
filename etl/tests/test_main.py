"""Unit tests for etl/main.py orchestration wiring.

All tests use unittest.mock.patch — no live DB or 4D connection needed.

Risk map (→ docs/skills/testing-patterns.md):
  RISK-ORCH-1  Sync modules skipped / not dispatched on the success path
  RISK-ORCH-2  A single-module failure aborts the remaining pipeline
  RISK-ORCH-3  create_run failure aborts the sync before any data moves
  RISK-ORCH-4  finish_run called before all syncs complete (wrong order)
  RISK-ORCH-5  reset_watermarks must be called before create_run (Opus finding #7)
"""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from etl.main import run_full_sync

# ---------------------------------------------------------------------------
# Paths for every sync function imported inside run_full_sync
# ---------------------------------------------------------------------------

_SYNC_FN_PATHS: list[str] = [
    "etl.sync.articulos.sync_articulos",
    "etl.sync.articulos.sync_catalogos",  # used by _run_sync_catalogos
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

_POSTGRES_HELPER_PATHS: list[str] = [
    "etl.db.postgres.create_run",
    "etl.db.postgres.finish_run",
    "etl.db.postgres.get_watermark",
    "etl.db.postgres.set_watermark",
    "etl.db.postgres.record_table_sync",
]


def _make_mocks(
    *,
    fail_sync_names: set[str] | None = None,
    create_run_raises: bool = False,
) -> dict[str, MagicMock]:
    """Run run_full_sync with all external calls mocked.

    Returns a dict of mock objects keyed by short function name, captured
    *after* run_full_sync completes so call_count etc. are populated.

    fail_sync_names: short names of sync fns that should raise RuntimeError
    create_run_raises: if True, create_run raises to simulate monitoring outage
    """
    fail_sync_names = fail_sync_names or set()
    captured: dict[str, MagicMock] = {}

    with ExitStack() as stack:
        # Patch every sync function
        for path in _SYNC_FN_PATHS:
            short = path.rsplit(".", 1)[-1]
            m = stack.enter_context(patch(path))
            if short in fail_sync_names:
                m.side_effect = RuntimeError(f"simulated failure in {short}")
            else:
                m.return_value = 100
            captured[short] = m

        # Patch PostgreSQL monitoring helpers
        for path in _POSTGRES_HELPER_PATHS:
            short = path.rsplit(".", 1)[-1]
            m = stack.enter_context(patch(path))
            captured[short] = m

        if create_run_raises:
            captured["create_run"].side_effect = RuntimeError("DB down")
        else:
            captured["create_run"].return_value = 42

        # MA cleanup: return empty list so the function is a no-op
        m = stack.enter_context(
            patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
        )
        captured["get_ma_article_codes"] = m

        # Row totals: skip the DB call
        m = stack.enter_context(patch("etl.main._get_rows_total", return_value=None))
        captured["_get_rows_total"] = m

        conn_4d = MagicMock(name="conn_4d")
        conn_pg = MagicMock(name="conn_pg")
        run_full_sync(conn_4d, conn_pg)

    return captured


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSuccessfulDispatch:
    """RISK-ORCH-1: All enabled sync modules are called on the happy path."""

    def test_all_sync_modules_called(self):
        """Every sync function is dispatched exactly once when all succeed."""
        mocks = _make_mocks()

        for path in _SYNC_FN_PATHS:
            short = path.rsplit(".", 1)[-1]
            assert mocks[short].call_count == 1, (
                f"{short} was not called exactly once (call_count={mocks[short].call_count})"
            )

    def test_finish_run_called_with_success(self):
        """finish_run receives status='success' when all modules complete without error."""
        mocks = _make_mocks()

        mocks["finish_run"].assert_called_once()
        _, args, kwargs = mocks["finish_run"].mock_calls[0]
        # positional: (conn_pg, run_id, status, tables_ok, tables_failed)
        status = args[2]
        tables_failed = args[4]
        assert status == "success", f"Expected 'success', got {status!r}"
        assert tables_failed == 0


class TestPerModuleFailure:
    """RISK-ORCH-2: A single-module failure must not abort the remaining pipeline."""

    def test_remaining_modules_run_after_one_failure(self):
        """When sync_ventas raises, all other sync functions are still called."""
        mocks = _make_mocks(fail_sync_names={"sync_ventas"})

        for path in _SYNC_FN_PATHS:
            short = path.rsplit(".", 1)[-1]
            assert mocks[short].call_count == 1, (
                f"{short} call_count={mocks[short].call_count} after sync_ventas failure"
            )

    def test_finish_run_records_partial_on_failure(self):
        """finish_run receives status='partial' and tables_failed≥1 after a module error."""
        mocks = _make_mocks(fail_sync_names={"sync_ventas"})

        mocks["finish_run"].assert_called_once()
        _, args, _ = mocks["finish_run"].mock_calls[0]
        status = args[2]
        tables_failed = args[4]
        assert status == "partial", f"Expected 'partial', got {status!r}"
        assert tables_failed >= 1


class TestCreateRunFailure:
    """RISK-ORCH-3: A monitoring outage must not abort the data sync pipeline."""

    def test_sync_runs_even_when_create_run_raises(self):
        """All sync functions are still dispatched when create_run raises."""
        mocks = _make_mocks(create_run_raises=True)

        for path in _SYNC_FN_PATHS:
            short = path.rsplit(".", 1)[-1]
            assert mocks[short].call_count == 1, (
                f"{short} not called when create_run failed"
            )

    def test_finish_run_not_called_when_run_id_is_none(self):
        """finish_run is skipped when create_run raised (run_id is None)."""
        mocks = _make_mocks(create_run_raises=True)
        mocks["finish_run"].assert_not_called()


class TestRunTrackingOrder:
    """RISK-ORCH-4: create_run must precede syncs; finish_run must follow all syncs."""

    def test_create_run_before_syncs_finish_run_after(self):
        """Captures call order: create_run first, finish_run last."""
        call_order: list[str] = []

        with ExitStack() as stack:
            for path in _SYNC_FN_PATHS:
                short = path.rsplit(".", 1)[-1]
                m = stack.enter_context(patch(path))
                m.return_value = 100
                name = short  # capture for closure
                m.side_effect = lambda *a, _n=name, **kw: call_order.append(_n) or 100

            for path in _POSTGRES_HELPER_PATHS:
                short = path.rsplit(".", 1)[-1]
                m = stack.enter_context(patch(path))
                name = short
                if short == "create_run":
                    m.return_value = 42
                    m.side_effect = lambda *a, _n=name, **kw: (
                        call_order.append(_n) or 42
                    )
                elif short == "finish_run":
                    m.side_effect = lambda *a, _n=name, **kw: call_order.append(_n)
                # other helpers: default MagicMock behaviour

            stack.enter_context(
                patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
            )
            stack.enter_context(patch("etl.main._get_rows_total", return_value=None))

            conn_4d, conn_pg = MagicMock(), MagicMock()
            run_full_sync(conn_4d, conn_pg)

        assert call_order[0] == "create_run", (
            f"Expected create_run first, got {call_order[0]!r}"
        )
        assert call_order[-1] == "finish_run", (
            f"Expected finish_run last, got {call_order[-1]!r}"
        )


class TestResetWatermarksBeforeCreateRun:
    """RISK-ORCH-5: reset_watermarks must be called before create_run (Opus finding #7).

    When a manual trigger with force_full=True is processed, watermarks must be
    cleared *before* the run record is created.  This ensures that if create_run
    fails, the watermarks are already gone so the next retry automatically does a
    full re-sync rather than an incremental one.
    """

    def test_reset_watermarks_called_before_create_run_on_force_full(self):
        """Uses a shared parent MagicMock to capture relative call order."""
        call_order: list[str] = []

        with ExitStack() as stack:
            for path in _SYNC_FN_PATHS:
                stack.enter_context(patch(path, return_value=100))

            for path in _POSTGRES_HELPER_PATHS:
                short = path.rsplit(".", 1)[-1]
                m = stack.enter_context(patch(path))
                name = short
                if short == "create_run":
                    m.return_value = 42
                    m.side_effect = lambda *a, _n=name, **kw: (
                        call_order.append(_n) or 42
                    )

            # reset_watermarks and get_trigger_force_flags are only called when
            # trigger='manual', so we patch them separately.
            mock_reset = stack.enter_context(
                patch("etl.db.postgres.reset_watermarks", return_value=9)
            )
            mock_reset.side_effect = (
                lambda *a, **kw: call_order.append("reset_watermarks") or 9
            )
            stack.enter_context(
                patch(
                    "etl.db.postgres.get_trigger_force_flags",
                    return_value=(True, [], None),
                )
            )
            stack.enter_context(patch("etl.db.postgres.update_trigger_run_id"))
            stack.enter_context(
                patch("etl.sync.articulos.get_ma_article_codes", return_value=[])
            )
            stack.enter_context(patch("etl.main._get_rows_total", return_value=None))

            conn_4d, conn_pg = MagicMock(), MagicMock()
            run_full_sync(conn_4d, conn_pg, trigger="manual", trigger_id=1)

        assert "reset_watermarks" in call_order, (
            "reset_watermarks was not called during a force_full manual trigger run"
        )
        assert "create_run" in call_order, "create_run was not called during the run"
        rw_idx = call_order.index("reset_watermarks")
        cr_idx = call_order.index("create_run")
        assert rw_idx < cr_idx, (
            f"reset_watermarks (position {rw_idx}) must be called before "
            f"create_run (position {cr_idx}); got order: {call_order}"
        )
