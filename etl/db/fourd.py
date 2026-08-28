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
- **Signed 16-bit integers over SQL** (``_USER_COLUMNS`` type **3**, length **2** —
  e.g. all ``Exportaciones.Stock1``…``Stock34``): the SQL/p4d path may widen the
  bit pattern as unsigned (``65535`` for ``-1``). Call ``decode_signed_int16_word()``
  **only** for those columns (rule: **metadata** says 16-bit integer, not guesswork).
  Do **not** apply to ``DATA_TYPE = 6`` (Real) columns such as ``LineasVentas.Unidades``.
- **Fetch-anomaly guard (D-051)**: ``safe_fetch()`` scans every fetch for rows
  that look like p4d row-decode corruption (all-NULL rows, a NULL primary
  key, or a non-finite float) and, if found, re-executes the query once to
  discriminate a transient glitch from real source data before returning.
  See ``scan_rows_for_anomalies()``, ``drain_anomaly_log()``, and
  ``docs/decisions/D-051-fetch-anomaly-guard.md``.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from etl.config import Config

logger = logging.getLogger(__name__)

# Allowlist pattern for 4D table/column names (letters, digits, underscores).
# 4D table names in this project follow this pattern; reject anything that
# does not match to prevent SQL injection via get_queryable_columns().
_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# Integer strings (optional leading minus) for WORD decode coercion.
_SIGNED_INT16_DECIMAL_STR = re.compile(r"-?\d+$")


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


