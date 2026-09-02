"""Tests for etl/sync/ventas.py::_backfill_entrada_desde_cabecera.

Context: `ps_lineas_ventas.entrada` is the venta/devolucion discriminator at
line level. It agrees with the sale header 100 % where it exists, but 4D leaves
it NULL on a handful of lines — 34 of 463,335 over the last two years (August
2026, 550,61 EUR). Re-fetching does not help: the source itself is empty there.

Those few rows were expensive out of all proportion. Any query needing the
sign had to re-join `ps_ventas` — a 977 K-row hash join costing ~1.9 s each,
which was half the query budget of the home page (#961). Backfilling the
column from the header lets the sign be resolved on the line itself, and the
join disappears from seven queries.

The repair runs in its own transaction: a failure here must never undo the
rows the sync just loaded, and must never abort the sync.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from etl.sync.ventas import _backfill_entrada_desde_cabecera


def _conn_with_cursor(rowcount: int = 0) -> tuple[MagicMock, MagicMock]:
    """Build a psycopg2-shaped connection mock and return (conn, cursor)."""
    cur = MagicMock()
    cur.rowcount = rowcount
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    return conn, cur


class TestBackfillEntrada:
    def test_only_fills_null_rows_from_the_header(self):
        """The UPDATE must be narrow: NULL lines only, never touching good rows."""
        conn, cur = _conn_with_cursor(rowcount=34)

        filled = _backfill_entrada_desde_cabecera(conn)

        assert filled == 34
        sql = " ".join(cur.execute.call_args[0][0].split())
        # Joins the line to its own header...
        assert "UPDATE ps_lineas_ventas lv" in sql
        assert "FROM ps_ventas v" in sql
        assert "lv.num_ventas = v.reg_ventas" in sql
        # ...and only ever writes rows that have no value yet. Without this
        # predicate the repair would rewrite 1.6M rows on every single sync.
        assert "lv.entrada IS NULL" in sql
        # A header that is itself NULL has nothing to contribute.
        assert "v.entrada IS NOT NULL" in sql
        conn.commit.assert_called_once()

    def test_commits_even_when_nothing_to_fill(self):
        """The steady state is zero rows; that is success, not a no-op to skip."""
        conn, _ = _conn_with_cursor(rowcount=0)

        assert _backfill_entrada_desde_cabecera(conn) == 0
        conn.commit.assert_called_once()
        conn.rollback.assert_not_called()

    def test_failure_rolls_back_and_never_raises(self):
        """A failed repair must not take the freshly-loaded rows down with it.

        The sync has already committed real data by this point. Matches the
        safety-net DELETE in sync_articulos: log it, roll back, carry on.
        """
        conn, cur = _conn_with_cursor()
        cur.execute.side_effect = RuntimeError("deadlock detected")

        assert _backfill_entrada_desde_cabecera(conn) == 0
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
