"""PostgreSQL connection and DML helpers for the ETL pipeline.

Transaction policy
------------------
All DML helpers (upsert, bulk_insert, truncate_and_insert) commit on success
and rollback on failure so the connection is always in a clean state.
Watermark helpers (get_watermark, set_watermark) follow the same pattern.
_ensure_watermarks_table() does NOT commit — it is always called as part of a
surrounding operation that owns the commit/rollback.

Row-skip visibility (D-050)
----------------------------
upsert() never lets one malformed row take a whole batch down (see its
docstring). Rows it drops are recorded in a module-level log drained by
etl.main._run_sync into etl_sync_run_tables.error_msg. This module-level
list is safe only because the ETL runs as a single sequential worker per
process — see try_acquire_run_lock()/fail_orphan_running_runs() below,
which already assume the same thing.

Fetch-anomaly evidence (D-051)
-------------------------------
insert_fetch_anomalies() persists what etl.db.fourd.safe_fetch()'s guard
detected (and discriminated via a same-query refetch) into
etl_fetch_anomalies. This is a *separate* channel from the D-050 skip log
above: rows the guard drops never reach upsert() in the first place (they
are filtered out inside safe_fetch(), before the sync_fn's return value is
even built), so there is no overlap between the two logs to double-report.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
import math
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Sequence

if TYPE_CHECKING:
    from etl.config import Config

logger = logging.getLogger(__name__)


class UpsertBatchFailedError(RuntimeError):
    """Raised by upsert() when a batch fails for a reason unrelated to any
    single row's primary key and NOT ONE row in it could be saved, even by
    the row-by-row SAVEPOINT fallback.

    This is deliberately distinct from the normal "one/some bad rows
    skipped" outcome (which returns a row count and never raises — see
    upsert()'s docstring, D-050). Zero survivors out of an attempted batch
    means the failure is systemic (e.g. a NOT NULL violation on a non-PK
    column, or a schema mismatch) rather than a handful of genuinely bad
    rows, so it must propagate and fail the table's sync loudly instead of
    being reported as a quiet 0-row success.
    """


# ---------------------------------------------------------------------------
# Row-skip diagnostics (D-050)
# ---------------------------------------------------------------------------
# upsert() appends one message per row it drops (either pre-filtered because
# the PK can never be valid, or rejected individually by the row-by-row
# fallback after a batch insert failed). etl.main._run_sync drains this after
# every sync_fn call and folds it into etl_sync_run_tables.error_msg so an
# operator sees the count and a sample of reasons instead of the rows just
# vanishing. See docs/decisions/D-050-upsert-batch-loss.md for the incident
# that prompted this (2026-08-28 02:52:29 UTC: one garbage row plus ~60
# NULL rows in a single execute_values() batch destroyed ~5,000 good
# ps_lineas_ventas rows because the batch rolled back as a whole).
_skip_log: list[str] = []


def drain_skip_log() -> list[str]:
    """Return and clear the rows upsert() has dropped since the last drain."""
    global _skip_log
    msgs, _skip_log = _skip_log, []
    return msgs


def _invalid_pk_reason(row: dict, pk_cols: list[str]) -> str | None:
    """Return why *row* is rejected before insert, or None if it's fine.

    A NULL value in a PK column can never be legally inserted — the column
    is NOT NULL by definition of being a primary key. There is no point
    letting Postgres reject it after the fact: reject it in Python, before
    it can take an entire execute_values() batch down with it.

    A NaN value is a different case: PostgreSQL's NUMERIC/FLOAT types treat
    NaN as a valid, orderable value (`NaN = NaN` is true for indexing and
    ON CONFLICT purposes), so a NaN PK does NOT violate NOT NULL — it is
    accepted and upserts correctly (verified live on Postgres 16). We still
    reject it, but for a different, real reason: a NaN primary key is never
    a legitimate business key, and in this pipeline it is the observed
    signature of a p4d row-decode failure (see the "suspected p4d
    row-decode desync" note in docs/skills/data-access.md and D-050) —
    keeping such a row would silently persist corrupted data under a
    nonsensical key rather than surfacing the decode problem.
    """
    for col in pk_cols:
        value = row.get(col)
        if value is None:
            return f"NULL primary key column {col!r}"
        if isinstance(value, Decimal) and value.is_nan():
            return f"NaN primary key column {col!r}"
        if isinstance(value, float) and math.isnan(value):
            return f"NaN primary key column {col!r}"
    return None


# Single source of truth for the etl_watermarks DDL: loaded from init.sql so
# the in-memory definition never drifts from the file applied to the database.
_SCHEMA_SQL_PATH = Path(__file__).parent.parent / "schema" / "init.sql"


def _load_watermarks_ddl() -> str:
    """Extract the CREATE TABLE IF NOT EXISTS etl_watermarks statement from init.sql.

    This helper only reads and parses the file.
    Caching is handled by _get_watermarks_ddl() so repeated watermark calls
    do not hit disk.
    """
    sql = _SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    start = sql.find("CREATE TABLE IF NOT EXISTS etl_watermarks")
    if start == -1:
        raise RuntimeError(
            f"etl_watermarks DDL not found in {_SCHEMA_SQL_PATH}. "
            "Ensure etl/schema/init.sql contains that CREATE TABLE statement."
        )
    end_idx = sql.find(";", start)
    if end_idx == -1:
        raise RuntimeError(
            f"etl_watermarks DDL in {_SCHEMA_SQL_PATH} is not terminated with a ';'. "
            "Ensure the CREATE TABLE statement for etl_watermarks ends with a semicolon."
        )
    return sql[start : end_idx + 1]


# Lazily cached DDL string — populated on first use by _ensure_watermarks_table().
# Loading lazily means a missing/unreadable schema file does not crash module
# import and prevents all Postgres helpers from being unusable at startup.
_WATERMARKS_DDL: str | None = None


def _get_watermarks_ddl() -> str:
    """Return the cached etl_watermarks DDL, loading it on first call."""
    global _WATERMARKS_DDL
    if _WATERMARKS_DDL is None:
        _WATERMARKS_DDL = _load_watermarks_ddl()
    return _WATERMARKS_DDL


def _validate_rows(rows: list[dict], operation: str) -> list[str]:
    """Return the column list; raise ValueError if rows have inconsistent or empty keys."""
    columns = list(rows[0].keys())
    if not columns:
        raise ValueError(
            f"{operation}: row dicts must not be empty — at least one column is required."
        )
    expected = set(columns)
    for idx, row in enumerate(rows[1:], start=1):
        if set(row.keys()) != expected:
            raise ValueError(
                f"{operation}: inconsistent keys in row {idx}. "
                f"Expected {sorted(expected)}, got {sorted(row.keys())}."
            )
    return columns


def get_connection(config: "Config"):
    """Return a psycopg2 connection with autocommit=False."""
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "psycopg2 package is not installed. Run: pip install psycopg2-binary"
        ) from exc

    conn = psycopg2.connect(config.postgres_dsn)
    conn.autocommit = False
    return conn


# ---------------------------------------------------------------------------
# DML helpers
# ---------------------------------------------------------------------------


def _upsert_rowwise(
    conn,
    table: str,
    row_stmt: str,
    columns: list[str],
    rows: list[dict],
    pk_cols: list[str],
) -> int:
    """Insert *rows* one at a time, each isolated in its own SAVEPOINT.

    Fallback path used only after a batched execute_values() insert has
    already failed for a reason the pre-filter in upsert() could not
    predict — e.g. an FK violation (19 recorded in etl_sync_run_tables
    between 2026-04-18 and 2026-08-15, see D-050). A SAVEPOINT before each
    row lets a single row's constraint violation be rolled back on its own,
    instead of aborting the whole transaction and losing every row that
    would otherwise have succeeded.

    Deliberately not the default path: one round trip per row is much
    slower than execute_values. It only runs once a batch has already
    failed, so the cost is bounded to the rare bad batch.

    Returns the number of rows successfully inserted (0 if every row failed
    — the caller, upsert(), treats an all-zero result as a systemic failure
    and raises UpsertBatchFailedError rather than reporting a quiet 0-row
    success). Rows that fail are logged and appended to the module-level
    skip log (drained by etl.main._run_sync into
    etl_sync_run_tables.error_msg) — never silently dropped.

    Every SAVEPOINT this issues is explicitly RELEASEd on both the success
    and failure path (never left dangling after ROLLBACK TO SAVEPOINT) so a
    large fallback batch does not accumulate thousands of unreleased
    subtransactions in one transaction.
    """
    inserted = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute("SAVEPOINT etl_upsert_row")
            try:
                cur.execute(row_stmt, tuple(row[c] for c in columns))
                cur.execute("RELEASE SAVEPOINT etl_upsert_row")
                inserted += 1
            except Exception as row_exc:
                # Restore the transaction to the state just before this row
                # (NOT conn.rollback(), which would also undo every row
                # already inserted earlier in this same call).
                cur.execute("ROLLBACK TO SAVEPOINT etl_upsert_row")
                from psycopg2 import IntegrityError as _PGIntegrityError  # type: ignore[import-untyped]

                if not isinstance(row_exc, _PGIntegrityError):
                    # Only constraint violations are skippable (a bad source
                    # row). Anything else — ProgrammingError, OperationalError
                    # — is a real failure and must propagate loudly. No RELEASE
                    # here on purpose: the transaction is aborting anyway.
                    raise
                # ROLLBACK TO SAVEPOINT undoes the row's changes but does NOT
                # destroy the savepoint — the next SAVEPOINT of the same name
                # pushes a new one on top rather than reusing the slot. Without
                # this release, a large fallback batch of bad rows nests
                # thousands of unreleased subtransactions in one transaction,
                # risking pg_subtrans SLRU pressure on an instance that also
                # serves the Dashboard App and WrenAI. Releasing here keeps
                # exactly one subtransaction open at a time, on both paths.
                cur.execute("RELEASE SAVEPOINT etl_upsert_row")
                pk_snapshot = {c: row.get(c) for c in pk_cols}
                msg = (
                    f"{table}: row rejected by row-by-row fallback — "
                    f"pk={pk_snapshot}: {row_exc}"
                )
                logger.warning("upsert fallback: %s", msg)
                _skip_log.append(msg[:500])
    conn.commit()
    return inserted


def upsert(conn, table: str, rows: list[dict], pk_cols: list[str]) -> int:
    """Batch-upsert *rows* into *table* using ON CONFLICT DO UPDATE.

    Uses psycopg2.extras.execute_values for efficiency.
    Table and column names are quoted via psycopg2.sql.Identifier.
    Commits on success.

    Batch-loss protection (D-050)
    ------------------------------
    Before 2026-08-28 a single malformed row anywhere in *rows* made the
    whole execute_values() batch fail, roll back, and re-raise — discarding
    every good row in the same batch along with the bad one. Production
    evidence (etl_sync_run_tables, 2026-08-28 02:52:29 UTC): one
    execute_values batch against ps_lineas_ventas failed with
    'null value in column "reg_lineas" ... violates not-null constraint'
    because it held one garbage row (mes=-1801453568,
    precio_neto_si='NaN'::numeric) plus ~60 entirely-NULL rows — losing
    roughly 5,000 good rows that happened to share the same 5,000-row
    BATCH_SIZE chunk (see etl/sync/ventas.py::_sync_table).

    Two layers now bound that blast radius to just the bad row(s):

      1. Pre-filter — rows whose primary key is NULL or NaN are dropped
         before the insert is even attempted. A NULL PK can never satisfy
         the PK's NOT NULL constraint. A NaN PK is different: Postgres
         actually accepts it (NaN = NaN is true for indexing purposes), but
         it is never a legitimate business key and is the observed
         signature of a p4d row-decode failure (see _invalid_pk_reason()
         and D-050), so it is still rejected — just not because of NOT
         NULL. Rejecting either up front is strictly cheaper than letting
         Postgres reject the whole batch after the fact, and it covers the
         incident above directly (the ~60 NULL rows all had
         reg_lineas = NULL).
      2. Row-by-row fallback (_upsert_rowwise) — if the batch insert still
         fails for a reason the pre-filter can't predict (e.g. an FK
         violation), retry the surviving rows one at a time inside
         SAVEPOINTs so only the row(s) that actually violate a constraint
         are lost.

    Both layers record what they drop via the module-level skip log
    (drain_skip_log()) instead of silently discarding it — a sync that
    silently drops rows is worse than one that fails loudly.

    Returns the number of rows actually attempted against the database
    (i.e. len(rows) minus whatever the pre-filter rejected). This includes
    both inserted and updated rows, and rows skipped by DO NOTHING — same
    approximation as before. Still commits on success and rolls back and
    re-raises when even the row-by-row fallback cannot make progress (e.g.
    the connection itself is gone).

    Total-failure signalling (D-050 follow-up): if the row-by-row fallback
    runs and NOT ONE of the surviving rows can be inserted either, that is
    not "a bad row or two" — it means the batch failure was systemic (a
    NOT NULL violation on a non-PK column, a schema mismatch, etc.), so
    upsert() raises UpsertBatchFailedError instead of returning 0. A batch
    with at least one successful row (the common case: one bad row among
    many good ones) still returns quietly, exactly as before — only a
    100%-failed batch is escalated.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    if not pk_cols:
        raise ValueError("upsert: pk_cols must not be empty.")
    columns = _validate_rows(rows, "upsert")
    missing_pks = [c for c in pk_cols if c not in columns]
    if missing_pks:
        raise ValueError(
            f"upsert: pk_cols {missing_pks} not found in row keys {columns}."
        )
    update_cols = [c for c in columns if c not in pk_cols]
    conflict_target = pgsql.SQL(", ").join(pgsql.Identifier(c) for c in pk_cols)
    col_ids = [pgsql.Identifier(c) for c in columns]
    tbl_id = pgsql.Identifier(table)

    if update_cols:
        set_clause = pgsql.SQL(", ").join(
            pgsql.SQL("{col} = EXCLUDED.{col}").format(col=pgsql.Identifier(c))
            for c in update_cols
        )
        on_conflict = pgsql.SQL("ON CONFLICT ({target}) DO UPDATE SET {sets}").format(
            target=conflict_target, sets=set_clause
        )
    else:
        on_conflict = pgsql.SQL("ON CONFLICT ({target}) DO NOTHING").format(
            target=conflict_target
        )

    # Layer 1: reject rows that can never satisfy the PK NOT NULL constraint
    # before we even build the batch. See docstring above (D-050).
    good_rows = []
    for row in rows:
        reason = _invalid_pk_reason(row, pk_cols)
        if reason is None:
            good_rows.append(row)
            continue
        pk_snapshot = {c: row.get(c) for c in pk_cols}
        msg = (
            f"{table}: row rejected before insert — {reason} "
            f"(pk snapshot: {pk_snapshot})"
        )
        logger.warning("upsert pre-filter: %s", msg)
        _skip_log.append(msg[:500])

    if not good_rows:
        return 0

    stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s {on_conflict}").format(
        tbl=tbl_id,
        cols=pgsql.SQL(", ").join(col_ids),
        on_conflict=on_conflict,
    )

    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                stmt.as_string(cur),
                [tuple(row[c] for c in columns) for row in good_rows],
            )
        conn.commit()
    except Exception as batch_exc:
        conn.rollback()
        from psycopg2 import IntegrityError as _PGIntegrityError  # type: ignore[import-untyped]

        if not isinstance(batch_exc, _PGIntegrityError):
            # Structural failures (ProgrammingError, OperationalError, bad SQL,
            # missing table/column, connection issues) must fail loudly — they
            # indicate a real problem, not a bad source row.
            raise
        logger.warning(
            "upsert: batch insert into %s failed (%s) — falling back to "
            "row-by-row insert (%d rows) so only the offending row(s) are "
            "lost instead of the whole batch",
            table,
            batch_exc,
            len(good_rows),
        )
        # Layer 2: a constraint violation (FK, NOT NULL, UNIQUE, CHECK) took
        # the whole batch down. Retry survivors one at a time inside SAVEPOINTs
        # so only the row(s) that actually violate a constraint are lost — see
        # _upsert_rowwise (D-050).
        row_stmt = pgsql.SQL(
            "INSERT INTO {tbl} ({cols}) VALUES ({vals}) {on_conflict}"
        ).format(
            tbl=tbl_id,
            cols=pgsql.SQL(", ").join(col_ids),
            vals=pgsql.SQL(", ").join(pgsql.Placeholder() for _ in columns),
            on_conflict=on_conflict,
        )
        with conn.cursor() as cur:
            row_stmt_str = row_stmt.as_string(cur)
        inserted = _upsert_rowwise(
            conn, table, row_stmt_str, columns, good_rows, pk_cols
        )
        if inserted == 0:
            # Every single surviving row was rejected individually too —
            # this is not "one bad row among many" (that case returns a
            # positive count and is reported quietly, per D-050). Zero
            # survivors out of an attempted batch means the batch failure
            # was systemic (e.g. a NOT NULL violation on a non-PK column,
            # or a schema mismatch) rather than a handful of genuinely bad
            # rows, so it must fail the sync loudly instead of being
            # reported as a quiet 0-row success. The dropped-row detail is
            # already in the skip log (drain_skip_log()) for the caller to
            # fold into its error message.
            raise UpsertBatchFailedError(
                f"upsert: {table} — batch insert failed ({batch_exc}) and "
                f"the row-by-row fallback also failed for all "
                f"{len(good_rows)} surviving row(s); treating this as a "
                "total batch failure rather than a 0-row success."
            ) from batch_exc
        return inserted
    # Return len(good_rows) rather than cur.rowcount — execute_values
    # paginates by page_size (default 100) and rowcount only reflects the
    # last page.
    return len(good_rows)


