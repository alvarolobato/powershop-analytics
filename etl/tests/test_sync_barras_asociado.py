"""Unit tests for etl/sync/barras_asociado.py.

No live 4D/PostgreSQL connection is required — safe_fetch(),
get_queryable_columns(), and truncate_and_insert() are patched at their
source modules (etl.db.fourd / etl.db.postgres) since sync_barras_asociado
imports them lazily inside the function body (repo convention — see
etl/sync/maestros.py, etl/sync/ventas.py).
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

from etl.sync.barras_asociado import (
    _BARRAS_DESIRED,
    _BARRAS_MAP,
    _to_decimal,
    sync_barras_asociado,
)


# ---------------------------------------------------------------------------
# _to_decimal
# ---------------------------------------------------------------------------


class TestToDecimal:
    def test_float_converted(self):
        assert _to_decimal(123.456) == Decimal("123.456")

    def test_none_passthrough(self):
        assert _to_decimal(None) is None


# ---------------------------------------------------------------------------
# Mapping shape
# ---------------------------------------------------------------------------


class TestMappingShape:
    def test_desired_columns_all_have_a_mapping(self):
        """Every column we ask 4D for must have somewhere to land in PG —
        a column in _BARRAS_DESIRED but missing from _BARRAS_MAP would be
        silently dropped by the row-mapping loop in sync_barras_asociado."""
        mapped_lower = set(_BARRAS_MAP.keys())
        for col in _BARRAS_DESIRED:
            assert col.lower() in mapped_lower, (
                f"{col} is queried but has no _BARRAS_MAP entry"
            )

    def test_pk_column_mapped(self):
        assert _BARRAS_MAP["regbarras"] == "reg_barras"

    def test_size_resolution_columns_mapped(self):
        # These three are exactly what ps_lineas_ventas_talla (init.sql)
        # needs: the join key (codigo) and the payload (talla).
        assert _BARRAS_MAP["codigo"] == "codigo"
        assert _BARRAS_MAP["talla"] == "talla"
        assert _BARRAS_MAP["numarticulo"] == "num_articulo"


# ---------------------------------------------------------------------------
# sync_barras_asociado — mocked 4D fetch + PG write
# ---------------------------------------------------------------------------


class TestSyncBarrasAsociado:
    def _fake_row(self, **overrides) -> dict:
        row = {
            "regbarras": 12345.001,
            "numarticulo": 987.0,
            "codigo": "8412345678901",
            "talla": "M",
            "ntalla": 3.0,
            "sku": "SKU-M-01",
            "fmodifica": None,
        }
        row.update(overrides)
        return row

    @patch("etl.db.postgres.truncate_and_insert")
    @patch("etl.db.fourd.safe_fetch")
    @patch("etl.db.fourd.get_queryable_columns")
    def test_full_refresh_maps_and_truncate_inserts(
        self, mock_cols, mock_fetch, mock_insert
    ):
        mock_cols.return_value = list(_BARRAS_DESIRED)
        mock_fetch.return_value = [
            self._fake_row(),
            self._fake_row(
                regbarras=12346.001,
                codigo="8412345678902",
                talla="L",
                ntalla=4.0,
                sku="SKU-L-01",
            ),
        ]
        mock_insert.return_value = 2

        conn_4d = MagicMock()
        conn_pg = MagicMock()
        count = sync_barras_asociado(conn_4d, conn_pg)

        assert count == 2
        mock_fetch.assert_called_once()
        # Read-only: the SELECT must not touch other tables or write verbs.
        called_sql = mock_fetch.call_args.args[1]
        assert called_sql.strip().upper().startswith("SELECT")
        assert "BarrasAsociado" in called_sql

        mock_insert.assert_called_once()
        _, table_arg, rows_arg = mock_insert.call_args.args
        assert table_arg == "ps_barras_asociado"
        assert len(rows_arg) == 2

        first = rows_arg[0]
        assert first["reg_barras"] == Decimal("12345.001")
        assert first["num_articulo"] == Decimal("987.0")
        assert first["codigo"] == "8412345678901"
        assert first["talla"] == "M"
        assert first["sku"] == "SKU-M-01"

    @patch("etl.db.postgres.truncate_and_insert")
    @patch("etl.db.fourd.safe_fetch")
    @patch("etl.db.fourd.get_queryable_columns")
    def test_missing_pk_column_aborts_without_writing(
        self, mock_cols, mock_fetch, mock_insert
    ):
        # Simulate a live schema where RegBarras is unexpectedly unqueryable
        # (e.g. DATA_TYPE=0) — must not fall back to inserting PK-less rows.
        mock_cols.return_value = [c for c in _BARRAS_DESIRED if c != "RegBarras"]

        count = sync_barras_asociado(MagicMock(), MagicMock())

        assert count == 0
        mock_fetch.assert_not_called()
        mock_insert.assert_not_called()

    @patch("etl.db.postgres.truncate_and_insert")
    @patch("etl.db.fourd.safe_fetch")
    @patch("etl.db.fourd.get_queryable_columns")
    def test_degrades_gracefully_when_a_column_is_missing(
        self, mock_cols, mock_fetch, mock_insert
    ):
        # SKU absent from the live schema (drift) — sync should still run,
        # querying only the columns that are actually there.
        mock_cols.return_value = [c for c in _BARRAS_DESIRED if c != "SKU"]
        mock_fetch.return_value = [
            {
                "regbarras": 1.001,
                "numarticulo": 2.0,
                "codigo": "X",
                "talla": "S",
                "ntalla": 1.0,
                "fmodifica": None,
            }
        ]
        mock_insert.return_value = 1

        count = sync_barras_asociado(MagicMock(), MagicMock())

        assert count == 1
        called_sql = mock_fetch.call_args.args[1]
        assert "SKU" not in called_sql
        _, _, rows_arg = mock_insert.call_args.args
        assert "sku" not in rows_arg[0]
