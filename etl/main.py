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
) -> tuple[int, bool]:
    """Run a single sync function with timing, watermark management, and error handling.

    Returns (rows_synced, ok).  Errors are logged but do not propagate — the
    caller continues with the next table.  When run_id is provided, calls
    record_table_sync after each table; failures there are also swallowed.
    """
    from etl.db.postgres import get_watermark, set_watermark

    start = time.time()
    started_at = datetime.now(timezone.utc)
    rows = 0
    ok = True
    duration_ms = 0
    err: str | None = None
    wm_from: datetime | None = None
    wm_to: datetime | None = None
    try:
        if uses_watermark:
            since = get_watermark(conn_pg, name)
            wm_from = since
            rows = sync_fn(conn_4d, conn_pg, since)
        else:
            rows = sync_fn(conn_4d, conn_pg)
        duration_ms = int((time.time() - start) * 1000)
        now = datetime.now(timezone.utc)
        if uses_watermark:
            wm_to = now
        set_watermark(conn_pg, name, now, rows, "ok")
        logger.info("%s rows=%d duration_ms=%d", name, rows, duration_ms)
    except Exception as exc:
        duration_ms = int((time.time() - start) * 1000)
        ok = False
        err = str(exc)[:2000]
        wm_to = datetime.now(timezone.utc)
        try:
            set_watermark(conn_pg, name, wm_to, 0, "error", err)
        except Exception as wm_exc:
            logger.error("Failed to write error watermark for %s: %s", name, wm_exc)
        logger.error("%s FAILED duration_ms=%d: %s", name, duration_ms, exc)

    if run_id is not None:
        from etl.db.postgres import record_table_sync

        try:
            record_table_sync(
                conn_pg,
                run_id,
                name,
                rows,
                duration_ms,
                status="ok" if ok else "failed",
                started_at=started_at,
                finished_at=datetime.now(timezone.utc),
                sync_method="upsert_delta" if uses_watermark else "full_refresh",
                watermark_from=wm_from,
                watermark_to=wm_to,
                error_msg=err,
            )
        except Exception as mon_exc:
            logger.error(
                "Monitoring: record_table_sync failed for %s: %s", name, mon_exc
            )

    return rows, ok


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
# Post-sync totals helper
# ---------------------------------------------------------------------------

_ROWS_TOTAL_TABLES = [
    "ps_ventas",
    "ps_lineas_ventas",
    "ps_stock_tienda",
    "ps_articulos",
    "ps_clientes",
]


def _get_rows_total(conn_pg) -> dict[str, int] | None:
    """Return row counts for key tables; returns None on any DB error."""
    try:
        totals: dict[str, int] = {}
        with conn_pg.cursor() as cur:
            for table in _ROWS_TOTAL_TABLES:
                cur.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608
                totals[table] = cur.fetchone()[0]
        return totals
    except Exception as exc:
        logger.warning("Could not fetch row totals: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Full sync pipeline
# ---------------------------------------------------------------------------


def _is_run_active(conn_pg) -> bool:
    """Return True if a recent etl_sync_runs row with status='running' exists.

    Rows older than 12 hours are treated as stale (crashed runs) and ignored.
    """
    try:
        with conn_pg.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM etl_sync_runs WHERE status = 'running'"
                " AND started_at > NOW() - INTERVAL '12 hours' LIMIT 1"
            )
            is_active = cur.fetchone() is not None
        conn_pg.rollback()
        return is_active
    except Exception as exc:
        logger.warning("_is_run_active query failed: %s", exc)
        try:
            conn_pg.rollback()
        except Exception:
            pass
        return True  # fail closed: assume active, retry next tick


