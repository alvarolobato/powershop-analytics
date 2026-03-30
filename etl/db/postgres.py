"""PostgreSQL connection and DML helpers for the ETL pipeline."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from etl.config import Config

logger = logging.getLogger(__name__)


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
    Commits after the batch.

    Returns the number of rows affected.
    """
    if not rows:
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
    update_cols = [c for c in columns if c not in pk_cols]
    conflict_target = ", ".join(pk_cols)

    if update_cols:
        update_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        on_conflict = f"ON CONFLICT ({conflict_target}) DO UPDATE SET {update_clause}"
    else:
        # All columns are part of the PK — nothing to update
        on_conflict = f"ON CONFLICT ({conflict_target}) DO NOTHING"

    col_list = ", ".join(columns)
    sql = f"INSERT INTO {table} ({col_list}) VALUES %s {on_conflict}"

    with conn.cursor() as cur:
        execute_values(cur, sql, [tuple(row[c] for c in columns) for row in rows])
        affected = cur.rowcount

    conn.commit()
    return affected


def bulk_insert(conn, table: str, rows: list[dict]) -> int:
    """Simple batch INSERT (for append-only tables like Traspasos).

    Commits after the batch.
    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
    col_list = ", ".join(columns)
    sql = f"INSERT INTO {table} ({col_list}) VALUES %s"

    with conn.cursor() as cur:
        execute_values(cur, sql, [tuple(row[c] for c in columns) for row in rows])
        affected = cur.rowcount

    conn.commit()
    return affected


def truncate_and_insert(conn, table: str, rows: list[dict]) -> int:
    """TRUNCATE *table* then INSERT *rows* in a single transaction.

    Used for full-refresh tables (catalogs, small dimension tables).
    Commits after the operation.
    Returns the number of rows inserted.
    """
    if not rows:
        with conn.cursor() as cur:
            cur.execute(f"TRUNCATE {table}")
        conn.commit()
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
    col_list = ", ".join(columns)
    insert_sql = f"INSERT INTO {table} ({col_list}) VALUES %s"

    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {table}")
        execute_values(cur, insert_sql, [tuple(row[c] for c in columns) for row in rows])
        affected = cur.rowcount

    conn.commit()
    return affected


# ---------------------------------------------------------------------------
# Watermark helpers
# ---------------------------------------------------------------------------

_ENSURE_WATERMARKS_SQL = """
CREATE TABLE IF NOT EXISTS etl_watermarks (
    table_name   TEXT PRIMARY KEY,
    last_sync_at TIMESTAMPTZ NOT NULL,
    rows_synced  INTEGER,
    status       TEXT DEFAULT 'ok',
    error_msg    TEXT,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
)
"""


def _ensure_watermarks_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(_ENSURE_WATERMARKS_SQL)
    conn.commit()


def get_watermark(conn, table_name: str) -> datetime | None:
    """Return the last_sync_at timestamp for *table_name*, or None if not set."""
    _ensure_watermarks_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_sync_at FROM etl_watermarks WHERE table_name = %s",
            (table_name,),
        )
        row = cur.fetchone()
    return row[0] if row else None


def set_watermark(
    conn,
    table_name: str,
    last_sync_at: datetime,
    rows_synced: int,
    status: str = "ok",
    error_msg: str | None = None,
) -> None:
    """Upsert the watermark record for *table_name*."""
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
