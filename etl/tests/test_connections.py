"""Integration tests for PostgreSQL helpers.

All tests require POSTGRES_DSN to be set and skip gracefully when it is not.
Tests use TEMPORARY tables (ON COMMIT DROP) to avoid polluting the real schema
and to ensure automatic cleanup even on test failures.
"""
from __future__ import annotations

from datetime import datetime, timezone

from etl.db import postgres


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_temp_table(conn, table: str, col_defs: str) -> None:
    """Create a session-scoped temporary table, replacing any existing one."""
    with conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {table}")
        cur.execute(f"CREATE TEMP TABLE {table} ({col_defs})")
    conn.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestUpsert:
    TABLE = "etl_test_upsert"

    def test_upsert(self, pg_conn):
        """Upsert 3 rows, update 1, verify 3 rows with updated value."""
        conn = pg_conn
        _create_temp_table(
            conn,
            self.TABLE,
            "id INTEGER PRIMARY KEY, name TEXT, value INTEGER",
        )

        rows = [
            {"id": 1, "name": "alpha", "value": 10},
            {"id": 2, "name": "beta", "value": 20},
            {"id": 3, "name": "gamma", "value": 30},
        ]
        affected = postgres.upsert(conn, self.TABLE, rows, pk_cols=["id"])
        assert affected == 3

        # Update row id=2
        updated = [{"id": 2, "name": "beta_updated", "value": 99}]
        postgres.upsert(conn, self.TABLE, updated, pk_cols=["id"])

        with conn.cursor() as cur:
            cur.execute(f"SELECT id, name, value FROM {self.TABLE} ORDER BY id")
            result = cur.fetchall()

        assert len(result) == 3
        assert result[1] == (2, "beta_updated", 99)


class TestTruncateAndInsert:
    TABLE = "etl_test_truncate"

    def test_truncate_and_insert(self, pg_conn):
        """Insert 3 rows, then truncate+insert 2, verify only 2 remain."""
        conn = pg_conn
        _create_temp_table(
            conn,
            self.TABLE,
            "id INTEGER PRIMARY KEY, val TEXT",
        )

        rows3 = [{"id": i, "val": f"v{i}"} for i in range(1, 4)]
        postgres.truncate_and_insert(conn, self.TABLE, rows3)

        rows2 = [{"id": i, "val": f"v{i}"} for i in range(10, 12)]
        count = postgres.truncate_and_insert(conn, self.TABLE, rows2)

        assert count == 2
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self.TABLE}")
            (n,) = cur.fetchone()
        assert n == 2


class TestWatermark:
    TABLE_NAME = "_etl_test_watermark_tbl"

    def test_watermark(self, pg_conn):
        """Set a watermark, get it back, verify the value matches."""
        conn = pg_conn
        # Ensure the watermarks table exists before attempting a DELETE
        postgres._ensure_watermarks_table(conn)
        conn.commit()

        # Clean up any leftover entry
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM etl_watermarks WHERE table_name = %s",
                (self.TABLE_NAME,),
            )
        conn.commit()

        # Should be None before setting
        wm = postgres.get_watermark(conn, self.TABLE_NAME)
        assert wm is None

        ts = datetime(2026, 1, 15, 3, 0, 0, tzinfo=timezone.utc)
        postgres.set_watermark(conn, self.TABLE_NAME, ts, rows_synced=42)

        wm = postgres.get_watermark(conn, self.TABLE_NAME)
        assert wm is not None
        # Compare as naive UTC if tz info differs between drivers
        assert wm.replace(tzinfo=None) == ts.replace(tzinfo=None)

        # Clean up
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM etl_watermarks WHERE table_name = %s",
                (self.TABLE_NAME,),
            )
        conn.commit()


class TestBulkInsert:
    TABLE = "etl_test_bulk"

    def test_bulk_insert(self, pg_conn):
        """Bulk-insert 3 rows and verify count."""
        conn = pg_conn
        _create_temp_table(
            conn,
            self.TABLE,
            "id SERIAL PRIMARY KEY, msg TEXT",
        )

        rows = [{"msg": f"msg{i}"} for i in range(3)]
        count = postgres.bulk_insert(conn, self.TABLE, rows)
        assert count == 3

        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self.TABLE}")
            (n,) = cur.fetchone()
        assert n == 3
