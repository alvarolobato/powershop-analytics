"""4D SQL (P4D) connection helpers.

Gotchas handled here:
- Text fields may return bytes in Python 3.13+ — always decode.
- Column names are returned UPPERCASE from 4D — normalize to lowercase.
- Some columns have type 0 (unknown to p4d); SELECT * on those tables raises
  "Unrecognized 4D type: 0". Use get_queryable_columns() to filter them out.
- PKs are REAL (float) with a .99 suffix — returned as float, preserved as-is.
- None values are passed through unchanged.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from etl.config import Config


def get_connection(config: "Config"):  # type: ignore[return]
    """Return a p4d connection using the supplied Config.

    Raises ImportError if p4d is not installed.
    Raises an appropriate connection error if the server is unreachable.
    """
    try:
        import p4d  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "p4d package is not installed. Run: pip install p4d"
        ) from exc

    return p4d.connect(
        host=config.p4d_host,
        port=config.p4d_port,
        user=config.p4d_user,
        password=config.p4d_password,
    )


def _decode_value(v: Any) -> Any:
    """Decode bytes to str; pass all other types through unchanged."""
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v


def safe_fetch(conn, sql: str) -> list[dict]:
    """Execute *sql* and return a list of dicts with lowercase keys.

    - Decodes bytes values to str.
    - None values are preserved.
    - Column names are normalised to lowercase (4D returns them uppercase).
    """
    cursor = conn.cursor()
    cursor.execute(sql)
    columns = [desc[0].lower() for desc in cursor.description]
    rows = cursor.fetchall()
    return [dict(zip(columns, (_decode_value(v) for v in row))) for row in rows]


def get_queryable_columns(conn, table_name: str) -> list[str]:
    """Return column names for *table_name* where DATA_TYPE != 0.

    4D type 0 columns are not understood by p4d and cause "Unrecognized 4D
    type: 0" errors on SELECT.  Filtering them out here lets callers build
    safe explicit column lists.

    The returned names use the original casing from _USER_COLUMNS (which
    matches what 4D expects in SQL statements).
    """
    sql = (
        f"SELECT COLUMN_NAME FROM _USER_COLUMNS "
        f"WHERE TABLE_NAME = '{table_name}' AND DATA_TYPE != 0"
    )
    cursor = conn.cursor()
    cursor.execute(sql)
    return [row[0] for row in cursor.fetchall()]
