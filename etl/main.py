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


def _run_sync(
    name: str,
    sync_fn,
    conn_4d,
    conn_pg,
    uses_watermark: bool = False,
    run_id: int | None = None,
    _results: list | None = None,
) -> int:
    """Run a single sync function with timing, watermark management, and error handling.

    Returns the number of rows synced (0 on error).  Errors are logged but do
    not propagate — the caller continues with the next table.
    """
    from etl.db.postgres import get_watermark, record_table_sync, set_watermark

    sync_method = "upsert_delta" if uses_watermark else "full_refresh"
    started_at = datetime.now(timezone.utc)
    start = time.time()
    since: datetime | None = None

    try:
        if uses_watermark:
            since = get_watermark(conn_pg, name)
            rows = sync_fn(conn_4d, conn_pg, since)
        else:
            rows = sync_fn(conn_4d, conn_pg)
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((time.time() - start) * 1000)
        set_watermark(conn_pg, name, finished_at, rows, "ok")
        logger.info("%s rows=%d duration_ms=%d", name, rows, duration_ms)

        if _results is not None:
            _results.append(True)

        if run_id is not None:
            rows_total = _get_rows_total(conn_pg, name)
            try:
                record_table_sync(
                    conn_pg,
                    run_id,
                    name,
                    started_at,
                    finished_at,
                    duration_ms,
                    status="success",
                    rows_synced=rows,
                    sync_method=sync_method,
                    watermark_from=since,
                    watermark_to=finished_at if uses_watermark else None,
                    rows_total_after=rows_total,
                )
            except Exception as rec_exc:
                logger.error("Failed to record table sync for %s: %s", name, rec_exc)

        return rows
    except Exception as exc:
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((time.time() - start) * 1000)
        try:
            set_watermark(conn_pg, name, finished_at, 0, "error", str(exc))
        except Exception as wm_exc:
            logger.error("Failed to write error watermark for %s: %s", name, wm_exc)
        logger.error("%s FAILED duration_ms=%d: %s", name, duration_ms, exc)

        if _results is not None:
            _results.append(False)

        if run_id is not None:
            try:
                record_table_sync(
                    conn_pg,
                    run_id,
                    name,
                    started_at,
                    finished_at,
                    duration_ms,
                    status="failed",
                    rows_synced=0,
                    sync_method=sync_method,
                    watermark_from=since,
                    watermark_to=finished_at if uses_watermark else None,
                    rows_total_after=None,
                    error_msg=str(exc),
                )
            except Exception as rec_exc:
                logger.error(
                    "Failed to record table sync failure for %s: %s", name, rec_exc
                )

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
# MA cascade cleanup
# ---------------------------------------------------------------------------


def _cleanup_ma_linked_rows(conn_4d, conn_pg) -> None:
    """Delete rows from line-item tables that reference MA-prefix article codes.

    MA articles (CCRefeJOFACM starting with 'MA') are excluded from ps_articulos
    at the source query level.  However, line-item tables (lineas_ventas,
    stock_tienda, gc_lin_albarane, gc_lin_facturas) are synced independently and
    may still hold rows whose `codigo` belongs to an MA article.  This function
    removes those rows so that all tables are MA-free after each sync run.

    The cleanup is idempotent — safe to run multiple times; it is a no-op when
    no MA rows are present.

    Line tables covered:
        ps_lineas_ventas, ps_stock_tienda, ps_gc_lin_albarane, ps_gc_lin_facturas
    """
    from etl.sync.articulos import get_ma_article_codes

    ma_codes = get_ma_article_codes(conn_4d)
    if not ma_codes:
        logger.info("MA cleanup: no MA article codes found — nothing to clean up")
        return

    logger.info(
        "MA cleanup: %d MA article codes to remove from line tables", len(ma_codes)
    )

    _MA_LINE_TABLES = [
        "ps_lineas_ventas",
        "ps_stock_tienda",
        "ps_gc_lin_albarane",
        "ps_gc_lin_facturas",
    ]

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]

    ma_codes_list = list(ma_codes)
    try:
        with conn_pg.cursor() as cur:
            for table in _MA_LINE_TABLES:
                stmt = pgsql.SQL("DELETE FROM {} WHERE codigo = ANY(%s)").format(
                    pgsql.Identifier(table)
                )
                cur.execute(stmt, (ma_codes_list,))
                deleted = cur.rowcount
                logger.info("MA cleanup: deleted %d rows from %s", deleted, table)
        conn_pg.commit()
    except Exception:
        conn_pg.rollback()
        raise


# ---------------------------------------------------------------------------
# Table name mapping for row-count estimates
# ---------------------------------------------------------------------------

