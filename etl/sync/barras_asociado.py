"""Full-refresh sync for BarrasAsociado -> ps_barras_asociado.

Why this table exists in the mirror (D-048, "de este artículo qué talla se
vende más")
------------------------------------------------------------------------
LineasVentas (retail sales lines) has no general-purpose size column — its
only "talla"-shaped field, CCOPTallaOjo, is optics-specific. BarrasAsociado
is the only place in the 4D schema that carries a general size label
(`Talla`) reachable from a sale line, via a barcode pairing: it maps
additional EAN barcodes to an article (docs/architecture/stock-logistics.md
already documented this — "supplements Articulos.CodigoBarra by mapping
multiple EAN barcodes to a single article, e.g. different size barcodes").
In practice that means roughly one row per (article, size) variant.

ps_lineas_ventas_talla (etl/schema/init.sql) joins sale lines to this table
on `codigo_asociado = codigo` to resolve a size per line. See
docs/decisions/D-048-sales-by-size.md for the full rationale, including why
that join key is a hypothesis (naming pairing with this table) rather than
a confirmed fact — `ps sql verify-talla-join` is the one-command way to
settle it against the live 4D server.

Why full refresh, not delta
----------------------------
Small table (~64K rows per docs/architecture/stock-logistics.md). FModifica
exists on the live column list, so a delta strategy is *possible* in
principle, but at this size the ETL follows the same call this schema
already makes for ps_tiendas/ps_proveedores/ps_gc_comerciales: the added
complexity of watermark tracking isn't worth it for a table this cheap to
reload in full every run. Revisit if BarrasAsociado ever grows into the
hundreds of thousands of rows.

Column-name mapping convention
-------------------------------
safe_fetch()/get_queryable_columns() return/expect 4D column names; safe_fetch
lowercases returned keys. The mapping dict below translates from lowercase 4D
names to the PostgreSQL snake_case column names used in init.sql.

PK precision
------------
RegBarras is assumed to follow the same Real-with-.99-suffix convention as
every other Reg* PK in this schema (never independently re-verified for this
specific table — see the caveat on ps_barras_asociado in init.sql). Converted
to Decimal before insertion to avoid binary-float precision loss, same as
every other PK/FK in this ETL.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)


def _to_decimal(value: Any) -> Decimal | None:
    """Convert a float PK/FK value to Decimal; pass None through unchanged."""
    if value is None:
        return None
    return Decimal(str(value))


# Mapping from lowercase 4D column names -> PostgreSQL column names
# (ps_barras_asociado, init.sql).
_BARRAS_MAP: dict[str, str] = {
    "regbarras": "reg_barras",
    "numarticulo": "num_articulo",
    "codigo": "codigo",  # the size-specific EAN/barcode — see module docstring
    "talla": "talla",
    "ntalla": "n_talla",
    "sku": "sku",
    "fmodifica": "fecha_modifica",
}

# Preferred 4D column names to query (original casing required in SQL).
# Intersected against the live queryable columns at call time so a schema
# drift on the 4D side degrades gracefully instead of raising.
_BARRAS_DESIRED = [
    "RegBarras",
    "NumArticulo",
    "Codigo",
    "Talla",
    "NTalla",
    "SKU",
    "FModifica",
]


def sync_barras_asociado(conn_4d: Any, conn_pg: Any) -> int:
    """Full-refresh sync of BarrasAsociado -> ps_barras_asociado.

    Args:
        conn_4d: Open p4d connection to the 4D server.
        conn_pg: Open psycopg2 connection to PostgreSQL.

    Returns:
        The number of rows inserted (== live BarrasAsociado row count).

    Notes:
        - Only queries columns confirmed queryable via get_queryable_columns()
          (DATA_TYPE <> 0) and present in _BARRAS_DESIRED, so a 4D-side schema
          change that drops or renames a column degrades to a smaller mirror
          row instead of failing the whole sync.
        - No FK constraint to ps_articulos(reg_articulo) — same rationale as
          the retail-sales FK omission in init.sql (a timing race between
          this sync and articulos/lineas_ventas full refreshes; this is a
          read-only analytics mirror, integrity is enforced by the 4D source).
    """
    from etl.db.fourd import get_queryable_columns, safe_fetch
    from etl.db.postgres import truncate_and_insert

    safe_cols = set(get_queryable_columns(conn_4d, "BarrasAsociado"))
    cols_to_query = [c for c in _BARRAS_DESIRED if c in safe_cols]

    if not cols_to_query:
        logger.error(
            "sync_barras_asociado: no queryable columns found in "
            "BarrasAsociado — aborting"
        )
        return 0
    if "RegBarras" not in cols_to_query:
        logger.error(
            "sync_barras_asociado: required PK column RegBarras not "
            "available in BarrasAsociado — aborting to avoid violating "
            "ps_barras_asociado.reg_barras PRIMARY KEY"
        )
        return 0

    sql = f"SELECT {', '.join(cols_to_query)} FROM BarrasAsociado"
    logger.info("sync_barras_asociado: querying 4D — %s", sql)
    rows_4d = safe_fetch(conn_4d, sql, guard_pk="regbarras")
    logger.info("sync_barras_asociado: fetched %d rows from 4D", len(rows_4d))

    pg_rows: list[dict] = []
    for row in rows_4d:
        mapped: dict[str, Any] = {}
        for fourd_key_lower, pg_key in _BARRAS_MAP.items():
            if fourd_key_lower in row:
                v = row[fourd_key_lower]
                if pg_key in ("reg_barras", "num_articulo"):
                    v = _to_decimal(v)
                mapped[pg_key] = v
        pg_rows.append(mapped)

    count = truncate_and_insert(conn_pg, "ps_barras_asociado", pg_rows)
    logger.info("sync_barras_asociado: inserted %d rows into ps_barras_asociado", count)
    return count