def bulk_insert(conn, table: str, rows: list[dict]) -> int:
    """Simple batch INSERT (for append-only tables like Traspasos).

    Commits on success; rolls back and re-raises on failure.
    Returns the number of rows inserted.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = _validate_rows(rows, "bulk_insert")
    stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=pgsql.Identifier(table),
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                stmt.as_string(cur),
                [tuple(row[c] for c in columns) for row in rows],
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    # Return len(rows) — execute_values paginates and rowcount reflects last page only.
    return len(rows)


def insert_ignore(conn, table: str, rows: list[dict], pk_cols: list[str]) -> int:
    """Batch INSERT ... ON CONFLICT (pk_cols) DO NOTHING.

    Idempotent append: rows that already exist (by pk_cols) are silently skipped.
    Use for append-only tables where re-runs must not fail or modify existing rows.

    Returns the number of rows *attempted* (len(rows)), including skipped ones.
    Commits on success; rolls back and re-raises on failure.
    """
    if not rows:
        return 0

    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    if not pk_cols:
        raise ValueError("insert_ignore: pk_cols must not be empty.")
    columns = _validate_rows(rows, "insert_ignore")
    missing_pks = [c for c in pk_cols if c not in columns]
    if missing_pks:
        raise ValueError(
            f"insert_ignore: pk_cols {missing_pks} not found in row keys {columns}."
        )

    conflict_target = pgsql.SQL(", ").join(pgsql.Identifier(c) for c in pk_cols)
    stmt = pgsql.SQL(
        "INSERT INTO {tbl} ({cols}) VALUES %s ON CONFLICT ({target}) DO NOTHING"
    ).format(
        tbl=pgsql.Identifier(table),
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
        target=conflict_target,
    )

    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                stmt.as_string(cur),
                [tuple(row[c] for c in columns) for row in rows],
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    # Return len(rows) — execute_values paginates and rowcount reflects last page only.
    return len(rows)


def _ident(nombre: str) -> str:
    """Comilla un identificador simple, rechazando cualquier otra cosa.

    Sólo admite `[a-z_][a-z0-9_]*`: los nombres de tabla y columna de este ETL
    salen del esquema, no de entrada de usuario, así que cualquier otra forma es
    un error de programación y conviene que reviente aquí.
    """
    import re as _re

    if not _re.fullmatch(r"[a-z_][a-z0-9_]*", nombre):
        raise ValueError(f"identificador no válido: {nombre!r}")
    return f'"{nombre}"'


_AGOTADO = object()


def _guard_full_refresh_shrink_streaming(conn, table: str, filas_origen: int) -> None:
    """Como `_guard_full_refresh_shrink`, para la variante troceada.

    Aqui no vale comparar filas entrantes contra filas existentes: el mapper
    expande (una linea de albaran -> una fila por talla), asi que los dos
    numeros no son de la misma magnitud. Lo comparable es cuantas filas
    escribio la ULTIMA pasada correcta de esta misma tabla, que ya esta en
    `etl_sync_run_tables.rows_total_after` -- no hace falta tabla nueva.

    Esto es defensa en profundidad, no la deteccion principal: con la
    comprobacion de `rowcount` en `_fetch_raw` una lectura truncada ya no llega
    hasta aqui. Cubre el caso de que se cuele por otra via.

    Sin historico (primera carga) no se bloquea: no hay con que comparar.
    """
    # Consultar el historico no puede ser motivo de fallo: si la tabla de
    # historico no existe todavia, o la consulta no sale por lo que sea, la
    # guarda se abstiene en vez de tumbar una carga que probablemente esta bien.
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT rows_total_after
                FROM etl_sync_run_tables
                WHERE table_name = %s AND status = 'ok'
                  AND rows_total_after IS NOT NULL
                ORDER BY id DESC LIMIT 1
                """,
                (table,),
            )
            fila = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "guarda de encogimiento: no se pudo leer el historico de %s (%s); "
            "se continua sin comprobar",
            table,
            exc,
        )
        return

    anterior = fila[0] if fila else None
    if anterior is None or anterior < _SHRINK_GUARD_MIN_ROWS:
        return
    # `filas_origen` es el crudo y `anterior` el destino YA EXPANDIDO, asi que
    # no son magnitudes comparables y esta guarda solo detecta desplomes
    # groseros. Es deliberadamente floja, y conviene saber cuanto: en
    # ps_lin_albaranes el origen son 45.967 lineas y el destino 291.068 filas
    # (15,8 %), asi que un umbral del 10 % del destino solo salta si el origen
    # cae por debajo de ~29.000 -- una perdida de mas del 35 %.
    #
    # La deteccion FINA no vive aqui, vive en `_fetch_raw`: el servidor 4D
    # declara cuantas filas tiene el statement y una lectura truncada revienta
    # antes de llegar a este punto (D-063). Esto es defensa en profundidad.
    #
    # El comentario anterior prometia el 10 % y el codigo solo abortaba con
    # cero, asi que una lectura al 5 % pasaba: lo senalo una revision de Copilot
    # que nadie habia leido.
    if filas_origen < anterior * _MAX_SHRINK_RATIO:
        raise FullRefreshShrankError(
            f"{table}: la lectura de origen trajo {filas_origen} filas y la "
            f"ultima pasada dejo {anterior} en destino. Con un mapper que "
            f"expande, un origen por debajo del "
            f"{_MAX_SHRINK_RATIO:.0%} del destino anterior es un desplome, no "
            f"una variacion. Se aborta sin tocar la tabla. Si el encogimiento "
            f"es legitimo, pasa allow_shrink=True tras confirmar el origen."
        )