def run_full_sync(
    conn_4d, conn_pg, trigger: str = "scheduled", trigger_id: int | None = None
) -> None:
    """Execute all sync tasks in topological order.

    Errors in individual tables are caught and logged; execution continues.
    Monitoring (create_run / record_table_sync / finish_run) is best-effort:
    failures there never abort the data sync.
    """
    from etl.db.postgres import create_run, finish_run
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

    run_id: int | None = None
    try:
        run_id = create_run(conn_pg, trigger)
    except Exception:
        logger.exception(
            "Monitoring: create_run failed; continuing without run tracking"
        )
        if trigger == "manual" and trigger_id is not None:
            logger.warning(
                "Manual trigger %d will complete but run_id tracking is unavailable",
                trigger_id,
            )

    results: list[bool] = []

    def _s(name, fn, *, wm=False):
        _, ok = _run_sync(name, fn, conn_4d, conn_pg, uses_watermark=wm, run_id=run_id)
        results.append(ok)

    # ------------------------------------------------------------------
    # 1. Catalog (full refresh, no watermark)
    # ------------------------------------------------------------------
    # Load catalogos BEFORE articulos: truncate_and_insert uses TRUNCATE ...
    # CASCADE, and ps_articulos has FKs to all five catalog tables.  If
    # articulos ran first, the next catalog truncate would cascade-wipe it.
    _s("catalogos", _run_sync_catalogos)
    _s("articulos", sync_articulos)

    # ------------------------------------------------------------------
    # 2. Masters (full refresh, no watermark)
    # ------------------------------------------------------------------
    _s("tiendas", sync_tiendas)
    _s("clientes", sync_clientes)
    _s("proveedores", sync_proveedores)
    _s("gc_comerciales", sync_gc_comerciales)

    # ------------------------------------------------------------------
    # 3. Retail sales (delta by FechaModifica) — run before stock (stock is slow)
    # ------------------------------------------------------------------
    _s("ventas", sync_ventas, wm=True)
    _s("lineas_ventas", sync_lineas_ventas, wm=True)
    _s("pagos_ventas", sync_pagos_ventas, wm=True)

    # ------------------------------------------------------------------
    # 5. Wholesale (delta by Modifica for headers; full for pedidos lines)
    # ------------------------------------------------------------------
    _s("gc_albaranes", sync_gc_albaranes, wm=True)
    _s("gc_lin_albarane", sync_gc_lin_albarane, wm=True)
    _s("gc_facturas", sync_gc_facturas, wm=True)
    _s("gc_lin_facturas", sync_gc_lin_facturas, wm=True)
    _s("gc_pedidos", sync_gc_pedidos)
    _s("gc_lin_pedidos", sync_gc_lin_pedidos)

    # ------------------------------------------------------------------
    # 6. Purchasing (full refresh)
    # ------------------------------------------------------------------
    _s("compras", sync_compras)
    _s("lineas_compras", sync_lineas_compras)
    _s("facturas", sync_facturas)
    _s("albaranes", sync_albaranes)
    _s("facturas_compra", sync_facturas_compra)

    # ------------------------------------------------------------------
    # 7. Stock (delta by FechaModifica) — last because Exportaciones is very slow (2M rows)
    # ------------------------------------------------------------------
    _s("stock", sync_stock, wm=True)
    _s("traspasos", sync_traspasos, wm=True)

    # ------------------------------------------------------------------
    # 8. MA cascade cleanup — remove line-table rows referencing MA articles
    # ------------------------------------------------------------------
    # MA articles (CCRefeJOFACM starting with 'MA') are excluded from
    # ps_articulos at the source query level.  Here we cascade that exclusion
    # to line-item tables whose rows reference MA article codes via `codigo`.
    # This is necessary because line tables use delta/upsert strategies that
    # may have inserted MA-linked rows in previous sync runs before this filter.
    # Failures are logged but do not abort the pipeline (consistent with _run_sync).
    ma_ok = True
    try:
        _cleanup_ma_linked_rows(conn_4d, conn_pg)
    except Exception:
        logger.exception("MA cleanup failed; continuing with pipeline completion")
        ma_ok = False
    results.append(ma_ok)

    total_ms = int((time.time() - pipeline_start) * 1000)
    logger.info("=== Full sync completed in %d ms ===", total_ms)

    rows_total = _get_rows_total(conn_pg)
    if rows_total:
        logger.info("Post-sync row totals: %s", rows_total)

    if run_id is not None:
        tables_ok = sum(results)
        tables_failed = len(results) - tables_ok
        status = "success" if tables_failed == 0 else "partial"
        try:
            finish_run(conn_pg, run_id, status, tables_ok, tables_failed)
        except Exception:
            logger.exception("Monitoring: finish_run failed")

        if trigger == "manual" and trigger_id is not None:
            from etl.db.postgres import update_trigger_run_id

            try:
                update_trigger_run_id(conn_pg, trigger_id, run_id)
            except Exception:
                logger.warning("Could not update trigger run_id — non-fatal")


# ---------------------------------------------------------------------------
# Scheduler loop (extracted for testability)
# ---------------------------------------------------------------------------


def _run_scheduler_loop(conn_4d, conn_pg) -> None:
    """Blocking scheduler loop: runs scheduled jobs and polls for manual triggers.

    Polls every 10 seconds. When a pending trigger row is found and no run is
    active, consumes it and fires run_full_sync with trigger='manual'. If a run
    is already active the trigger row stays pending and is picked up on the next
    poll after the active run finishes.
    """
    import schedule

    from etl.db.postgres import check_and_consume_trigger

    while True:
        schedule.run_pending()
        if not _is_run_active(conn_pg):
            try:
                trigger_id = check_and_consume_trigger(conn_pg)
            except Exception:
                logger.exception(
                    "Failed to poll manual ETL trigger; will retry on next tick"
                )
            else:
                if trigger_id is not None:
                    logger.info("Manual trigger detected — starting sync")
                    run_full_sync(
                        conn_4d, conn_pg, trigger="manual", trigger_id=trigger_id
                    )
        time.sleep(10)


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

    from etl.db import fourd, postgres

    logger.info("Connecting to PostgreSQL ...")
    try:
        conn_pg = postgres.get_connection(config)
        logger.info("PostgreSQL connection OK")
    except Exception as exc:
        logger.error("Cannot connect to PostgreSQL: %s", exc)
        sys.exit(1)

    try:
        _init_schema(conn_pg)
    except Exception:
        logger.exception("Schema initialisation failed")
        try:
            conn_pg.close()
        except Exception:
            pass
        sys.exit(1)

    logger.info("Testing 4D connection to %s:%d ...", config.p4d_host, config.p4d_port)
    try:
        conn_4d = fourd.get_connection(config)
        logger.info("4D connection OK")
    except Exception as exc:
        logger.error("Cannot connect to 4D: %s", exc)
        try:
            conn_pg.close()
        except Exception:
            pass
        sys.exit(1)

    try:
        if args.once:
            run_full_sync(conn_4d, conn_pg, trigger="cli")
        else:
            import schedule

            logger.info("Scheduler mode: daily sync at %02d:00", cron_hour)

            def _job() -> None:
                run_full_sync(conn_4d, conn_pg, trigger="scheduled")

            schedule.every().day.at(f"{cron_hour:02d}:00").do(_job)

            # Run immediately on first start so we do not wait until 02:00
            logger.info("Running initial sync on startup ...")
            _job()

            _run_scheduler_loop(conn_4d, conn_pg)
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
