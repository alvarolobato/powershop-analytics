"""Integration tests for etl/sync/articulos.py.

All tests require both a live 4D connection (P4D_HOST set) and a live
PostgreSQL connection.  They are skipped automatically when either is
unavailable so CI without external access passes cleanly.

What is tested:
- Row count in ps_articulos matches 4D source after sync.
- No bytes values in ps_articulos (bytes-decoding regression guard).
- ccrefejofacm is populated for at least 90 % of rows (referencia present).
"""

from __future__ import annotations

import os

import pytest


# ---------------------------------------------------------------------------
# Skip guards
# ---------------------------------------------------------------------------


def _p4d_available() -> bool:
    return bool(os.environ.get("P4D_HOST", "").strip())


def _postgres_available() -> bool:
    if os.environ.get("POSTGRES_DSN", "").strip():
        return True
    return bool(
        os.environ.get("POSTGRES_USER", "").strip()
        and os.environ.get("POSTGRES_DB", "").strip()
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def conn_4d():
    """Yield a p4d connection; skip if P4D_HOST is not configured."""
    if not _p4d_available():
        pytest.skip("P4D_HOST not set — skipping 4D integration tests")

    from etl.config import Config
    from etl.db.fourd import get_connection

    config = Config()
    conn = get_connection(config)
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def conn_pg():
    """Yield a psycopg2 connection; skip if PostgreSQL is not configured."""
    if not _postgres_available():
        pytest.skip(
            "PostgreSQL configuration not available — skipping PostgreSQL tests"
        )

    from etl.config import Config
    from etl.db import postgres

    config = Config()
    conn = postgres.get_connection(config)
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def synced_count(conn_4d, conn_pg):
    """Run sync_articulos once and return the reported row count.

    Module-scoped so the expensive full-refresh runs only once across all tests
    in this module.
    """
    from etl.sync.articulos import sync_articulos

    return sync_articulos(conn_4d, conn_pg)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSyncArticulos:
    def test_sync_articulos_count(self, conn_4d, conn_pg, synced_count):
        """Row count in ps_articulos should match the 4D source after MA exclusion.

        MA-prefix articles (CCRefeJOFACM starting with 'MA') are filtered at
        the source query level, so the expected count is the non-MA rows in 4D.
        Rows with a NULL CCRefeJOFACM are included (not MA-prefix articles).
        """
        from etl.db.fourd import safe_fetch

        rows = safe_fetch(
            conn_4d,
            "SELECT COUNT(*) AS cnt FROM Articulos"
            " WHERE CCRefeJOFACM IS NULL OR LEFT(CCRefeJOFACM, 2) <> 'MA'",
        )
        source_count = int(rows[0]["cnt"])

        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_articulos")
            pg_count = cur.fetchone()[0]

        assert synced_count == source_count
        assert pg_count == source_count

    def test_no_ma_articles_in_mirror(self, conn_pg, synced_count):  # noqa: ARG002
        """ps_articulos must contain no MA-prefix articles after sync."""
        with conn_pg.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM ps_articulos"
                " WHERE LEFT(ccrefejofacm, 2) = 'MA'"
            )
            ma_count = cur.fetchone()[0]

        assert ma_count == 0, (
            f"Found {ma_count} MA-prefix articles in ps_articulos;"
            " they should be excluded at ETL level."
        )

    def test_no_bytes_in_articulos(self, conn_pg, synced_count):  # noqa: ARG002
        """No column in ps_articulos should contain raw bytes values.

        After safe_fetch decoding, all text fields must be str (or None).
        This guards against regressions where bytes sneak through to PostgreSQL.
        """
        with conn_pg.cursor() as cur:
            cur.execute("SELECT * FROM ps_articulos LIMIT 500")
            col_names = [desc[0] for desc in cur.description]
            rows = cur.fetchall()

        for row in rows:
            for col_name, value in zip(col_names, row):
                assert not isinstance(value, bytes), (
                    f"Column '{col_name}' contains raw bytes: {value!r}"
                )

    def test_referencia_not_empty(self, conn_pg, synced_count):  # noqa: ARG002
        """ccrefejofacm (Referencia) should be non-NULL for at least 90% of rows.

        Referencia is the primary business identifier displayed on labels and
        reports.  A high NULL rate would indicate a mapping error.
        """
        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_articulos")
            total = cur.fetchone()[0]

            cur.execute(
                "SELECT COUNT(*) FROM ps_articulos"
                " WHERE ccrefejofacm IS NOT NULL AND ccrefejofacm <> ''"
            )
            non_empty = cur.fetchone()[0]

        if total == 0:
            pytest.skip("ps_articulos is empty — skipping referencia check")

        ratio = non_empty / total
        assert ratio >= 0.90, (
            f"Only {non_empty}/{total} ({ratio:.1%}) rows have a non-empty"
            " ccrefejofacm.  Expected >= 90%."
        )