def truncate_and_insert_streaming(
    conn,
    table: str,
    # `Iterable`, no `list`: desde que la lectura tambien va troceada esto
    # recibe el iterador de `safe_fetch_streaming`. El hint decia `list` y
    # contradecia el uso real.
    raw_rows: "Iterable",
    mapper,
    *,
    chunk_size: int = 50_000,
    allow_shrink: bool = False,
    filas_origen: int | None = None,
) -> int:
    """TRUNCATE *table* y luego INSERT por lotes, mapeando sobre la marcha.

    `truncate_and_insert` materializa la lista mapeada entera antes de
    insertar. Para las tablas de linea del mayorista (~1M filas) eso deja tres
    copias vivas a la vez -- las tuplas crudas, los diccionarios mapeados y el
    lote que construye psycopg2 -- y el proceso muere sin traza de Python:
    salida limpia, contenedor reiniciado, la pasada marcada como fallida. Le
    paso dos veces seguidas a `ps_gc_lin_albarane` en produccion (runs 1504 y
    1506), con la maquina a 75 MB libres de 16 GB.

    Aqui el mapeo va por trozos y cada trozo se inserta antes de mapear el
    siguiente, asi que en memoria solo hay `chunk_size` filas mapeadas ademas
    del crudo. Todo en una transaccion: si algo falla, la tabla no queda a
    medias.

    Args:
        raw_rows: filas tal cual salen de 4D.
        mapper:   funcion fila_cruda -> dict listo para insertar.

    Devuelve el numero de filas insertadas. Hace commit al terminar; ante
    cualquier error hace rollback y re-lanza.
    """

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    # Identificadores compuestos a mano en vez de con `psycopg2.sql`: su
    # `as_string()` exige una conexion real, lo que obliga a que cualquier test
    # del troceado necesite una base de datos. Los nombres vienen de nuestro
    # propio esquema, nunca de entrada de usuario, y `_ident` rechaza cualquier
    # cosa que no sea un identificador simple, asi que no hay superficie de
    # inyeccion.
    tbl = _ident(table)

    # La misma guarda que `truncate_and_insert`, que aqui faltaba -- y estas son
    # precisamente las tablas de un millon de filas, las que mas papeletas
    # tienen de sufrir una lectura truncada. `raw_rows` es la lista cruda; el
    # mapper puede expandir (una fila de origen -> varias de destino), asi que
    # comparar el crudo contra el destino seria injusto. Se compara por la
    # proporcion respecto a la ultima carga, que es lo unico honesto sin
    # ejecutar el mapper dos veces.
    # `raw_rows` puede ser un iterador (lectura troceada), y entonces no tiene
    # longitud: el total lo declara el servidor 4D y llega en `filas_origen`.
    conocidas = filas_origen
    if conocidas is None:
        try:
            conocidas = len(raw_rows)  # type: ignore[arg-type]
        except TypeError:
            conocidas = None  # iterador sin longitud y sin total declarado
    if not allow_shrink and conocidas is not None:
        _guard_full_refresh_shrink_streaming(conn, table, conocidas)

    try:
        with conn.cursor() as cur:
            cur.execute(f"TRUNCATE {tbl} CASCADE")
            total = 0
            # Un unico iterador consumido hacia delante. `islice(lista, i, ...)`
            # dentro de un bucle por indices re-escanea desde el principio en
            # cada vuelta -- O(n^2) sobre un millon de filas -- y cortar la
            # lista (`raw_rows[i:i+chunk]`) copia el trozo crudo, que es la
            # copia que este helper existe para no hacer. Consumir el iterador
            # evita las dos cosas.
            it = iter(raw_rows)
            origen_leidas = 0
            agotado = False
            # Remanente: lo que sobra cuando la ultima fila de origen leida
            # aporta mas filas de las que caben en el lote. Sin arrastrarlo, un
            # mapper que expanda x10 desborda el lote hasta `chunk_size + 9`.
            pendientes: list[dict] = []
            while True:
                # El mapper puede devolver un dict (una fila de origen -> una
                # de destino) o una LISTA de dicts, para tablas que se
                # despivotan: una linea de albaran trae 34 slots de talla y
                # produce 6,33 filas de media (issue #918).
                #
                # El limite es por filas de DESTINO, que son las que ocupan
                # memoria. Contar filas de ORIGEN dejaba entrar
                # `chunk_size * N` mapeadas de golpe -- con 50.000 lineas de
                # albaran serian ~316.000 vivas, justo lo que este helper
                # existe para no hacer.
                while not agotado and len(pendientes) < chunk_size:
                    fila = next(it, _AGOTADO)
                    if fila is _AGOTADO:
                        agotado = True
                        break
                    origen_leidas += 1
                    mapeado = mapper(fila)
                    if isinstance(mapeado, list):
                        pendientes.extend(mapeado)
                    else:
                        pendientes.append(mapeado)
                if not pendientes:
                    # Solo con el origen agotado: el bucle de arriba sigue
                    # leyendo hasta llenar el lote, asi que un tramo de filas
                    # que no aportan nada no lo corta.
                    break
                trozo = pendientes[:chunk_size]
                pendientes = pendientes[chunk_size:]
                cols = list(trozo[0].keys())
                cols_sql = ", ".join(_ident(c) for c in cols)
                execute_values(
                    cur,
                    f"INSERT INTO {tbl} ({cols_sql}) VALUES %s",
                    [tuple(row[c] for c in cols) for row in trozo],
                    page_size=1000,
                )
                total += len(trozo)
                # `len(raw_rows)` no vale: en lectura troceada esto es un
                # iterador y no tiene longitud. El total de origen lo declara el
                # servidor 4D y llega en `filas_origen`; si no se pasa (llamada
                # con una lista de toda la vida), se calcula.
                logger.info(
                    "%s: insertadas %d filas de destino (%d / %s de origen)",
                    table,
                    total,
                    origen_leidas,
                    conocidas if conocidas is not None else "?",
                )
        conn.commit()
        return total
    except Exception:
        conn.rollback()
        raise