# Maps sync task name to PostgreSQL table name for reltuples estimation.
# None means the task syncs multiple tables with no single row count.
_SYNC_TABLE_MAP: dict[str, str | None] = {
    "articulos": "ps_articulos",
    "catalogos": None,
    "tiendas": "ps_tiendas",
    "clientes": "ps_clientes",
    "proveedores": "ps_proveedores",
    "gc_comerciales": "ps_gc_comerciales",
    "ventas": "ps_ventas",
    "lineas_ventas": "ps_lineas_ventas",
    "pagos_ventas": "ps_pagos_ventas",
    "gc_albaranes": "ps_gc_albaranes",
    "gc_lin_albarane": "ps_gc_lin_albarane",
    "gc_facturas": "ps_gc_facturas",
    "gc_lin_facturas": "ps_gc_lin_facturas",
    "gc_pedidos": "ps_gc_pedidos",
    "gc_lin_pedidos": "ps_gc_lin_pedidos",
    "compras": "ps_compras",
    "lineas_compras": "ps_lineas_compras",
    "facturas": "ps_facturas",
    "albaranes": "ps_albaranes",
    "facturas_compra": "ps_facturas_compra",
    "stock": "ps_stock_tienda",
    "traspasos": "ps_traspasos",
}


def _get_rows_total(conn_pg, name: str) -> int | None:
    """Return estimated row count for the PostgreSQL table backing sync task name.

    Uses pg_class.reltuples (planner statistics) -- fast, no lock, approximate.
    Returns None if the task has no single backing table or if the query fails.
    """
    pg_table = _SYNC_TABLE_MAP.get(name)
    if pg_table is None:
        return None
    try:
        with conn_pg.cursor() as cur:
            cur.execute(
                """
                SELECT reltuples::bigint
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = %s AND n.nspname = 'public' AND c.relkind = 'r'
                """,
                (pg_table,),
            )
            row = cur.fetchone()
        return int(row[0]) if row and row[0] >= 0 else None
    except Exception as exc:
        logger.warning("Could not get row count for %s (%s): %s", name, pg_table, exc)
        return None


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
    from etl.db.postgres import create_run, finish_run

    logger.info("=== Full sync started ===")
    pipeline_start = time.time()

    # Create monitoring run record — errors must not abort the sync.
    run_id: int | None = None
    try:
        run_id = create_run(conn_pg, "scheduled")
    except Exception as exc:
        logger.error("Failed to create monitoring run record: %s", exc)

    _results: list[bool] = []
    total_rows_synced = 0
    tables_ok = 0
    tables_failed = 0
    run_status = "failed"
    run_error_msg: str | None = None

    try:
        # ------------------------------------------------------------------
        # 1. Catalog (full refresh, no watermark)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "articulos",
            sync_articulos,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        # sync_catalogos returns a dict — delegate through wrapper
        total_rows_synced += _run_sync(
            "catalogos",
            _run_sync_catalogos,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 2. Masters (full refresh, no watermark)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "tiendas",
            sync_tiendas,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "clientes",
            sync_clientes,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "proveedores",
            sync_proveedores,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_comerciales",
            sync_gc_comerciales,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 3. Retail sales (delta by FechaModifica) — run before stock (stock is slow)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "ventas",
            sync_ventas,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "lineas_ventas",
            sync_lineas_ventas,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "pagos_ventas",
            sync_pagos_ventas,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 5. Wholesale (delta by Modifica for headers; full for pedidos lines)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "gc_albaranes",
            sync_gc_albaranes,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_lin_albarane",
            sync_gc_lin_albarane,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_facturas",
            sync_gc_facturas,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_lin_facturas",
            sync_gc_lin_facturas,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_pedidos",
            sync_gc_pedidos,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "gc_lin_pedidos",
            sync_gc_lin_pedidos,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 6. Purchasing (full refresh)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "compras",
            sync_compras,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "lineas_compras",
            sync_lineas_compras,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "facturas",
            sync_facturas,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "albaranes",
            sync_albaranes,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "facturas_compra",
            sync_facturas_compra,
            conn_4d,
            conn_pg,
            uses_watermark=False,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 7. Stock (delta by FechaModifica) — last because Exportaciones is very slow (2M rows)
        # ------------------------------------------------------------------
        total_rows_synced += _run_sync(
            "stock",
            sync_stock,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )
        total_rows_synced += _run_sync(
            "traspasos",
            sync_traspasos,
            conn_4d,
            conn_pg,
            uses_watermark=True,
            run_id=run_id,
            _results=_results,
        )

        # ------------------------------------------------------------------
        # 8. MA cascade cleanup
        # MA articles (CCRefeJOFACM starting with MA) are excluded from ps_articulos
        # at the source query level. Here we cascade that exclusion to line-item
        # tables (lineas_ventas, stock_tienda, gc_lin_albarane, gc_lin_facturas)
        # whose rows may reference MA article codes via codigo from prior sync runs.
        # ------------------------------------------------------------------
        try:
            _cleanup_ma_linked_rows(conn_4d, conn_pg)
            _results.append(True)
        except Exception:
            logger.exception("MA cleanup failed; continuing with pipeline completion")
            _results.append(False)

        tables_ok = sum(1 for r in _results if r)
        tables_failed = len(_results) - tables_ok
        run_status = "success" if tables_failed == 0 else "partial"
    except Exception as exc:
        run_error_msg = str(exc)
        raise
    finally:
        if run_id is not None:
            try:
                finish_run(
                    conn_pg,
                    run_id,
                    run_status,
                    tables_ok,
                    tables_failed,
                    total_rows_synced,
                    error_msg=run_error_msg,
                )
            except Exception as exc:
                logger.error("Failed to finish monitoring run record: %s", exc)

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