def decode_signed_int16_word(value: Any) -> Any:
    """Map an unsigned 32-bit carrier of a **signed int16** bit pattern to Python ``int``.

    This is **not** a business heuristic: integers in ``32768..65535`` are exactly
    the unsigned widening of signed int16 negatives (``65535`` → ``-1``, etc.) —
    reinterpret the low 16 bits as two's-complement signed.

    **When to call:** only for 4D columns that ``_USER_COLUMNS`` declares as
    **``DATA_TYPE = 3``** and **``DATA_LENGTH = 2``** (16-bit integer). In this
    project that is **exclusively** ``Exportaciones.Stock1``…``Stock34`` (verified
    on production). Do **not** call for ``DATA_TYPE = 6`` (Real) fields.

    The SQL/p4d stack sometimes delivers small negatives in those 16-bit slots
    as ``65535``, ``65534``, etc.

    Args:
        value: Raw value from ``safe_fetch`` (``int``, whole ``float``, ``Decimal``, ``str``, …).

    Returns:
        Values in ``32768..65535`` become signed ``int`` (``-32768..-1``).
        Finite integral ``Decimal`` outside that band becomes ``int`` with the same
        numeric value. ``None``, booleans, non-numeric strings, and fractional
        ``float`` / ``Decimal`` are unchanged. ``int`` outside the decode band is
        unchanged; whole ``float`` outside the band is returned as the original
        ``float``.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        s = value.strip()
        if _SIGNED_INT16_DECIMAL_STR.fullmatch(s):
            value = int(s)
        else:
            return value
    if isinstance(value, int):
        if 32768 <= value <= 65535:
            return value - 65536
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return value
        if not value.is_integer():
            return value
        iv = int(value)
        if 32768 <= iv <= 65535:
            return iv - 65536
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            return value
        if value != value.to_integral_value():
            return value
        iv = int(value)
        if 32768 <= iv <= 65535:
            return iv - 65536
        return iv
    return value


def _decode_column_name(name: Any) -> str:
    """Decode a cursor description column name to a lowercase str.

    p4d returns column names as bytes (e.g. b'REGARTICULO').  Decoding here
    keeps all callers simple — they always receive plain str keys.
    """
    if isinstance(name, bytes):
        return name.decode("utf-8", errors="replace").lower()
    return str(name).lower()


@dataclass
class Anomaly:
    """One anomalous row found by scan_rows_for_anomalies() (D-051)."""

    index: int
    kind: str  # "all_null" | "null_pk" | "non_finite_float"
    row_repr: str


# Fetch-anomaly evidence log (D-051) — mirrors the D-050 skip-log transport
# pattern in etl/db/postgres.py: a module-level list drained by
# etl.main._run_sync after every sync_fn call. Safe under the same
# single-sequential-worker assumption documented there (one table's sync
# always fully drains this before the next table's sync starts).
_anomaly_log: list[dict] = []


def drain_anomaly_log() -> list[dict]:
    """Return and clear the fetch-anomaly evidence recorded since the last drain."""
    global _anomaly_log
    events, _anomaly_log = _anomaly_log, []
    return events


def scan_rows_for_anomalies(
    columns: list[str], rows: list[tuple], pk_field: str | None
) -> list[Anomaly]:
    """Flag rows that look like p4d row-decode corruption, not real source data.

    A row is anomalous when:
      - it has more than one column and every value is ``None``
        (``kind="all_null"``) — the shape of the ~60 NULL rows in the
        2026-08-28 incident. A *single*-column row that is ``None`` is
        deliberately excluded from this check: with only one value there is
        no way to distinguish "the whole row decoded to garbage" from an
        ordinary, legitimate NULL (e.g. a nullable lookup result) — the
        incident pattern is inherently about a multi-column row collapsing
        to NULL across the board, not one value being NULL; or
      - *pk_field* is given and that column's value is ``None``
        (``kind="null_pk"``) — a PK can never legitimately be NULL; or
      - any ``float`` value is NaN or +/-Inf (``kind="non_finite_float"``) —
        the shape of the one garbage row (``precio_neto_si = NaN``) that
        preceded the NULL run in the same incident.

    Checks are in that priority order (a fully-NULL multi-column row is
    reported as ``all_null`` even though its PK column is also, trivially,
    NULL).

    *columns* and *pk_field* are both already-lowercased (as returned by
    safe_fetch's column decoding / as passed by callers via ``guard_pk``).
    """
    pk_idx: int | None = None
    if pk_field is not None:
        try:
            pk_idx = columns.index(pk_field)
        except ValueError as exc:
            raise ValueError(
                f"scan_rows_for_anomalies: guard_pk={pk_field!r} is not among "
                f"the fetched columns {columns!r} — check the call site's "
                "guard_pk argument against the query's column list."
            ) from exc

    anomalies: list[Anomaly] = []
    for idx, row in enumerate(rows):
        kind: str | None = None
        if len(row) > 1 and all(v is None for v in row):
            kind = "all_null"
        elif pk_idx is not None and row[pk_idx] is None:
            kind = "null_pk"
        elif any(isinstance(v, float) and not math.isfinite(v) for v in row):
            kind = "non_finite_float"
        if kind is not None:
            anomalies.append(Anomaly(index=idx, kind=kind, row_repr=repr(row)[:500]))
    return anomalies


def _compress_index_ranges(indices: list[int]) -> str:
    """Compress a sorted list of row indices into ranges, e.g. [1,2,3,7,9] -> "1-3,7,9"."""
    if not indices:
        return ""
    parts: list[str] = []
    start = prev = indices[0]
    for i in indices[1:]:
        if i == prev + 1:
            prev = i
            continue
        parts.append(f"{start}-{prev}" if start != prev else str(start))
        start = prev = i
    parts.append(f"{start}-{prev}" if start != prev else str(start))
    return ",".join(parts)


# p4d re-fetches results from the 4D server 100 rows at a time
# (p4d.Cursor.pagesize = 100, verified in the installed driver — see
# docs/skills/data-access.md). A transient network hiccup during a
# mid-resultset page fetch is the working hypothesis for the 2026-08-28
# incident: it plausibly desyncs the C parser within that page, producing
# one garbage row followed by a run of NULLs until the next page boundary
# resyncs it. That hypothesis makes a falsifiable prediction: the anomalous
# run should be confined to one 100-row-aligned window, ending at an index
# ≡ 99 (mod 100). We record the fields needed to check that prediction
# against real incidents without asserting the hypothesis is proven.
_P4D_PAGE_SIZE = 100


def _build_evidence(sql: str, rows: list[tuple], anomalies: list[Anomaly]) -> dict:
    """Build the fetch-anomaly evidence record for one safe_fetch() detection.

    Built *before* the refetch is issued (the anomalous result set is about
    to be discarded) so the evidence describes exactly what was seen, not
    what replaced it. ``refetch_total_rows`` / ``refetch_outcome`` are filled
    in by the caller once the refetch (or its failure) is known.
    """
    indices = [a.index for a in anomalies]
    kinds: dict[str, int] = {}
    for a in anomalies:
        kinds[a.kind] = kinds.get(a.kind, 0) + 1

    first_index = indices[0]
    last_index = indices[-1]

    sample: list[dict[str, str]] = [
        {"label": "first_anomalous_row", "repr": anomalies[0].row_repr}
    ]
    if first_index > 0:
        sample.append(
            {
                "label": "last_good_row_before_run",
                "repr": repr(rows[first_index - 1])[:500],
            }
        )
    if last_index + 1 < len(rows):
        sample.append(
            {
                "label": "first_good_row_after_run",
                "repr": repr(rows[last_index + 1])[:500],
            }
        )

    return {
        "sql_text": sql[:500],
        "total_rows": len(rows),
        "refetch_total_rows": None,
        "anomaly_count": len(anomalies),
        "first_index": first_index,
        "last_index": last_index,
        "index_ranges": _compress_index_ranges(indices),
        "page_size": _P4D_PAGE_SIZE,
        "run_start_mod_100": first_index % _P4D_PAGE_SIZE,
        "run_end_mod_100": last_index % _P4D_PAGE_SIZE,
        "page_aligned_end": last_index % _P4D_PAGE_SIZE == _P4D_PAGE_SIZE - 1,
        "kinds": kinds,
        "sample": sample[:5],
        "refetch_outcome": None,
    }


def _fetch_raw(conn, sql: str) -> tuple[list[str], list[tuple]]:
    """Execute *sql* and return (lowercased column names, raw row tuples).

    No value decoding/dict-building here — that happens in _rows_to_dicts()
    so scan_rows_for_anomalies() can inspect raw values (e.g. real Python
    ``float`` NaN/Inf) before ``_decode_value()`` has a chance to touch them.
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
    return columns, list(rows)


def _rows_to_dicts(columns: list[str], rows: list[tuple], sql: str) -> list[dict]:
    """Zip *columns* with each row into a dict, decoding values.

    Uses ``zip(..., strict=True)`` as a tripwire, not an instrument: a short
    or over-long row is structurally impossible at this boundary (p4d's
    fetchone() always appends exactly one value per column — see
    docs/skills/data-access.md) so this is expected to never fire. If it
    ever does, it means something p4d-internal is worse than the row-content
    corruption this module is otherwise built to catch, and the safest thing
    is to fail loudly with enough detail (SQL, arity, index, row repr) to
    debug it — not to silently zip-truncate/pad and hide the mismatch.
    """
    result: list[dict] = []
    for idx, row in enumerate(rows):
        try:
            result.append(
                {k: _decode_value(v) for k, v in zip(columns, row, strict=True)}
            )
        except ValueError as exc:
            raise RuntimeError(
                f"safe_fetch: row arity mismatch for query {sql[:200]!r}: "
                f"expected {len(columns)} column(s), got {len(row)} value(s) "
                f"at row index {idx}. Row: {repr(row)[:500]}"
            ) from exc
    return result


def safe_fetch(conn, sql: str, *, guard_pk: str | None = None) -> list[dict]:
    """Execute *sql* and return a list of dicts with lowercase str keys.

    - Column names are decoded from bytes to str and lowercased (p4d returns
      them as uppercase bytes, e.g. b'REGARTICULO' → 'regarticulo').
    - Decodes bytes values to str.
    - None values are preserved.
    - The cursor is always closed after fetching.

    Fetch-anomaly guard (D-051)
    ----------------------------
    Every fetch is scanned by scan_rows_for_anomalies() — always, even when
    *guard_pk* is not given (all-NULL and non-finite-float checks don't need
    a PK column). *guard_pk* additionally enables the null-PK check for
    callers that know their query's PK column (see etl/sync/ventas.py).

    When the scan finds nothing, this is a zero-cost pass-through — no
    extra round-trip. When it finds anomalies, the evidence is recorded
    *before* refetching (the anomalous result is about to be discarded),
    then the exact same query is re-executed once, to discriminate transient
    p4d/network corruption from genuinely-bad source data:

      - refetch comes back clean            -> "clean_after_refetch": trust
        the refetch, return it wholesale (the original was noise).
      - refetch still has anomalies         -> "persisted_source_data": this
        is real; keep "non_finite_float" rows (let downstream NOT NULL/other
        constraints judge them) but drop "all_null"/"null_pk" rows (a row
        that is either entirely empty or missing its PK can never be a
        legitimate insert, so there is nothing useful to hand downstream).
      - the refetch itself raises            -> evidence is still flushed
        (outcome "refetch_failed") and the exception propagates unchanged.

    Row-count drift between the two fetches is expected and tolerated (both
    counts are recorded) — the refetched set is always the authoritative one
    once a refetch happens.
    """
    columns, rows = _fetch_raw(conn, sql)
    anomalies = scan_rows_for_anomalies(columns, rows, guard_pk)
    if not anomalies:
        return _rows_to_dicts(columns, rows, sql)

    evidence = _build_evidence(sql, rows, anomalies)
    logger.warning(
        "safe_fetch: %d anomalous row(s) %s among %d fetched for query %r "
        "(idx %s) — re-executing once to discriminate transient corruption "
        "from source data",
        len(anomalies),
        evidence["kinds"],
        len(rows),
        sql[:200],
        evidence["index_ranges"],
    )

    try:
        refetch_columns, refetch_rows = _fetch_raw(conn, sql)
    except Exception:
        evidence["refetch_outcome"] = "refetch_failed"
        _anomaly_log.append(evidence)
        raise

    refetch_anomalies = scan_rows_for_anomalies(refetch_columns, refetch_rows, guard_pk)
    evidence["refetch_total_rows"] = len(refetch_rows)

    if not refetch_anomalies:
        evidence["refetch_outcome"] = "clean_after_refetch"
        _anomaly_log.append(evidence)
        logger.warning(
            "safe_fetch: refetch came back clean (%d rows) — original "
            "anomaly was transient, not source data",
            len(refetch_rows),
        )
        return _rows_to_dicts(refetch_columns, refetch_rows, sql)

    evidence["refetch_outcome"] = "persisted_source_data"
    _anomaly_log.append(evidence)
    logger.warning(
        "safe_fetch: refetch reproduced %d anomalous row(s) — treating as "
        "real source data; dropping all_null/null_pk rows, keeping "
        "non_finite_float rows for downstream constraints to judge",
        len(refetch_anomalies),
    )
    drop_kinds = {"all_null", "null_pk"}
    drop_indices = {a.index for a in refetch_anomalies if a.kind in drop_kinds}
    kept_rows = [row for idx, row in enumerate(refetch_rows) if idx not in drop_indices]
    return _rows_to_dicts(refetch_columns, kept_rows, sql)


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