class FullRefreshShrankError(RuntimeError):
    """Un full refresh iba a dejar la tabla con muchas menos filas de las que tenia.

    El 2026-09-01 la pasada 1553 escribio 23.898 articulos donde habia 42.275 y
    se marco `ok`: el 43 % del catalogo desaparecio en silencio y el dashboard
    empezo a responder que no habia datos de la temporada V26. El guardian de
    anomalias (D-051) SI vio la corrupcion y la registro, pero nada comparaba el
    volumen contra lo que ya habia, asi que la carga corta se dio por buena.

    Un full refresh que encoge asi no es un refresh: es una perdida de datos con
    otro nombre. Mejor abortar y dejar la tabla anterior intacta -- datos de ayer
    son infinitamente mejores que medio catalogo de hoy.
    """


#: Cuanto puede encoger un full refresh antes de considerarse perdida de datos.
#: Un catalogo real puede encoger un poco (bajas, depuraciones); no a la mitad.
_MAX_SHRINK_RATIO = 0.10

#: Por debajo de esto no se aplica la guarda: en tablas diminutas una variacion
#: de dos filas es un porcentaje enorme y no significa nada.
_SHRINK_GUARD_MIN_ROWS = 100


def _guard_full_refresh_shrink(conn, table: str, incoming: int) -> None:
    """Aborta si *incoming* es mucho menor que lo que la tabla tiene ahora.

    Se consulta ANTES del TRUNCATE, que es la ultima oportunidad: despues, el
    recuento anterior ya no existe.
    """
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {_ident(table)}")
        actual = cur.fetchone()[0]

    if actual < _SHRINK_GUARD_MIN_ROWS:
        return
    if incoming >= actual * (1 - _MAX_SHRINK_RATIO):
        return

    perdidas = actual - incoming
    raise FullRefreshShrankError(
        f"{table}: el full refresh traia {incoming} filas y la tabla tiene "
        f"{actual} ({perdidas} menos, {100 * perdidas / actual:.1f} %). "
        f"Se aborta sin tocar la tabla: una carga corta es perdida de datos, "
        f"no un refresh. Si el encogimiento es LEGITIMO, el escape es "
        f"allow_shrink=True en la llamada; force_full NO sirve, porque vuelve "
        f"a lanzar el mismo full refresh y choca con esta misma guarda."
    )


