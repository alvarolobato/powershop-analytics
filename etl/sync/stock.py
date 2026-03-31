"""ETL sync for stock domain: Exportaciones (ps_stock_tienda) and Traspasos (ps_traspasos).

Exportaciones normalization
---------------------------
The source table is wide-format: one row per (article, store) pair with columns
Talla1..Talla34 and Stock1..Stock34.  Each row is unpivoted into individual
(codigo, tienda_codigo, talla, stock) rows for ps_stock_tienda.

Batch processing is critical: Exportaciones has ~2M source rows.  We fetch in
batches of 1000 source rows (configurable via _SOURCE_BATCH) to avoid loading
the full wide table into memory.  Each batch is normalized and upserted immediately.

TiendaCodigo format: "store_code/article_code" (e.g. "104/169").  It is NOT
just a store code.  The compound PK for ps_stock_tienda is (codigo, tienda_codigo, talla).

Traspasos
---------
Append-only by FechaS.  No modification timestamp.  Use bulk_insert.
"""
from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from etl.db.fourd import safe_fetch
from etl.db.postgres import bulk_insert, upsert

logger = logging.getLogger(__name__)

# Number of source Exportaciones rows to fetch per SQL query (wide format —
# each row expands to ~5 normalized rows on average).
_SOURCE_BATCH = 1000

# Number of normalized rows to upsert per PG call.
_PG_BATCH = 5000

# Column pairs to unpivot.
_MAX_TALLA = 34

# Fixed columns to select from Exportaciones.
_EXPO_FIXED_COLS = ["Codigo", "TiendaCodigo", "Tienda", "CCStock", "STStock", "FechaModifica"]

# Talla + Stock columns in order.
_EXPO_TALLA_COLS = [f"Talla{i}" for i in range(1, _MAX_TALLA + 1)]
_EXPO_STOCK_COLS = [f"Stock{i}" for i in range(1, _MAX_TALLA + 1)]

# Full SELECT column list (original 4D casing, required by 4D SQL).
_EXPO_COLUMNS = ", ".join(_EXPO_FIXED_COLS + _EXPO_TALLA_COLS + _EXPO_STOCK_COLS)


def _build_expo_where(since: datetime | None, *, include_nulls: bool = False) -> str:
    """Return a WHERE clause fragment for Exportaciones delta filtering.

    - since=None: no filter (full load).
    - since=<date>: filter by FechaModifica > {d 'YYYY-MM-DD'}.
    - include_nulls=True: also include rows where FechaModifica IS NULL
      (zero-stock articles that have never been modified).
    """
    if since is None:
        return ""
    date_str = since.strftime("%Y-%m-%d")
    cond = f"FechaModifica > {{d '{date_str}'}}"
    if include_nulls:
        cond = f"({cond} OR FechaModifica IS NULL)"
    return f"WHERE {cond}"


def _count_expo(conn_4d, where: str) -> int:
    """Return row count for Exportaciones with given WHERE clause."""
    sql = f"SELECT COUNT(*) FROM Exportaciones {where}".strip()
    rows = safe_fetch(conn_4d, sql)
    # safe_fetch returns lowercase keys; COUNT(*) is returned as "count(*)"
    # by some 4D versions but the exact key depends on the driver.
    row = rows[0]
    return int(next(iter(row.values())))


def _normalize_expo_row(src: dict) -> list[dict]:
    """Unpivot one wide Exportaciones row into normalized (talla, stock) rows.

    Only emits a row if Talla_i is not None and not an empty/whitespace string.
    """
    out: list[dict] = []
    for i in range(1, _MAX_TALLA + 1):
        talla = src.get(f"talla{i}")
        stock_raw = src.get(f"stock{i}")
        if talla is None or (isinstance(talla, str) and not talla.strip()):
            continue
        talla_str = talla.strip() if isinstance(talla, str) else str(talla)
        stock_val = int(stock_raw) if stock_raw is not None else 0
        cc_stock = src.get("ccstock")
        st_stock = src.get("ststock")
        out.append(
            {
                "codigo": src["codigo"] or "",
                "tienda_codigo": src["tiendacodigo"] or "",
                "tienda": src.get("tienda"),
                "talla": talla_str,
                "stock": stock_val,
                "cc_stock": Decimal(str(cc_stock)) if cc_stock is not None else None,
                "st_stock": Decimal(str(st_stock)) if st_stock is not None else None,
                "fecha_modifica": src.get("fechamodifica"),
            }
        )
    return out


