"""PostgreSQL connection and DML helpers for the ETL pipeline.

Transaction policy
------------------
All DML helpers (upsert, bulk_insert, truncate_and_insert) commit on success
and rollback on failure so the connection is always in a clean state.
Watermark helpers (get_watermark, set_watermark) follow the same pattern.
_ensure_watermarks_table() does NOT commit — it is always called as part of a
surrounding operation that owns the commit/rollback.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from etl.config import Config

logger = logging.getLogger(__name__)

# Single source of truth for the etl_watermarks DDL: loaded from init.sql so
# the in-memory definition never drifts from the file applied to the database.
_SCHEMA_SQL_PATH = Path(__file__).parent.parent / "schema" / "init.sql"


def _load_watermarks_ddl() -> str:
    """Extract the CREATE TABLE IF NOT EXISTS etl_watermarks statement from init.sql."""
    sql = _SCHEMA_SQL_PATH.read_text()
    # Find the block that starts with "CREATE TABLE IF NOT EXISTS etl_watermarks"
    start = sql.find("CREATE TABLE IF NOT EXISTS etl_watermarks")
    if start == -1:
        raise RuntimeError(
            f"etl_watermarks DDL not found in {_SCHEMA_SQL_PATH}. "
            "Ensure etl/schema/init.sql contains that CREATE TABLE statement."
        )
    end = sql.find(";", start) + 1
    return sql[start:end]


def _validate_rows(rows: list[dict], operation: str) -> list[str]:
    """Return the column list; raise ValueError if rows have inconsistent keys."""
    columns = list(rows[0].keys())
    expected = set(columns)
    for idx, row in enumerate(rows[1:], start=1):
        if set(row.keys()) != expected:
            raise ValueError(
                f"{operation}: inconsistent keys in row {idx}. "
                f"Expected {sorted(expected)}, got {sorted(row.keys())}."
            )
    return columns


def get_connection(config: "Config"):
    """Return a psycopg2 connection with autocommit=False."""
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "psycopg2 package is not installed. Run: pip install psycopg2-binary"
        ) from exc

    conn = psycopg2.connect(config.postgres_dsn)
    conn.autocommit = False
    return conn


# ---------------------------------------------------------------------------
# DML helpers
# ---------------------------------------------------------------------------


def upsert(conn, table: str, rows: list[dict], pk_cols: list[str]) -> int:
    """Batch-upsert *rows* into *table* using ON CONFLICT DO UPDATE.

    Uses psycopg2.extras.execute_values for efficiency.
    Table and column names are quoted via psycopg2.sql.Identifier.
    Commits on success; rolls back and re-raises on failure.

    Returns the number of rows affected.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = _validate_rows(rows, "upsert")
    update_cols = [c for c in columns if c not in pk_cols]
    conflict_target = pgsql.SQL(", ").join(pgsql.Identifier(c) for c in pk_cols)
    col_ids = [pgsql.Identifier(c) for c in columns]
    tbl_id = pgsql.Identifier(table)

    if update_cols:
        set_clause = pgsql.SQL(", ").join(
            pgsql.SQL("{col} = EXCLUDED.{col}").format(col=pgsql.Identifier(c))
            for c in update_cols
        )
        on_conflict = pgsql.SQL("ON CONFLICT ({target}) DO UPDATE SET {sets}").format(
            target=conflict_target, sets=set_clause
        )
    else:
        on_conflict = pgsql.SQL("ON CONFLICT ({target}) DO NOTHING").format(
            target=conflict_target
        )

    stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s {on_conflict}").format(
        tbl=tbl_id,
        cols=pgsql.SQL(", ").join(col_ids),
        on_conflict=on_conflict,
    )

    try:
        with conn.cursor() as cur:
            execute_values(
                cur, stmt.as_string(cur), [tuple(row[c] for c in columns) for row in rows]
            )
            affected = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return affected


def bulk_insert(conn, table: str, rows: list[dict]) -> int:
    """Simple batch INSERT (for append-only tables like Traspasos).

    Commits on success; rolls back and re-raises on failure.
    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = _validate_rows(rows, "bulk_insert")
    stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=pgsql.Identifier(table),
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    try:
        with conn.cursor() as cur:
            execute_values(
                cur, stmt.as_string(cur), [tuple(row[c] for c in columns) for row in rows]
            )
            affected = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return affected


def truncate_and_insert(conn, table: str, rows: list[dict]) -> int:
    """TRUNCATE *table* then INSERT *rows* in a single transaction.

    Used for full-refresh tables (catalogs, small dimension tables).
    Commits on success; rolls back and re-raises on failure.
    Returns the number of rows inserted.
    """
    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]

    tbl_id = pgsql.Identifier(table)

    if not rows:
        try:
            with conn.cursor() as cur:
                cur.execute(pgsql.SQL("TRUNCATE {tbl}").format(tbl=tbl_id))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = _validate_rows(rows, "truncate_and_insert")
    insert_stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=tbl_id,
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    try:
        with conn.cursor() as cur:
            cur.execute(pgsql.SQL("TRUNCATE {tbl}").format(tbl=tbl_id))
            execute_values(
                cur,
                insert_stmt.as_string(cur),
                [tuple(row[c] for c in columns) for row in rows],
            )
            affected = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return affected


# ---------------------------------------------------------------------------
# Watermark helpers
# ---------------------------------------------------------------------------


def _ensure_watermarks_table(conn) -> None:
    """Create the etl_watermarks table if it does not exist.

    DDL is loaded from etl/schema/init.sql (single source of truth).
    Does NOT commit — callers own the transaction boundary.
    """
    ddl = _load_watermarks_ddl()
    with conn.cursor() as cur:
        cur.execute(ddl)


def get_watermark(conn, table_name: str) -> datetime | None:
    """Return the last_sync_at timestamp for *table_name*, or None if not set.

    Commits after the read so the connection stays in a clean state.
    """
    try:
        _ensure_watermarks_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT last_sync_at FROM etl_watermarks WHERE table_name = %s",
                (table_name,),
            )
            row = cur.fetchone()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return row[0] if row else None


def set_watermark(
    conn,
    table_name: str,
    last_sync_at: datetime,
    rows_synced: int,
    status: str = "ok",
    error_msg: str | None = None,
) -> None:
    """Upsert the watermark record for *table_name*.

    Commits on success; rolls back and re-raises on failure.
    """
    try:
        _ensure_watermarks_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_watermarks
                    (table_name, last_sync_at, rows_synced, status, error_msg, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (table_name) DO UPDATE SET
                    last_sync_at = EXCLUDED.last_sync_at,
                    rows_synced  = EXCLUDED.rows_synced,
                    status       = EXCLUDED.status,
                    error_msg    = EXCLUDED.error_msg,
                    updated_at   = NOW()
                """,
                (table_name, last_sync_at, rows_synced, status, error_msg),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