def truncate_and_insert(
    conn,
    table: str,
    rows: list[dict],
    *,
    restart_identity: bool = False,
    allow_shrink: bool = False,
) -> int:
    """TRUNCATE *table* then INSERT *rows* in a single transaction.

    Used for full-refresh tables (catalogs, small dimension tables).

    Args:
        restart_identity: If True, use TRUNCATE ... RESTART IDENTITY to reset
            any GENERATED AS IDENTITY / SERIAL sequences.  Required for tables
            like ps_facturas_compra that use a surrogate identity key.

    Commits on success; rolls back and re-raises on failure.
    Returns the number of rows inserted.
    """
    from psycopg2 import sql as pgsql  # type: ignore[import-untyped]

    tbl_id = pgsql.Identifier(table)
    restart_clause = (
        pgsql.SQL(" RESTART IDENTITY") if restart_identity else pgsql.SQL("")
    )
    truncate_stmt = pgsql.SQL("TRUNCATE {tbl}{restart} CASCADE").format(
        tbl=tbl_id, restart=restart_clause
    )

    if not rows:
        # Vaciar la tabla porque el origen no devolvio nada es la version
        # extrema de la carga corta: un corte del 4D a las 2 de la manana
        # borraba el catalogo entero y la pasada se marcaba `ok`. `upsert()`
        # ya se protege de esto (D-050); esta funcion no lo hacia.
        if not allow_shrink:
            _guard_full_refresh_shrink(conn, table, 0)
        try:
            with conn.cursor() as cur:
                cur.execute(truncate_stmt)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return 0

    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    columns = _validate_rows(rows, "truncate_and_insert")
    insert_stmt = pgsql.SQL("INSERT INTO {tbl} ({cols}) VALUES %s").format(
        tbl=tbl_id,
        cols=pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns),
    )

    if not allow_shrink:
        _guard_full_refresh_shrink(conn, table, len(rows))

    try:
        with conn.cursor() as cur:
            cur.execute(truncate_stmt)
            execute_values(
                cur,
                insert_stmt.as_string(cur),
                [tuple(row[c] for c in columns) for row in rows],
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    # Return len(rows) — execute_values paginates and rowcount reflects last page only.
    return len(rows)


# ---------------------------------------------------------------------------
# Watermark helpers
# ---------------------------------------------------------------------------


def _ensure_watermarks_table(conn) -> None:
    """Create the etl_watermarks table if it does not exist.

    DDL is sourced from etl/schema/init.sql (single source of truth) and cached
    after first successful load so repeated calls do not hit disk.
    Does NOT commit — callers own the transaction boundary.

    If etl/schema/init.sql is missing or the etl_watermarks statement is absent,
    a RuntimeError is raised from _load_watermarks_ddl() with context about what
    is wrong and how to fix it (e.g., missing file in a Docker image).
    """
    with conn.cursor() as cur:
        cur.execute(_get_watermarks_ddl())


def get_watermark(conn, table_name: str) -> datetime | None:
    """Return the last_sync_at timestamp for *table_name*, or None if not set.

    This helper does not manage transactions: it may perform DDL (via
    _ensure_watermarks_table) and then issues a SELECT, but it neither commits
    nor rolls back. Callers are responsible for transaction boundaries and it is
    safe to call inside a broader transaction.
    """
    _ensure_watermarks_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_sync_at FROM etl_watermarks WHERE table_name = %s",
            (table_name,),
        )
        row = cur.fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Run monitoring helpers