def sync_stock(conn_4d, conn_pg, since: datetime | None = None) -> int:
    """Extract Exportaciones from 4D, normalize, and upsert into ps_stock_tienda.

    Args:
        conn_4d: P4D connection object.
        conn_pg: psycopg2 connection object.
        since: If provided, only fetch rows where FechaModifica > since.
               If None, fetch all rows (initial load).

    Returns:
        Total number of normalized rows upserted.
    """
    # For delta sync include NULLs only on initial load (since=None) to capture
    # zero-stock articles that were never touched.
    include_nulls = since is None

    where = _build_expo_where(since, include_nulls=include_nulls)

    logger.info("sync_stock: counting Exportaciones rows %s", f"({where})" if where else "(full)")
    total_source = _count_expo(conn_4d, where)
    logger.info("sync_stock: %d source rows to process", total_source)

    total_upserted = 0
    offset = 0
    pg_buffer: list[dict] = []

    while offset < total_source:
        # 4D SQL: use LIMIT / OFFSET to page through the table.
        sql = (
            f"SELECT {_EXPO_COLUMNS} FROM Exportaciones "
            f"{where} LIMIT {_SOURCE_BATCH} OFFSET {offset}"
        ).strip()

        batch = safe_fetch(conn_4d, sql)
        if not batch:
            break

        for src_row in batch:
            pg_buffer.extend(_normalize_expo_row(src_row))

        # Flush when buffer reaches PG batch size.
        while len(pg_buffer) >= _PG_BATCH:
            chunk = pg_buffer[:_PG_BATCH]
            pg_buffer = pg_buffer[_PG_BATCH:]
            upserted = upsert(
                conn_pg,
                "ps_stock_tienda",
                chunk,
                pk_cols=["codigo", "tienda_codigo", "talla"],
            )
            total_upserted += upserted
            logger.debug(
                "sync_stock: upserted %d normalized rows (offset %d / %d)",
                upserted,
                offset,
                total_source,
            )

        offset += len(batch)
        logger.info(
            "sync_stock: processed %d / %d source rows (%d normalized rows buffered)",
            offset,
            total_source,
            len(pg_buffer),
        )

    # Flush remaining buffer.
    if pg_buffer:
        upserted = upsert(
            conn_pg,
            "ps_stock_tienda",
            pg_buffer,
            pk_cols=["codigo", "tienda_codigo", "talla"],
        )
        total_upserted += upserted

    logger.info("sync_stock: done — %d normalized rows upserted", total_upserted)
    return total_upserted


# ---------------------------------------------------------------------------
# Traspasos (append-only)
# ---------------------------------------------------------------------------

# Columns to SELECT from Traspasos (explicit list to avoid type-0 columns).
_TRASPASOS_COLUMNS = (
    "RegTraspaso, Codigo, Descripcion, Talla, UnidadesS, UnidadesE, "
    "TiendaSalida, TiendaEntrada, FechaS, FechaE, Tipo, Concepto, Entrada"
)


def _map_traspaso_row(src: dict) -> dict:
    """Map a safe_fetch row (lowercase keys) to ps_traspasos column names.

    4D float PKs are converted to Decimal to preserve the .99 suffix exactly.
    """
    reg = src.get("regtraspaso")
    return {
        "reg_traspaso": Decimal(str(reg)) if reg is not None else None,
        "codigo": src.get("codigo"),
        "descripcion": src.get("descripcion"),
        "talla": src.get("talla"),
        "unidades_s": src.get("unidadess"),
        "unidades_e": src.get("unidadese"),
        "tienda_salida": src.get("tiendasalida"),
        "tienda_entrada": src.get("tiendaentrada"),
        "fecha_s": src.get("fechas"),
        "fecha_e": src.get("fechae"),
        "tipo": src.get("tipo"),
        "concepto": src.get("concepto"),
        "entrada": src.get("entrada"),
    }


def _build_traspasos_where(since: datetime | None) -> str:
    """Return a WHERE clause fragment for Traspasos delta filtering."""
    if since is None:
        return ""
    date_str = since.strftime("%Y-%m-%d")
    return f"WHERE FechaS > {{d '{date_str}'}}"


def sync_traspasos(conn_4d, conn_pg, since: datetime | None = None) -> int:
    """Extract Traspasos from 4D and append-insert into ps_traspasos.

    Traspasos is append-only by FechaS.  Records are immutable once created.

    Args:
        conn_4d: P4D connection object.
        conn_pg: psycopg2 connection object.
        since: If provided, only fetch rows where FechaS > since.
               If None, fetch all rows (initial load).

    Returns:
        Total number of rows inserted.
    """
    where = _build_traspasos_where(since)
    sql = f"SELECT {_TRASPASOS_COLUMNS} FROM Traspasos {where}".strip()

    logger.info("sync_traspasos: fetching rows %s", f"({where})" if where else "(full)")
    rows = safe_fetch(conn_4d, sql)
    logger.info("sync_traspasos: %d rows fetched", len(rows))

    if not rows:
        return 0

    mapped = [_map_traspaso_row(r) for r in rows]

    # Insert in batches to avoid single huge transaction.
    total_inserted = 0
    for start in range(0, len(mapped), _PG_BATCH):
        chunk = mapped[start : start + _PG_BATCH]
        inserted = bulk_insert(conn_pg, "ps_traspasos", chunk)
        total_inserted += inserted
        logger.debug("sync_traspasos: inserted batch of %d rows", inserted)

    logger.info("sync_traspasos: done — %d rows inserted", total_inserted)
    return total_inserted
