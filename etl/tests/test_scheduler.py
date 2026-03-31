"""Unit tests for etl/main.py orchestrator.

No real database connections are needed — all sync functions and watermark
helpers are mocked via unittest.mock.

Test coverage:
- test_sync_order          : All sync functions are called in the correct
                             topological order (catalog → masters → ventas →
                             mayorista → compras → stock).
- test_error_continues     : A failure in one sync function does not prevent
                             subsequent functions from running.
- test_watermark_not_updated_on_error : When a sync function raises, set_watermark
                             is called with status='error' and rows_synced=0.
"""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

_WM_MODULE = "etl.db.postgres"

# All sync targets that must be patched in every test, keyed by dotted path.
# Order matches the pipeline in etl/main.py run_full_sync().
_SYNC_TARGETS = [
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

# Short name derived from the dotted path (last segment).
_SHORT_NAMES = [t.rsplit(".", 1)[-1] for t in _SYNC_TARGETS]


def _make_conn():
    return MagicMock()


def _apply_patches(stack: ExitStack, side_effects: dict) -> dict:
    """Enter all sync patches + watermark patches into *stack*.

    *side_effects* maps short function name to a callable side_effect or a
    return_value (int/dict).  Targets not in *side_effects* default to
    ``return_value=0`` (except sync_catalogos which defaults to ``return_value={}``).

    Returns a dict mapping short name → mock object.
    """
    mocks: dict[str, MagicMock] = {}
    for target, name in zip(_SYNC_TARGETS, _SHORT_NAMES):
        effect = side_effects.get(name)
        if callable(effect) and not isinstance(effect, MagicMock):
            m = stack.enter_context(patch(target, side_effect=effect))
        elif isinstance(effect, MagicMock):
            m = stack.enter_context(patch(target, effect))
        else:
            default = {} if name == "sync_catalogos" else 0
            rv = side_effects.get(name, default)
            m = stack.enter_context(patch(target, return_value=rv))
        mocks[name] = m

    mocks["get_watermark"] = stack.enter_context(
        patch(f"{_WM_MODULE}.get_watermark", return_value=None)
    )
    mocks["set_watermark"] = stack.enter_context(patch(f"{_WM_MODULE}.set_watermark"))
    return mocks


# ---------------------------------------------------------------------------
# Test: execution order
# ---------------------------------------------------------------------------


def test_sync_order():
    """All sync functions are invoked in the required topological order."""
    conn_4d = _make_conn()
    conn_pg = _make_conn()
    call_order: list[str] = []

    def _tracker(name):
        def _fn(*args, **kwargs):
            call_order.append(name)
            return {} if name == "sync_catalogos" else 0

        return _fn

    side_effects = {name: _tracker(name) for name in _SHORT_NAMES}

    with ExitStack() as stack:
        _apply_patches(stack, side_effects)
        from etl.main import run_full_sync

        run_full_sync(conn_4d, conn_pg)

    expected_order = [
        # Catalog
        "sync_articulos",
        "sync_catalogos",
        # Masters
        "sync_tiendas",
        "sync_clientes",
        "sync_proveedores",
        "sync_gc_comerciales",
        # Retail sales (run before stock — stock is slow)
        "sync_ventas",
        "sync_lineas_ventas",
        "sync_pagos_ventas",
        # Wholesale
        "sync_gc_albaranes",
        "sync_gc_lin_albarane",
        "sync_gc_facturas",
        "sync_gc_lin_facturas",
        "sync_gc_pedidos",
        "sync_gc_lin_pedidos",
        # Purchasing
        "sync_compras",
        "sync_lineas_compras",
        "sync_facturas",
        "sync_albaranes",
        "sync_facturas_compra",
        # Stock last (Exportaciones is very slow — ~2M rows)
        "sync_stock",
        "sync_traspasos",
    ]
    assert call_order == expected_order


# ---------------------------------------------------------------------------
# Test: error in one table does not stop the rest
# ---------------------------------------------------------------------------


def test_error_continues():
    """A failure in sync_ventas does not prevent subsequent tables from running."""
    conn_4d = _make_conn()
    conn_pg = _make_conn()
    called: list[str] = []

    def _tracker(name):
        def _fn(*args, **kwargs):
            called.append(name)
            return {} if name == "sync_catalogos" else 0

        return _fn

    def _ventas_boom(*args, **kwargs):
        called.append("sync_ventas")
        raise RuntimeError("simulated ventas failure")

    side_effects = {name: _tracker(name) for name in _SHORT_NAMES}
    side_effects["sync_ventas"] = _ventas_boom

    with ExitStack() as stack:
        _apply_patches(stack, side_effects)
        from etl.main import run_full_sync

        run_full_sync(conn_4d, conn_pg)

    # ventas failed, but everything after it should still have run
    assert "sync_ventas" in called
    assert "sync_lineas_ventas" in called
    assert "sync_pagos_ventas" in called
    assert "sync_gc_albaranes" in called
    assert "sync_compras" in called
    assert "sync_facturas_compra" in called


# ---------------------------------------------------------------------------
# Test: watermark written with status='error' on failure
# ---------------------------------------------------------------------------


def test_watermark_not_updated_on_error():
    """When a sync function raises, set_watermark is called with status='error' and rows_synced=0."""
    conn_4d = _make_conn()
    conn_pg = _make_conn()

    def _articulos_boom(*args, **kwargs):
        raise ValueError("simulated articulos error")

    side_effects = {"sync_articulos": _articulos_boom}

    with ExitStack() as stack:
        mocks = _apply_patches(stack, side_effects)
        mock_set_wm = mocks["set_watermark"]
        from etl.main import run_full_sync

        run_full_sync(conn_4d, conn_pg)

    # set_watermark(conn_pg, table_name, last_sync_at, rows_synced, status, error_msg)
    # args[0]=conn_pg, args[1]=table_name, args[2]=last_sync_at,
    # args[3]=rows_synced, args[4]=status, args[5]=error_msg
    articulos_calls = [
        c for c in mock_set_wm.call_args_list if c.args[1] == "articulos"
    ]
    assert articulos_calls, "set_watermark was not called for 'articulos'"

    error_call = articulos_calls[0]
    args = error_call.args
    assert args[3] == 0, f"Expected rows_synced=0, got {args[3]}"
    assert args[4] == "error", f"Expected status='error', got {args[4]!r}"
    assert len(args) > 5, "set_watermark was not called with error_msg"
    assert "simulated articulos error" in args[5]