# ---------------------------------------------------------------------------


def fail_orphan_running_runs(conn) -> int:
    """Mark every ``running`` row as ``failed`` (previous worker died or was replaced).

    Safe only when a single ETL worker is expected. Call once at process startup
    before ``create_run`` so restarts do not leave multiple ``running`` rows.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_sync_runs
                   SET finished_at = NOW(),
                       status = 'failed',
                       duration_ms = COALESCE(
                           duration_ms,
                           (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER
                       ),
                       tables_ok = COALESCE(tables_ok, 0),
                       tables_failed = GREATEST(COALESCE(tables_failed, 0), 1),
                       total_tables = COALESCE(
                           total_tables,
                           COALESCE(tables_ok, 0) + GREATEST(COALESCE(tables_failed, 0), 1)
                       )
                 WHERE status = 'running'
                """
            )
            n = cur.rowcount
        conn.commit()
        return int(n)
    except Exception:
        conn.rollback()
        raise


# Stable lock-id used by try_acquire_run_lock. PostgreSQL advisory locks
# take a single bigint; this constant is just a project-scoped magic number
# (chosen as a CRC32 of "etl_sync_runs" — value is opaque, what matters is
# that it stays consistent across processes and never collides with any
# other advisory-lock user in the database).
RUN_ADVISORY_LOCK_ID = 0x4554_4C53_524E_5F5F  # bigint, fits in PG's lock id


def try_acquire_run_lock(conn) -> bool:
    """Try to grab the project-wide ETL run advisory lock (non-blocking).

    Returns True when the caller is now the sole owner of the lock and is
    free to call run_full_sync; False when another scheduler instance (or
    a parallel manual trigger that escaped the _is_run_active check) is
    already holding it.

    The lock is session-scoped: it auto-releases when this PG connection
    closes, so a crashed ETL container will release it on its next
    reconnect — no zombie locks across container restarts.

    Why this exists: _is_run_active() reads etl_sync_runs.status, but
    create_run is best-effort and may have failed, leaving no row. In that
    edge case _is_run_active returns False and a second scheduler could
    start a concurrent run. The advisory lock is independent of the
    monitoring rows and survives such failures.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (RUN_ADVISORY_LOCK_ID,))
            got: bool = bool(cur.fetchone()[0])
        conn.commit()
        return got
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        # If we cannot even check the lock, fail closed so we don't run
        # twice in parallel. The next scheduler tick will retry.
        return False


def release_run_lock(conn) -> None:
    """Release the advisory lock acquired by try_acquire_run_lock.

    Safe to call when the lock is not held — pg_advisory_unlock returns
    false in that case but does not raise. We swallow exceptions because
    failing to release is recoverable (the lock auto-frees on connection
    close).
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (RUN_ADVISORY_LOCK_ID,))
            cur.fetchone()
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def record_reconcile(
    conn,
    *,
    run_id: int | None,
    resumen: dict,
    desde: int | None,
    duration_ms: int,
    status: str = "ok",
    error_msg: str | None = None,
) -> None:
    """Deja constancia de una pasada de reconciliacion en etl_reconcile_log.

    Esto es lo que hace auditable el espejo. Hasta ahora la unica senal de que
    una pasada habia ido bien era su duracion, y "3h 37m, completado" se lee
    como una buena noche de trabajo cuando en realidad fue reupsertar filas que
    el delta ya tenia frescas. Lo que dice que el espejo esta CORRECTO es
    cuantas particiones no cuadraban y cuantas filas se corrigieron.

    Una pasada que no reconcilia nada en cuatro minutos es una pasada PERFECTA,
    y hasta ahora era indistinguible de una que no hizo nada porque se murio.

    Best-effort: si esto falla, no se aborta el sync — el dato ya esta
    reconciliado, lo que se pierde es la traza.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_reconcile_log
                    (run_id, tabla, desde, particiones_origen, particiones_revisadas,
                     filas_traidas, filas_borradas, duration_ms, status, error_msg)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id,
                    resumen.get("tabla"),
                    desde,
                    resumen.get("particiones_origen"),
                    resumen.get("particiones_revisadas"),
                    resumen.get("filas_traidas"),
                    resumen.get("filas_borradas"),
                    duration_ms,
                    status,
                    error_msg,
                ),
            )
        conn.commit()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.warning("No se pudo registrar la reconciliacion: %s", exc)


def create_run(conn, trigger: str, kind: str) -> int:
    """Insert an etl_sync_runs record with status='running' and return its id.

    `kind` is the run's mode — 'delta' for the hourly watermark-only sweep
    or 'full' for the nightly everything-pass. Stored as-is so the dashboard
    can render a Delta/Completa pill without recomputing it from per-table
    methods.

    `kind` es OBLIGATORIO a proposito. Antes tenia `= "full"` por defecto, y
    `_record_connection_failure` no lo pasaba: cada job HORARIO que no alcanzaba
    4D quedaba registrado como una COMPLETA fallida. En el panel de ETL eso se
    lee como "el repaso pesado no se hizo" cuando en realidad era un delta que
    se arreglaba solo a la hora siguiente. Tambien envenenaba cualquier metrica
    de "cuantas completas fallan": las 84 filas de "SQL Server is not running"
    del 18 al 21 de agosto eran una por hora durante cuatro dias, todas deltas.

    Y el defecto estaba del reves: si `kind` fuera a tener uno, deberia ser el
    barato y comun, nunca el caro y alarmante. Se quita para que ningun sitio
    nuevo pueda heredarlo por descuido.
    """
    if kind not in ("delta", "full"):
        raise ValueError(f"Invalid run kind: {kind!r} (expected 'delta' or 'full')")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO etl_sync_runs (trigger, kind, status) "
                "VALUES (%s, %s, 'running') RETURNING id",
                (trigger, kind),
            )
            run_id: int = cur.fetchone()[0]
        conn.commit()
        return run_id
    except Exception:
        conn.rollback()
        raise


def finish_run(
    conn,
    run_id: int,
    status: str,
    tables_ok: int,
    tables_failed: int,
    total_rows_synced: int = 0,
) -> None:
    """Update etl_sync_runs with final status, counts, and duration."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_sync_runs
                   SET finished_at       = NOW(),
                       status            = %s,
                       tables_ok         = %s,
                       tables_failed     = %s,
                       total_tables      = %s,
                       total_rows_synced = %s,
                       duration_ms       = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER
                 WHERE id = %s
                """,
                (
                    status,
                    tables_ok,
                    tables_failed,
                    tables_ok + tables_failed,
                    total_rows_synced,
                    run_id,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def insert_fetch_anomalies(
    conn, run_id: int | None, sync_name: str, events: list[dict]
) -> None:
    """Persist fetch-anomaly evidence rows (D-051) — best-effort, never raises.

    Called from etl.main._run_sync after every sync_fn call, once for each
    event etl.db.fourd.drain_anomaly_log() returned. This is diagnostic-only:
    the human-readable summary is already folded into
    etl_sync_run_tables.error_msg by the caller regardless of whether this
    INSERT succeeds, so a failure here (schema drift, a transient connection
    blip) must never take the sync down with it — own try/except, own
    rollback, swallow and log instead of propagating.
    """
    if not events:
        return
    from psycopg2.extras import Json  # type: ignore[import-untyped]

    try:
        with conn.cursor() as cur:
            for event in events:
                cur.execute(
                    """
                    INSERT INTO etl_fetch_anomalies (
                        run_id, sync_name, sql_text, total_rows, refetch_total_rows,
                        anomaly_count, first_index, last_index, index_ranges,
                        page_size, run_start_mod_100, run_end_mod_100,
                        page_aligned_end, kinds, sample, refetch_outcome
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        sync_name,
                        event.get("sql_text"),
                        event.get("total_rows"),
                        event.get("refetch_total_rows"),
                        event.get("anomaly_count"),
                        event.get("first_index"),
                        event.get("last_index"),
                        event.get("index_ranges"),
                        event.get("page_size"),
                        event.get("run_start_mod_100"),
                        event.get("run_end_mod_100"),
                        event.get("page_aligned_end"),
                        Json(event.get("kinds")),
                        Json(event.get("sample")),
                        event.get("refetch_outcome"),
                    ),
                )
        conn.commit()
    except Exception:
        logger.error(
            "insert_fetch_anomalies: failed to persist %d evidence row(s) for "
            "%s — sync continues, this table is diagnostic-only",
            len(events),
            sync_name,
            exc_info=True,
        )
        try:
            conn.rollback()
        except Exception:
            logger.debug("insert_fetch_anomalies: rollback also failed", exc_info=True)


