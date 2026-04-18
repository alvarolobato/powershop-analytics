"""4D SQL (P4D) connection helpers.

Gotchas handled here:
- Column names are returned as BYTES by the p4d driver (e.g. b'REGARTICULO').
  safe_fetch() decodes them to lowercase str so callers always work with str keys.
- Text fields may return bytes in Python 3.13+ — always decode.
- Column names are returned UPPERCASE from 4D — normalize to lowercase.
- Some columns have type 0 (unknown to p4d); SELECT * on those tables raises
  "Unrecognized 4D type: 0". Use get_queryable_columns() to filter them out.
- PKs are REAL (float) with a .99 suffix — returned as Python float.
  WARNING: floats must be converted to decimal.Decimal before inserting into
  the NUMERIC pk columns in PostgreSQL to avoid precision loss (e.g. 10028816.641
  stored as a float may round incorrectly).  Sync modules are responsible for
  this conversion.
- None values are passed through unchanged.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from etl.config import Config

# Allowlist pattern for 4D table/column names (letters, digits, underscores).
# 4D table names in this project follow this pattern; reject anything that
# does not match to prevent SQL injection via get_queryable_columns().
_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate_identifier(name: str) -> str:
    """Raise ValueError if *name* is not a safe SQL identifier."""
    if not _SAFE_IDENTIFIER_RE.match(name):
        raise ValueError(
            f"Unsafe SQL identifier: {name!r}. "
            "Only letters, digits, and underscores are allowed."
        )
    return name


def get_connection(config: "Config"):  # type: ignore[return]
    """Return a p4d connection using the supplied Config.

    Raises ImportError if p4d is not installed.
    Raises an appropriate connection error if the server is unreachable.
    """
    try:
        import p4d  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError("p4d package is not installed. Run: pip install p4d") from exc

    return p4d.connect(
        host=config.p4d_host,
        port=config.p4d_port,
        user=config.p4d_user,
        password=config.p4d_password,
    )


def _decode_value(v: Any) -> Any:
    """Decode bytes to str and strip NUL characters; pass other types through.

    PostgreSQL rejects string literals containing NUL (0x00) characters with
    "A string literal cannot contain NUL (0x00) characters."  Some 4D text
    fields contain embedded NUL bytes (e.g. padding in fixed-length fields or
    corrupted data).  Stripping them here is the safest fix — NUL bytes carry
    no semantic meaning in these text fields.
    """
    if isinstance(v, bytes):
        decoded = v.decode("utf-8", errors="replace")
        return decoded.replace("\x00", "")
    if isinstance(v, str):
        # Also strip NUL from native str values (p4d may return str with NUL).
        return v.replace("\x00", "") if "\x00" in v else v
    return v


def _decode_column_name(name: Any) -> str:
    """Decode a cursor description column name to a lowercase str.

    p4d returns column names as bytes (e.g. b'REGARTICULO').  Decoding here
    keeps all callers simple — they always receive plain str keys.
    """
    if isinstance(name, bytes):
        return name.decode("utf-8", errors="replace").lower()
    return str(name).lower()


def safe_fetch(conn, sql: str) -> list[dict]:
    """Execute *sql* and return a list of dicts with lowercase str keys.

    - Column names are decoded from bytes to str and lowercased (p4d returns
      them as uppercase bytes, e.g. b'REGARTICULO' → 'regarticulo').
    - Decodes bytes values to str.
    - None values are preserved.
    - The cursor is always closed after fetching.
    """
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        if cursor.description is None:
            raise RuntimeError(
                f"Query returned no column metadata (non-SELECT or p4d quirk): {sql[:200]}"
            )
        columns = [_decode_column_name(desc[0]) for desc in cursor.description]
        rows = cursor.fetchall()
    finally:
        cursor.close()
    return [dict(zip(columns, (_decode_value(v) for v in row))) for row in rows]


def get_queryable_columns(conn, table_name: str) -> list[str]:
    """Return column names for *table_name* where DATA_TYPE != 0.

    4D type 0 columns are not understood by p4d and cause "Unrecognized 4D
    type: 0" errors on SELECT.  Filtering them out here lets callers build
    safe explicit column lists.

    The returned names use the original casing from _USER_COLUMNS (which
    matches what 4D expects in SQL statements).

    *table_name* is validated against a safe-identifier pattern to prevent
    SQL injection (p4d does not support parameterised queries on system tables).
    """
    _validate_identifier(table_name)
    sql = (
        f"SELECT COLUMN_NAME FROM _USER_COLUMNS "
        f"WHERE TABLE_NAME = '{table_name}' AND DATA_TYPE <> 0"
    )
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        return [row[0] for row in cursor.fetchall()]
    finally:
        cursor.close()
