"""Unit and integration tests for etl/sync/stock.py.

Unit tests cover helpers such as _normalize_expo_row without any external connections.

Integration tests require both a 4D SQL connection (P4D_HOST must be set) and a
PostgreSQL connection (POSTGRES_DSN or POSTGRES_USER + POSTGRES_DB must be set).
All integration tests skip gracefully when the required environment variables are absent.
The 4D integration tests use a small date range to keep query time reasonable.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from etl.sync.stock import _normalize_expo_row, sync_stock, sync_traspasos


# ---------------------------------------------------------------------------
# Skip helpers
# ---------------------------------------------------------------------------


def _p4d_available() -> bool:
    """Return True if a 4D SQL connection is configured."""
    return bool(os.environ.get("P4D_HOST", "").strip())


def _postgres_available() -> bool:
    """Return True if a PostgreSQL connection is configured."""
    if os.environ.get("POSTGRES_DSN", "").strip():
        return True
    user = os.environ.get("POSTGRES_USER", "")
    db = os.environ.get("POSTGRES_DB", "")
    return bool(user and db)


def _both_available() -> bool:
    """Return True only when both 4D and PostgreSQL are configured."""
    return _p4d_available() and _postgres_available()


# ---------------------------------------------------------------------------
# Unit tests (no external connections required)
# ---------------------------------------------------------------------------


class TestNormalizeExpoRow:
    """Unit tests for _normalize_expo_row — no real connection needed."""

    def _make_row(self, pairs: list[tuple[str | None, int | None]]) -> dict:
        """Build a minimal Exportaciones dict with up to 34 Talla/Stock pairs."""
        row: dict = {
            "codigo": "144880",
            "tiendacodigo": "104/169",
            "tienda": "TIENDA TEST",
            "ccstock": 10.0,
            "ststock": 25.0,
            "fechamodifica": None,
        }
        for i in range(1, 35):
            idx = i - 1
            if idx < len(pairs):
                talla, stock = pairs[idx]
                row[f"talla{i}"] = talla
                row[f"stock{i}"] = stock
            else:
                row[f"talla{i}"] = None
                row[f"stock{i}"] = None
        return row

    def test_single_pair_emits_one_row(self):
        row = self._make_row([("38", 2)])
        result = _normalize_expo_row(row)
        assert len(result) == 1
        assert result[0]["talla"] == "38"
        assert result[0]["stock"] == 2
        assert result[0]["codigo"] == "144880"
        assert result[0]["tienda_codigo"] == "104/169"

    def test_multiple_pairs_emits_multiple_rows(self):
        row = self._make_row([("36", 1), ("38", 3), ("40", 0)])
        result = _normalize_expo_row(row)
        assert len(result) == 3
        tallas = [r["talla"] for r in result]
        assert tallas == ["36", "38", "40"]

    def test_empty_talla_is_skipped(self):
        row = self._make_row([("36", 1), ("", 5), (None, 2)])
        result = _normalize_expo_row(row)
        # Only "36" should produce a row; "" and None are skipped.
        assert len(result) == 1
        assert result[0]["talla"] == "36"

    def test_whitespace_talla_is_skipped(self):
        row = self._make_row([("  ", 3), ("40", 1)])
        result = _normalize_expo_row(row)
        assert len(result) == 1
        assert result[0]["talla"] == "40"

    def test_all_tallas_none_emits_no_rows(self):
        row = self._make_row([])
        result = _normalize_expo_row(row)
        assert result == []

    def test_stock_none_defaults_to_zero(self):
        row = self._make_row([("38", None)])
        result = _normalize_expo_row(row)
        assert result[0]["stock"] == 0

    def test_cc_stock_and_st_stock_present(self):
        row = self._make_row([("38", 5)])
        result = _normalize_expo_row(row)
        from decimal import Decimal

        assert result[0]["cc_stock"] == Decimal("10.0")
        assert result[0]["st_stock"] == Decimal("25.0")

    def test_cc_stock_none_preserved(self):
        row = self._make_row([("38", 5)])
        row["ccstock"] = None
        row["ststock"] = None
        result = _normalize_expo_row(row)
        assert result[0]["cc_stock"] is None
        assert result[0]["st_stock"] is None

    def test_talla_whitespace_stripped(self):
        row = self._make_row([("  38  ", 2)])
        result = _normalize_expo_row(row)
        assert result[0]["talla"] == "38"

    def test_missing_codigo_raises(self):
        """Missing Codigo should raise ValueError instead of silently producing empty key."""
        row = self._make_row([("38", 1)])
        row["codigo"] = None
        with pytest.raises(ValueError, match="Codigo"):
            _normalize_expo_row(row)

    def test_missing_tienda_codigo_raises(self):
        """Missing TiendaCodigo should raise ValueError instead of silently producing empty key."""
        row = self._make_row([("38", 1)])
        row["tiendacodigo"] = None
        with pytest.raises(ValueError, match="TiendaCodigo"):
            _normalize_expo_row(row)

    def test_cc_stock_computed_once(self):
        """cc_stock value is identical across all emitted rows (computed once per source row)."""
        row = self._make_row([("36", 1), ("38", 2), ("40", 3)])
        result = _normalize_expo_row(row)
        assert len(result) == 3
        from decimal import Decimal

        expected = Decimal("10.0")
        for r in result:
            assert r["cc_stock"] == expected


# ---------------------------------------------------------------------------
# Integration tests (require P4D_HOST + PostgreSQL)
# ---------------------------------------------------------------------------

# Fixed integration start date — keeps the sync window bounded so tests do
# not grow slower over time as more data accumulates in the source systems.
# Exportaciones rows are frequently touched, so this window reliably has rows.
_INTEGRATION_SINCE = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def fourd_conn():
    """Yield a P4D connection; skip if either backend is absent.

    Both backends are required — guard with _both_available() to avoid
    constructing Config() (which validates PG env vars) when only P4D is set.
    Function scope (same as pg_conn) avoids pytest ScopeMismatch errors.
    """
    if not _both_available():
        pytest.skip(
            "P4D_HOST or PostgreSQL configuration not available — "
            "skipping integration tests"
        )
    from etl.config import Config
    from etl.db import fourd

    config = Config()
    conn = fourd.get_connection(config)
    yield conn
    conn.close()


class TestSyncStockIntegration:
    """Integration tests that require both 4D and PostgreSQL connections."""

    def test_sync_stock_produces_rows(self, fourd_conn, pg_conn):
        """Verify that sync_stock processes rows and ps_stock_tienda is populated."""
        attempted = sync_stock(fourd_conn, pg_conn, since=_INTEGRATION_SINCE)
        assert attempted > 0, (
            f"sync_stock returned 0 attempted rows for the {_INTEGRATION_SINCE.date()} window — "
            "no stock data was found or the query window is too narrow"
        )

        with pg_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_stock_tienda")
            (count_after,) = cur.fetchone()

        assert count_after > 0, (
            "ps_stock_tienda is empty after sync_stock — "
            "rows were not written to PostgreSQL"
        )

    def test_stock_no_empty_tallas(self, fourd_conn, pg_conn):
        """After sync, no rows in ps_stock_tienda should have empty talla."""
        attempted = sync_stock(fourd_conn, pg_conn, since=_INTEGRATION_SINCE)
        assert attempted > 0, (
            "sync_stock returned 0 rows — cannot validate talla filtering on empty table"
        )

        with pg_conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM ps_stock_tienda "
                "WHERE talla IS NULL OR TRIM(talla) = ''"
            )
            (bad_rows,) = cur.fetchone()

        assert bad_rows == 0, (
            f"{bad_rows} rows in ps_stock_tienda have empty/NULL talla — "
            "normalization is not filtering them correctly"
        )

    def test_traspasos_count(self, fourd_conn, pg_conn):
        """Full sync of Traspasos: row count in PostgreSQL matches 4D count.

        Requires ALLOW_DESTRUCTIVE_TESTS=1 to protect against accidentally
        running against a non-test database (this test truncates ps_traspasos).
        """
        allow = os.environ.get("ALLOW_DESTRUCTIVE_TESTS", "").strip()
        if allow != "1":
            pytest.skip(
                "Set ALLOW_DESTRUCTIVE_TESTS=1 to run tests that truncate "
                "production tables (test_traspasos_count)"
            )

        conn_pg = pg_conn

        # Truncate before full sync to avoid duplicates from previous test runs.
        with conn_pg.cursor() as cur:
            cur.execute("TRUNCATE ps_traspasos")
        conn_pg.commit()

        attempted = sync_traspasos(fourd_conn, conn_pg, since=None)

        # Verify row count matches source.
        from etl.db.fourd import safe_fetch

        source_rows = safe_fetch(fourd_conn, "SELECT COUNT(*) FROM Traspasos")
        source_count = int(next(iter(source_rows[0].values())))

        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_traspasos")
            (pg_count,) = cur.fetchone()

        assert attempted == pg_count
        assert pg_count == source_count, (
            f"Traspasos count mismatch: 4D has {source_count}, "
            f"PostgreSQL has {pg_count}"
        )