def record_table_sync(
    conn,
    run_id: int | None = None,
    table_name: str | None = None,
    rows_synced: int = 0,
    duration_ms: int = 0,
    *,
    status: str = "ok",
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    sync_method: str | None = None,
    rows_total_after: int | None = None,
    watermark_from: datetime | None = None,
    watermark_to: datetime | None = None,
    error_msg: str | None = None,
    trace_id: str | None = None,
    span_id: str | None = None,
) -> None:
    """Insert a per-table sync record into etl_sync_run_tables."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_sync_run_tables
                    (run_id, table_name, rows_synced, duration_ms, status,
                     started_at, finished_at, sync_method, rows_total_after,
                     watermark_from, watermark_to, error_msg, trace_id, span_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id,
                    table_name,
                    rows_synced,
                    duration_ms,
                    status,
                    started_at,
                    finished_at,
                    sync_method,
                    rows_total_after,
                    watermark_from,
                    watermark_to,
                    error_msg,
                    trace_id,
                    span_id,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def update_run_trace_context(
    conn,
    run_id: int,
    trace_id: str | None,
    span_id: str | None,
) -> None:
    """Persist OTel trace_id and span_id on an etl_sync_runs row.

    Called immediately after create_run() once the parent span is active.
    Silently no-ops if both values are None (SDK not initialised).
    """
    if trace_id is None and span_id is None:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE etl_sync_runs SET trace_id = %s, span_id = %s WHERE id = %s",
                (trace_id, span_id, run_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def check_and_consume_trigger(conn) -> int | None:
    """Atomically pick up one pending trigger row.

    Returns the trigger row id if a trigger was found and picked up, None otherwise.
    Uses FOR UPDATE SKIP LOCKED so concurrent processes never double-pick.

    Note: the force-resync metadata (``force_full``, ``force_tables``) is not
    returned here; call :func:`get_trigger_force_flags` with the id to read
    those fields. Keeping this helper's return type stable preserves backward
    compatibility with callers that expect a plain int.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_manual_trigger
                SET status = 'picked_up', picked_up_at = NOW()
                WHERE id = (
                    SELECT id FROM etl_manual_trigger
                    WHERE status = 'pending'
                    ORDER BY requested_at, id
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id
                """
            )
            row = cur.fetchone()
            conn.commit()
            return row[0] if row is not None else None
    except Exception:
        conn.rollback()
        raise


def get_trigger_force_flags(
    conn, trigger_id: int
) -> tuple[bool, list[str], str | None]:
    """Return ``(force_full, force_tables, triggered_by)`` for *trigger_id*.

    Used by the scheduler after ``check_and_consume_trigger`` claims a row:
    the scheduler needs to know whether to reset watermarks before calling
    :func:`run_full_sync`. Missing/unknown ids return ``(False, [], None)`` so
    the scheduler treats them as a plain incremental sync.

    ``triggered_by`` is an audit string identifying who requested the sync (e.g.
    a client IP address, ``"dashboard"``, or ``"cli"``). May be ``None`` for
    legacy rows inserted before this column was added.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT force_full, force_tables, triggered_by"
                " FROM etl_manual_trigger WHERE id = %s",
                (trigger_id,),
            )
            row = cur.fetchone()
            conn.commit()
            if row is None:
                return (False, [], None)
            force_full, force_tables, triggered_by = row
            return (
                bool(force_full),
                list(force_tables) if force_tables else [],
                triggered_by,
            )
    except Exception:
        conn.rollback()
        raise


