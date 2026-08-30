"""Integration tests for etl/sync/mayorista.py.

All tests require both a live 4D connection (P4D_HOST set) and a live
PostgreSQL connection.  They are skipped automatically when either is
unavailable so CI without external access passes cleanly.

What is tested:
- TestMayoristaGteFix: Unit tests asserting all delta SQL templates use >= (issue #459).
- TestLineParentJoinKey: Unit tests (no DB) pinning the line→header join key to
  the 4D record ID (RegAlbaran / RegFactura), not the visible document number.
  These fail against the pre-2026-08-29 code.
- test_gc_albaranes_count: Row count in ps_gc_albaranes matches 4D source.
- test_gc_facturas_count:  Row count in ps_gc_facturas matches 4D source.
- test_gc_lin_albarane_fk: All num_albaran values in ps_gc_lin_albarane exist
                           in ps_gc_albaranes.reg_albaran (FK integrity check).
- test_gc_pedidos_count:   Row count in ps_gc_pedidos is approximately 101.
"""

from __future__ import annotations

import os

import pytest


# ---------------------------------------------------------------------------
# Unit tests (no external connections required)
# ---------------------------------------------------------------------------


class TestMayoristaGteFix:
    """Ensure all mayorista delta SQL templates use >= not > (issue #459).

    Strict `>` silently skips rows with Modifica == today once the watermark
    advances to today. `>=` re-fetches those rows; upsert/delete-reinsert is
    idempotent so there is no correctness risk.
    """

    def test_albaranes_delta_uses_gte(self):
        from etl.sync.mayorista import _SQL_ALBARANES_DELTA

        assert "Modifica >= {since}" in _SQL_ALBARANES_DELTA
        assert "Modifica > {since}" not in _SQL_ALBARANES_DELTA

    def test_lin_albarane_parent_ids_uses_gte(self):
        from etl.sync.mayorista import _SQL_LIN_ALBARANE_PARENT_IDS

        assert "Modifica >= {since}" in _SQL_LIN_ALBARANE_PARENT_IDS
        assert "Modifica > {since}" not in _SQL_LIN_ALBARANE_PARENT_IDS

    def test_facturas_delta_uses_gte(self):
        from etl.sync.mayorista import _SQL_FACTURAS_DELTA

        assert "Modifica >= {since}" in _SQL_FACTURAS_DELTA
        assert "Modifica > {since}" not in _SQL_FACTURAS_DELTA

    def test_lin_facturas_parent_ids_uses_gte(self):
        from etl.sync.mayorista import _SQL_LIN_FACTURAS_PARENT_IDS

        assert "Modifica >= {since}" in _SQL_LIN_FACTURAS_PARENT_IDS
        assert "Modifica > {since}" not in _SQL_LIN_FACTURAS_PARENT_IDS


