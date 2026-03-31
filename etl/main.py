"""ETL main orchestrator.

Wires all sync modules into a single nightly pipeline with:
- Topological execution order (catalog → masters → stock → ventas → mayorista → compras)
- Per-table error handling (one failure does not stop the rest)
- Watermark management (get/set via etl_watermarks table)
- Schema initialisation from etl/schema/init.sql on first run
- CLI: --once for a single run, or scheduler mode (daily at ETL_CRON_HOUR)

Usage:
    python -m etl.main --once       # run full sync once and exit
    python -m etl.main              # run scheduler (daily at ETL_CRON_HOUR, default 2)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("etl")

# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------

_SCHEMA_SQL_PATH = Path(__file__).parent / "schema" / "init.sql"


def _init_schema(conn_pg) -> None:
    """Execute etl/schema/init.sql against PostgreSQL (idempotent — IF NOT EXISTS)."""
    sql = _SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    with conn_pg.cursor() as cur:
        cur.execute(sql)
    conn_pg.commit()
    logger.info("Schema initialised (init.sql applied)")


# ---------------------------------------------------------------------------
# Per-table sync runner
# ---------------------------------------------------------------------------


def _run_sync(name: str, sync_fn, conn_4d, conn_pg, uses_watermark: bool = False) -> int:
    """Run a single sync function with timing, watermark management, and error handling.

    Returns the number of rows synced (0 on error).  Errors are logged but do
    not propagate — the caller continues with the next table.
    """
    from etl.db.postgres import get_watermark, set_watermark

    start = time.time()
    try:
        if uses_watermark:
            since = get_watermark(conn_pg, name)
            rows = sync_fn(conn_4d, conn_pg, since)
        else:
            rows = sync_fn(conn_4d, conn_pg)
        duration_ms = int((time.time() - start) * 1000)
        set_watermark(conn_pg, name, datetime.now(timezone.utc), rows, "ok")
        logger.info("%s rows=%d duration_ms=%d", name, rows, duration_ms)
        return rows
    except Exception as exc:
        duration_ms = int((time.time() - start) * 1000)
        try:
            set_watermark(conn_pg, name, datetime.now(timezone.utc), 0, "error", str(exc))
        except Exception as wm_exc:
            logger.error("Failed to write error watermark for %s: %s", name, wm_exc)
        logger.error("%s FAILED duration_ms=%d: %s", name, duration_ms, exc)
        return 0


# ---------------------------------------------------------------------------
# sync_catalogos returns dict[str, int] — sum the values for the watermark row count
# ---------------------------------------------------------------------------


def _run_sync_catalogos(conn_4d, conn_pg) -> int:
    """Wrap sync_catalogos (returns dict) so _run_sync can treat it uniformly."""
    from etl.sync.articulos import sync_catalogos

    result = sync_catalogos(conn_4d, conn_pg)
    if isinstance(result, dict):
        return sum(result.values())
    return int(result)


# ---------------------------------------------------------------------------
# Full sync pipeline
# ---------------------------------------------------------------------------


def run_full_sync(conn_4d, conn_pg) -> None:
    """Execute all sync tasks in topological order.

    Errors in individual tables are caught and logged; execution continues.
    """
    from etl.sync.articulos import sync_articulos
    from etl.sync.compras import (
        sync_albaranes,
        sync_compras,
        sync_facturas,
        sync_facturas_compra,
        sync_lineas_compras,
    )
    from etl.sync.maestros import (
        sync_clientes,
        sync_gc_comerciales,
        sync_proveedores,
        sync_tiendas,
    )
    from etl.sync.mayorista import (
        sync_gc_albaranes,
        sync_gc_facturas,
        sync_gc_lin_albarane,
        sync_gc_lin_facturas,
        sync_gc_lin_pedidos,
        sync_gc_pedidos,
    )
    from etl.sync.stock import sync_stock, sync_traspasos
    from etl.sync.ventas import sync_lineas_ventas, sync_pagos_ventas, sync_ventas

    logger.info("=== Full sync started ===")
    pipeline_start = time.time()

    # ------------------------------------------------------------------
    # 1. Catalog (full refresh, no watermark)
    # ------------------------------------------------------------------
    _run_sync("articulos", sync_articulos, conn_4d, conn_pg, uses_watermark=False)
    # sync_catalogos returns a dict — delegate through wrapper
    _run_sync("catalogos", _run_sync_catalogos, conn_4d, conn_pg, uses_watermark=False)

    # ------------------------------------------------------------------
    # 2. Masters (full refresh, no watermark)
    # ------------------------------------------------------------------
    _run_sync("tiendas", sync_tiendas, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("clientes", sync_clientes, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("proveedores", sync_proveedores, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("gc_comerciales", sync_gc_comerciales, conn_4d, conn_pg, uses_watermark=False)

    # ------------------------------------------------------------------
    # 3. Retail sales (delta by FechaModifica) — run before stock (stock is slow)
    # ------------------------------------------------------------------
    _run_sync("ventas", sync_ventas, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("lineas_ventas", sync_lineas_ventas, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("pagos_ventas", sync_pagos_ventas, conn_4d, conn_pg, uses_watermark=True)

    # ------------------------------------------------------------------
    # 5. Wholesale (delta by Modifica for headers; full for pedidos lines)
    # ------------------------------------------------------------------
    _run_sync("gc_albaranes", sync_gc_albaranes, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("gc_lin_albarane", sync_gc_lin_albarane, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("gc_facturas", sync_gc_facturas, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("gc_lin_facturas", sync_gc_lin_facturas, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("gc_pedidos", sync_gc_pedidos, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("gc_lin_pedidos", sync_gc_lin_pedidos, conn_4d, conn_pg, uses_watermark=False)

    # ------------------------------------------------------------------
    # 6. Purchasing (full refresh)
    # ------------------------------------------------------------------
    _run_sync("compras", sync_compras, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("lineas_compras", sync_lineas_compras, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("facturas", sync_facturas, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("albaranes", sync_albaranes, conn_4d, conn_pg, uses_watermark=False)
    _run_sync("facturas_compra", sync_facturas_compra, conn_4d, conn_pg, uses_watermark=False)

    # ------------------------------------------------------------------
    # 7. Stock (delta by FechaModifica) — last because Exportaciones is very slow (2M rows)
    # ------------------------------------------------------------------
    _run_sync("stock", sync_stock, conn_4d, conn_pg, uses_watermark=True)
    _run_sync("traspasos", sync_traspasos, conn_4d, conn_pg, uses_watermark=True)

    total_ms = int((time.time() - pipeline_start) * 1000)
    logger.info("=== Full sync completed in %d ms ===", total_ms)


# ---------------------------------------------------------------------------
# Connection test
# ---------------------------------------------------------------------------


def _test_connections(config) -> tuple:
    """Attempt to connect to both 4D and PostgreSQL.  Exit(1) on failure.

    Returns (conn_4d, conn_pg) on success.
    """
    from etl.db import fourd, postgres

    conn_4d = None
    conn_pg = None

    logger.info("Testing 4D connection to %s:%d ...", config.p4d_host, config.p4d_port)
    try:
        conn_4d = fourd.get_connection(config)
        logger.info("4D connection OK")
    except Exception as exc:
        logger.error("Cannot connect to 4D: %s", exc)
        sys.exit(1)

    logger.info("Testing PostgreSQL connection ...")
    try:
        conn_pg = postgres.get_connection(config)
        logger.info("PostgreSQL connection OK")
    except Exception as exc:
        logger.error("Cannot connect to PostgreSQL: %s", exc)
        if conn_4d is not None:
            conn_4d.close()
        sys.exit(1)

    return conn_4d, conn_pg


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="PowerShop ETL orchestrator")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single full sync and exit (default: run scheduler)",
    )
    args = parser.parse_args()

    from etl.config import Config

    try:
        config = Config()
    except ValueError as exc:
        logger.error("Configuration error: %s", exc)
        sys.exit(1)

    cron_hour = int(os.environ.get("ETL_CRON_HOUR", "2"))

    conn_4d, conn_pg = _test_connections(config)

    try:
        _init_schema(conn_pg)

        if args.once:
            run_full_sync(conn_4d, conn_pg)
        else:
            import schedule

            logger.info("Scheduler mode: daily sync at %02d:00", cron_hour)

            def _job() -> None:
                run_full_sync(conn_4d, conn_pg)

            schedule.every().day.at(f"{cron_hour:02d}:00").do(_job)

            # Run immediately on first start so we do not wait until 02:00
            logger.info("Running initial sync on startup ...")
            _job()

            while True:
                schedule.run_pending()
                time.sleep(60)
    finally:
        try:
            conn_4d.close()
        except Exception:
            pass
        try:
            conn_pg.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
