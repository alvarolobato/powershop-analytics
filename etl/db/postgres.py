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
# Internal helpers
# ---------------------------------------------------------------------------

def _build_insert_sql(table: str, columns: list[str], pk_cols: list[str] | None = None) -> str:
    """Build a parameterised INSERT (with optional ON CONFLICT clause).

    Table and column identifiers are quoted with psycopg2.sql.Identifier to
    prevent SQL injection and handle reserved-word collisions.
    """
    from psycopg2 import sql  # type: ignore[import-untyped]

    col_ids = [sql.Identifier(c) for c in columns]
    tbl_id = sql.Identifier(table)

    if pk_cols is None:
        # Plain INSERT
        stmt = sql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
            tbl=tbl_id,
            cols=sql.SQL(", ").join(col_ids),
        )
    else:
        update_cols = [c for c in columns if c not in pk_cols]
        conflict_target = sql.SQL(", ").join(sql.Identifier(c) for c in pk_cols)
        if update_cols:
            set_clause = sql.SQL(", ").join(
                sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(c))
                for c in update_cols
            )
            on_conflict = sql.SQL("ON CONFLICT ({target}) DO UPDATE SET {sets}").format(
                target=conflict_target, sets=set_clause
            )
        else:
            on_conflict = sql.SQL("ON CONFLICT ({target}) DO NOTHING").format(
                target=conflict_target
            )
        stmt = sql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s {on_conflict}").format(
            tbl=tbl_id,
            cols=sql.SQL(", ").join(col_ids),
            on_conflict=on_conflict,
        )
    return stmt.as_string  # type: ignore[return-value]  # resolved at call site


# ---------------------------------------------------------------------------
# DML helpers
# ---------------------------------------------------------------------------


def upsert(conn, table: str, rows: list[dict], pk_cols: list[str]) -> int:
    """Batch-upsert *rows* into *table* using ON CONFLICT DO UPDATE.

    Uses psycopg2.extras.execute_values for efficiency.
    Table and column names are quoted via psycopg2.sql.Identifier.
    Commits after the batch.

    Returns the number of rows affected.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
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

    with conn.cursor() as cur:
        execute_values(cur, stmt.as_string(cur), [tuple(row[c] for c in columns) for row in rows])
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

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
    stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=pgsql.Identifier(table),
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    with conn.cursor() as cur:
        execute_values(cur, stmt.as_string(cur), [tuple(row[c] for c in columns) for row in rows])
        affected = cur.rowcount

    conn.commit()
    return affected


def truncate_and_insert(conn, table: str, rows: list[dict]) -> int:
    """TRUNCATE *table* then INSERT *rows* in a single transaction.

    Used for full-refresh tables (catalogs, small dimension tables).
    Commits after the operation.
    Returns the number of rows inserted.
    """
    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]

    tbl_id = pgsql.Identifier(table)

    if not rows:
        with conn.cursor() as cur:
            cur.execute(pgsql.SQL("TRUNCATE {tbl}").format(tbl=tbl_id))
        conn.commit()
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = list(rows[0].keys())
    insert_stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=tbl_id,
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    with conn.cursor() as cur:
        cur.execute(pgsql.SQL("TRUNCATE {tbl}").format(tbl=tbl_id))
        execute_values(
            cur,
            insert_stmt.as_string(cur),
            [tuple(row[c] for c in columns) for row in rows],
        )
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
    """Create the etl_watermarks table if it does not exist.

    Does NOT commit — callers control transaction boundaries.
    DDL is transactional in PostgreSQL so this is safe to include in a
    surrounding transaction.
    """
    with conn.cursor() as cur:
        cur.execute(_ENSURE_WATERMARKS_SQL)


def get_watermark(conn, table_name: str) -> datetime | None:
    """Return the last_sync_at timestamp for *table_name*, or None if not set."""
    _ensure_watermarks_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_sync_at FROM etl_watermarks WHERE table_name = %s",
            (table_name,),
        )
        row = cur.fetchone()
    conn.commit()
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