class TestLineParentJoinKey:
    """Pin the GC line→header join key to the 4D record ID (2026-08-29 fix).

    The delta path for GCLinAlbarane / GCLinFacturas derives its parent IDs
    from the header table and then filters the line table by them.  It used
    the *visible* document numbers (NAlbaran / NFactura), which is wrong on
    both counts, measured against production 4D on 2026-08-29:

      GCLinFacturas.NumFactura -> GCFacturas.RegFactura : 4000/4000
      GCLinFacturas.NumFactura -> GCFacturas.NFactura   :    0/4000
      GCLinAlbarane.NumAlbaran -> GCAlbaranes.RegAlbaran: 4000/4000
      GCLinAlbarane.NumAlbaran -> GCAlbaranes.NAlbaran  :    0/4000

    and the visible numbers are not unique (52,148 GCAlbaranes rows carry only
    40,727 distinct NAlbaran values), so joining on them mixes lines from
    unrelated documents.  Every assertion below fails against the old code.
    """

    def test_albarane_parent_ids_select_reg_albaran(self):
        from etl.sync.mayorista import _SQL_LIN_ALBARANE_PARENT_IDS

        assert "SELECT RegAlbaran FROM GCAlbaranes" in _SQL_LIN_ALBARANE_PARENT_IDS
        assert "SELECT NAlbaran FROM GCAlbaranes" not in _SQL_LIN_ALBARANE_PARENT_IDS

    def test_albarane_lines_filter_on_num_albaran(self):
        from etl.sync.mayorista import _SQL_LIN_ALBARANE_BY_PARENT

        assert "WHERE NumAlbaran IN ({placeholders})" in _SQL_LIN_ALBARANE_BY_PARENT
        assert "WHERE NAlbaran IN" not in _SQL_LIN_ALBARANE_BY_PARENT

    def test_facturas_parent_ids_select_reg_factura(self):
        from etl.sync.mayorista import _SQL_LIN_FACTURAS_PARENT_IDS

        assert "SELECT RegFactura FROM GCFacturas" in _SQL_LIN_FACTURAS_PARENT_IDS
        assert "SELECT NFactura FROM GCFacturas" not in _SQL_LIN_FACTURAS_PARENT_IDS

    def test_facturas_lines_filter_on_num_factura(self):
        from etl.sync.mayorista import _SQL_LIN_FACTURAS_BY_PARENT

        assert "WHERE NumFactura IN ({placeholders})" in _SQL_LIN_FACTURAS_BY_PARENT

    def test_lin_albarane_delta_uses_record_id_end_to_end(self):
        """Drive sync_gc_lin_albarane with fakes and inspect every statement.

        Headers deliberately reuse one visible NAlbaran across two different
        RegAlbaran values — the exact shape that makes the old key both miss
        and over-collect.
        """
        from datetime import datetime

        from etl.sync import mayorista

        headers = [
            {"regalbaran": 1001.99, "nalbaran": 500.0},
            {"regalbaran": 1002.99, "nalbaran": 500.0},
        ]
        lines = [
            {"reglinea": 9001.99, "nalbaran": 500.0, "numalbaran": 1001.99},
            {"reglinea": 9002.99, "nalbaran": 500.0, "numalbaran": 1002.99},
        ]
        recorder = _FakeSync(mayorista, headers, lines, "GCLinAlbarane")

        with recorder:
            count = mayorista.sync_gc_lin_albarane(
                object(), recorder.pg, since=datetime(2026, 6, 1)
            )

        parent_sql, lines_sql = recorder.fourd_queries
        assert "SELECT RegAlbaran FROM GCAlbaranes" in parent_sql
        # The IN list must carry the record IDs, never the visible numbers.
        assert "1001.99" in lines_sql and "1002.99" in lines_sql
        assert "NumAlbaran IN" in lines_sql
        delete_sql, delete_params = recorder.pg.cursor_obj.deletes[0]
        assert "num_albaran = ANY" in delete_sql
        assert [str(v) for v in delete_params[0]] == ["1001.99", "1002.99"]
        assert count == 2

    def test_lin_facturas_delta_uses_record_id_end_to_end(self):
        """Same end-to-end check for invoices (the table that broke hardest)."""
        from datetime import datetime

        from etl.sync import mayorista

        headers = [
            {"regfactura": 2001.99, "nfactura": 700.0},
            {"regfactura": 2002.99, "nfactura": 700.0},
        ]
        lines = [
            {"reglinea": 8001.99, "numfactura": 2001.99},
            {"reglinea": 8002.99, "numfactura": 2002.99},
        ]
        recorder = _FakeSync(mayorista, headers, lines, "GCLinFacturas")

        with recorder:
            count = mayorista.sync_gc_lin_facturas(
                object(), recorder.pg, since=datetime(2026, 6, 1)
            )

        parent_sql, lines_sql = recorder.fourd_queries
        assert "SELECT RegFactura FROM GCFacturas" in parent_sql
        assert "2001.99" in lines_sql and "2002.99" in lines_sql
        # 700.0 is the visible NFactura — it must never reach the line query.
        assert "700" not in lines_sql
        assert "NumFactura IN" in lines_sql
        delete_sql, delete_params = recorder.pg.cursor_obj.deletes[0]
        assert "num_factura = ANY" in delete_sql
        assert [str(v) for v in delete_params[0]] == ["2001.99", "2002.99"]
        assert count == 2


# ---------------------------------------------------------------------------
# Test doubles for TestLineParentJoinKey (no 4D / PostgreSQL needed)
# ---------------------------------------------------------------------------


class _FakeCursor:
    """Records DELETEs and swallows the execute_values INSERT."""

    def __init__(self):
        self.deletes: list[tuple[str, tuple]] = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if "DELETE" in sql.upper():
            self.deletes.append((sql, params))

    def mogrify(self, sql, args=None):  # used by psycopg2.extras.execute_values
        return sql.encode() if isinstance(sql, str) else sql


class _FakePgConn:
    def __init__(self):
        self.cursor_obj = _FakeCursor()
        self.committed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def rollback(self):  # pragma: no cover - only on failure paths
        pass