def create_manual_trigger(
    conn,
    *,
    force_full: bool = False,
    force_tables: Sequence[str] | None = None,
    triggered_by: str = "dashboard",
) -> int:
    """Insert a pending manual trigger row and return its id.

    The partial unique index on ``status='pending'`` guarantees at most one
    pending row exists at a time; callers that race can catch the resulting
    ``UniqueViolation`` and fall back to fetching the existing pending row.

    Args:
        force_full: if ``True``, the ETL will reset all watermarks before the run.
        force_tables: optional list of sync names whose watermarks should be
            cleared before the run. Ignored when ``force_full=True``. Caller is
            responsible for validating names against the known sync registry —
            this helper only ensures ``force_tables`` is serialised as a
            ``TEXT[]`` (never ``NULL``).
        triggered_by: audit string identifying the requester (e.g. client IP,
            ``"dashboard"``, ``"cli"``). Stored verbatim; no validation performed
            here — callers are responsible for sanitising untrusted input.
    """
    tables = list(force_tables) if force_tables else []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_manual_trigger (status, force_full, force_tables, triggered_by)
                VALUES ('pending', %s, %s, %s)
                RETURNING id
                """,
                (bool(force_full), tables, triggered_by),
            )
            trigger_id: int = cur.fetchone()[0]
        conn.commit()
        return int(trigger_id)
    except Exception:
        conn.rollback()
        raise


def reset_watermarks(conn, table_names: Sequence[str]) -> int:
    """Delete watermark rows for *table_names* so the next run re-materialises them.

    Returns the number of deleted rows. A table name that has no watermark row
    (e.g. the first time the sync runs) is a silent no-op. Commits on success;
    rolls back and re-raises on failure.

    An empty ``table_names`` argument is a no-op and returns 0 — never deletes
    every watermark by accident. Use a separate explicit helper (or pass the
    full registry) to wipe all watermarks.
    """
    if not table_names:
        return 0

    names = list(table_names)
    try:
        _ensure_watermarks_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM etl_watermarks WHERE table_name = ANY(%s)",
                (names,),
            )
            deleted = cur.rowcount
        conn.commit()
        return int(deleted)
    except Exception:
        conn.rollback()
        raise


def update_trigger_run_id(conn, trigger_id: int, run_id: int) -> None:
    """Set run_id on the trigger row with the given trigger_id."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE etl_manual_trigger SET run_id = %s WHERE id = %s",
                (run_id, trigger_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def set_watermark_error(
    conn,
    table_name: str,
    error_msg: str | None = None,
) -> None:
    """Record a FAILED sync attempt without moving ``last_sync_at``.

    Esta funcion existe por una razon concreta: el camino de error llamaba a
    :func:`set_watermark` con ``last_sync_at = now()``, y el ON CONFLICT lo
    escribe igual que en el camino correcto. O sea que un intento FALLIDO
    adelantaba la marca igual que uno bueno.

    La consecuencia es perdida de datos silenciosa y permanente. El delta
    siguiente calcula ``since = last_sync_at - lookback_days``, asi que la
    ventana arranca en el ultimo INTENTO, no en el ultimo EXITO. Si una tabla
    falla dos dias seguidos sin que se cuele un barrido con ``since=None``, las
    filas modificadas en esos dias no se vuelven a mirar JAMAS: el delta nunca
    retrocede.

    No es teorico. En el run 41 (2026-04-23) ``stock`` y ``traspasos`` se
    recuperaron tras fallar desde el 18 de abril y su ventana empezo el 23:
    cinco dias de modificaciones saltados, rescatados solo por el siguiente
    barrido completo. Auditando los 16.144 deltas correctos del historico
    aparecen esos dos como unicos casos, porque hoy el "full" nocturno
    (``since=2014-01-01``) tapa el agujero cada noche. Es decir: la seguridad
    del delta depende hoy del mismo run que falla 114 de 151 veces.

    Por eso ``last_sync_at`` NO esta en el DO UPDATE SET. Un fallo deja la
    marca donde estaba y el proximo intento vuelve a cubrir la ventana entera.

    Si la tabla no tiene marca todavia (primer sync de su vida, y fallo), se
    inserta con la epoca: ``get_watermark`` devolvera 1970 y el siguiente
    intento se traera todo, que es justo lo que hace falta.

    Commits on success; rolls back and re-raises on failure.
    """
    try:
        _ensure_watermarks_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_watermarks
                    (table_name, last_sync_at, rows_synced, status, error_msg, updated_at)
                VALUES (%s, TIMESTAMPTZ 'epoch', 0, 'error', %s, NOW())
                ON CONFLICT (table_name) DO UPDATE SET
                    rows_synced = 0,
                    status      = 'error',
                    error_msg   = EXCLUDED.error_msg,
                    updated_at  = NOW()
                """,
                (table_name, error_msg),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def set_watermark(
    conn,
    table_name: str,
    last_sync_at: datetime,
    rows_synced: int,
    status: str = "ok",
    error_msg: str | None = None,
) -> None:
    """Upsert the watermark record for *table_name*.

    *last_sync_at* must be timezone-aware.  Naive datetimes would be interpreted
    by PostgreSQL's TIMESTAMPTZ column using the session time zone, which can
    silently shift the watermark and break delta-sync logic.  A ValueError is
    raised to make the contract explicit.

    Commits on success; rolls back and re-raises on failure.
    """
    # A datetime is "naive" if tzinfo is None OR if utcoffset() returns None
    # (some tzinfo subclasses can be set but still return None for utcoffset).
    if last_sync_at.tzinfo is None or last_sync_at.utcoffset() is None:
        raise ValueError(
            "set_watermark: last_sync_at must be a fully timezone-aware datetime. "
            "Use datetime(..., tzinfo=timezone.utc) or .replace(tzinfo=timezone.utc)."
        )
    # Normalize to UTC before writing so the stored value is unambiguous.
    from datetime import timezone as _tz

    last_sync_at = last_sync_at.astimezone(_tz.utc)

    try:
        _ensure_watermarks_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_watermarks
                    (table_name, last_sync_at, rows_synced, status, error_msg, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (table_name) DO UPDATE SET
                    last_sync_at = EXCLUDED.last_sync_at,
                    rows_synced  = EXCLUDED.rows_synced,
                    status       = EXCLUDED.status,
                    error_msg    = EXCLUDED.error_msg,
                    updated_at   = NOW()
                """,
                (table_name, last_sync_at, rows_synced, status, error_msg),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