class _RenderedSql:
    """A composed statement that stringifies without a live connection."""

    def __init__(self, text: str):
        self.text = text

    def __str__(self) -> str:
        return self.text

    def as_string(self, _context) -> str:
        return self.text


class _StubSqlModule:
    """Stand-in for psycopg2.sql.

    The real one needs a live connection to quote identifiers (quote_ident
    calls into libpq), which a fake cursor cannot provide.  The INSERT is not
    what these tests are about — the join key is — so rendering it naively is
    enough.
    """

    class SQL:
        def __init__(self, template: str):
            self.template = template

        def format(self, **kwargs):
            return _RenderedSql(
                self.template.format(**{k: str(v) for k, v in kwargs.items()})
            )

        def join(self, parts):
            return _RenderedSql(self.template.join(str(p) for p in parts))

    class Identifier:
        def __init__(self, *names: str):
            self.names = names

        def __str__(self) -> str:
            return '"' + '"."'.join(self.names) + '"'


class _FakeSync:
    """Patch safe_fetch, psycopg2.sql and execute_values to run offline."""

    def __init__(self, module, headers, lines, line_table):
        self.module = module
        self.headers = headers
        self.lines = lines
        self.line_table = line_table
        self.pg = _FakePgConn()
        self.fourd_queries: list[str] = []

    def _safe_fetch(self, conn, sql, **kwargs):  # noqa: ARG002
        self.fourd_queries.append(sql)
        return self.lines if self.line_table in sql else self.headers

    def __enter__(self):
        import psycopg2  # type: ignore[import-untyped]
        import psycopg2.extras  # type: ignore[import-untyped]
        import psycopg2.sql  # noqa: F401  (binds the submodule attribute)

        self._orig_fetch = self.module.safe_fetch
        self._orig_values = psycopg2.extras.execute_values
        self._orig_sql = psycopg2.sql
        self.module.safe_fetch = self._safe_fetch
        psycopg2.extras.execute_values = lambda *a, **k: None
        psycopg2.sql = _StubSqlModule
        return self

    def __exit__(self, *exc):
        import psycopg2  # type: ignore[import-untyped]
        import psycopg2.extras  # type: ignore[import-untyped]
        import psycopg2.sql  # noqa: F401  (binds the submodule attribute)

        self.module.safe_fetch = self._orig_fetch
        psycopg2.extras.execute_values = self._orig_values
        psycopg2.sql = self._orig_sql
        return False


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
def synced_mayorista(conn_4d, conn_pg):
    """Run all six GC sync functions (initial load) and return row counts.

    Module-scoped so the expensive full loads run only once across all tests.

    Returns a dict mapping table name to synced row count.
    """
    from etl.sync.mayorista import (
        sync_gc_albaranes,
        sync_gc_facturas,
        sync_gc_lin_albarane,
        sync_gc_lin_facturas,
        sync_gc_lin_pedidos,
        sync_gc_pedidos,
    )

    counts: dict[str, int] = {}
    # Headers first (lines depend on them for FK check)
    counts["ps_gc_albaranes"] = sync_gc_albaranes(conn_4d, conn_pg, since=None)
    counts["ps_gc_facturas"] = sync_gc_facturas(conn_4d, conn_pg, since=None)
    counts["ps_gc_lin_albarane"] = sync_gc_lin_albarane(conn_4d, conn_pg, since=None)
    counts["ps_gc_lin_facturas"] = sync_gc_lin_facturas(conn_4d, conn_pg, since=None)
    counts["ps_gc_pedidos"] = sync_gc_pedidos(conn_4d, conn_pg)
    counts["ps_gc_lin_pedidos"] = sync_gc_lin_pedidos(conn_4d, conn_pg)
    return counts


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSyncMayorista:
    def test_gc_albaranes_count(self, conn_4d, conn_pg, synced_mayorista):
        """Row count in ps_gc_albaranes must match the 4D GCAlbaranes table."""
        from etl.db.fourd import safe_fetch

        rows = safe_fetch(conn_4d, "SELECT COUNT(*) AS cnt FROM GCAlbaranes")
        source_count = int(rows[0]["cnt"])

        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_gc_albaranes")
            pg_count = cur.fetchone()[0]

        assert pg_count == source_count, (
            f"ps_gc_albaranes has {pg_count} rows but 4D GCAlbaranes has {source_count}"
        )
        assert synced_mayorista["ps_gc_albaranes"] == source_count

    def test_gc_facturas_count(self, conn_4d, conn_pg, synced_mayorista):
        """Row count in ps_gc_facturas must match the 4D GCFacturas table."""
        from etl.db.fourd import safe_fetch

        rows = safe_fetch(conn_4d, "SELECT COUNT(*) AS cnt FROM GCFacturas")
        source_count = int(rows[0]["cnt"])

        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_gc_facturas")
            pg_count = cur.fetchone()[0]

        assert pg_count == source_count, (
            f"ps_gc_facturas has {pg_count} rows but 4D GCFacturas has {source_count}"
        )
        assert synced_mayorista["ps_gc_facturas"] == source_count

    def test_gc_lin_albarane_fk(self, conn_pg, synced_mayorista):  # noqa: ARG002
        """Every num_albaran in ps_gc_lin_albarane must exist as a reg_albaran.

        This validates the real FK: GCLinAlbarane.NumAlbaran →
        GCAlbaranes.RegAlbaran (the 4D record ID, despite the "Num" name).
        Orphan lines would indicate a data integrity problem or wrong join key.
        """
        with conn_pg.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM ps_gc_lin_albarane la
                WHERE la.num_albaran IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ps_gc_albaranes a
                      WHERE a.reg_albaran = la.num_albaran
                  )
                """
            )
            orphan_count = cur.fetchone()[0]

        assert orphan_count == 0, (
            f"{orphan_count} rows in ps_gc_lin_albarane have num_albaran values "
            "not found in ps_gc_albaranes.reg_albaran.  Check the join key."
        )

    def test_gc_lin_facturas_fk(self, conn_pg, synced_mayorista):  # noqa: ARG002
        """Every num_factura in ps_gc_lin_facturas must exist as a reg_factura.

        GCLinFacturas.NumFactura → GCFacturas.RegFactura.  Measured on
        production 2026-08-29: 4000/4000 lines resolve against RegFactura and
        0/4000 against NFactura.
        """
        with conn_pg.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM ps_gc_lin_facturas lf
                WHERE lf.num_factura IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ps_gc_facturas f
                      WHERE f.reg_factura = lf.num_factura
                  )
                """
            )
            orphan_count = cur.fetchone()[0]

        assert orphan_count == 0, (
            f"{orphan_count} rows in ps_gc_lin_facturas have num_factura values "
            "not found in ps_gc_facturas.reg_factura.  Check the join key."
        )

    def test_gc_lin_facturas_delta_fetches_lines(self, conn_4d, conn_pg):
        """A delta over a window with modified invoices must return lines.

        The pre-2026-08-29 bug made this return 0 forever: parent IDs were
        taken from GCFacturas.NFactura, which shares no values with
        GCLinFacturas.NumFactura, so `WHERE NumFactura IN (...)` matched
        nothing on every nightly run.
        """
        from datetime import datetime, timedelta

        from etl.db.fourd import safe_fetch
        from etl.sync.mayorista import sync_gc_lin_facturas

        since = datetime.now() - timedelta(days=90)
        parents = safe_fetch(
            conn_4d,
            "SELECT COUNT(*) AS cnt FROM GCFacturas"
            f" WHERE Modifica >= {{d '{since.strftime('%Y-%m-%d')}'}}",
        )
        if int(parents[0]["cnt"] or 0) == 0:
            pytest.skip("no GCFacturas modified in the last 90 days")

        inserted = sync_gc_lin_facturas(conn_4d, conn_pg, since=since)
        assert inserted > 0, (
            "delta sync of GCLinFacturas re-inserted 0 lines although invoice "
            "headers were modified in the window — the line→header join key is "
            "wrong again (must be RegFactura, not NFactura)"
        )

    def test_gc_pedidos_count(self, conn_4d, conn_pg, synced_mayorista):
        """Row count in ps_gc_pedidos should approximately match 4D (expected ~101)."""
        from etl.db.fourd import safe_fetch

        rows = safe_fetch(conn_4d, "SELECT COUNT(*) AS cnt FROM GCPedidos")
        source_count = int(rows[0]["cnt"])

        with conn_pg.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ps_gc_pedidos")
            pg_count = cur.fetchone()[0]

        assert pg_count == source_count, (
            f"ps_gc_pedidos has {pg_count} rows but 4D GCPedidos has {source_count}"
        )
        assert synced_mayorista["ps_gc_pedidos"] == source_count
        # Sanity-check the known approximate size (101 rows as of 2026-03-30)
        assert source_count <= 500, (
            f"GCPedidos has {source_count} rows — far more than the expected ~101. "
            "Verify the table is still a small orders table."
        )
