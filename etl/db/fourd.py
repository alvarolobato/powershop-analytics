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
import os
import re
from dataclasses import dataclass
from decimal import Decimal
from collections.abc import Iterator
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
#: Filas que el servidor 4D manda por cada viaje de red.
#:
#: El driver trae 100 por defecto, y con eso un millon de filas son 10.000
#: viajes -- y cada viaje es una oportunidad para el fallo que vacio media
#: tabla el 2026-09-01: `fourd_next_row` no distingue un FETCH-RESULT fallido
#: del fin de los datos, asi que un tropiezo de red se entrega como resultado
#: completo. A 5000 son 200 viajes: 50 veces menos exposicion.
#:
#: Medido contra el 4D de produccion sobre Articulos (42.275 filas): 27,8 s con
#: 100, 26,9 s con 5000, lectura integra en ambos casos. NO se gana velocidad
#: -- la diferencia es ruido --; se gana superficie de fallo.
_P4D_FETCH_PAGE_SIZE = int(os.environ.get("P4D_PAGE_SIZE", "5000"))

#: Tamano de pagina para el ANALISIS de anomalias, que es cosa distinta del
#: tamano que se pide al servidor.
#:
#: Los campos de evidencia se llaman `run_start_mod_100` / `run_end_mod_100` y
#: viven asi en `etl_fetch_anomalies`, con historico. Atarlos al tamano
#: configurable haria que esos nombres mintieran y que el historico dejara de
#: ser comparable entre pasadas con distinta configuracion. El analisis sigue
#: razonando sobre 100, que es el tamano con el que se registraron los casos
#: conocidos; el `page_size` real de cada lectura se guarda aparte, en la
#: columna `page_size`.
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
        "page_size": _P4D_FETCH_PAGE_SIZE,
        "run_start_mod_100": first_index % _P4D_PAGE_SIZE,
        "run_end_mod_100": last_index % _P4D_PAGE_SIZE,
        "page_aligned_end": last_index % _P4D_PAGE_SIZE == _P4D_PAGE_SIZE - 1,
        "kinds": kinds,
        "sample": sample[:5],
        "refetch_outcome": None,
    }


def _fijar_pagina(cursor) -> None:
    """Ajusta el tamano de pagina del cursor, si el driver lo permite.

    `cursor.pagesize` es asignable en p4d 1.8 (comprobado contra produccion:
    acepta 5000). Un driver que no lo exponga no debe tumbar la lectura.
    """
    try:
        cursor.pagesize = _P4D_FETCH_PAGE_SIZE
    except Exception:  # noqa: BLE001 - un cursor sin `pagesize` sigue valiendo
        pass


def _fetch_raw(conn, sql: str) -> tuple[list[str], list[tuple]]:
    """Execute *sql* and return (lowercased column names, raw row tuples).

    No value decoding/dict-building here — that happens in _rows_to_dicts()
    so scan_rows_for_anomalies() can inspect raw values (e.g. real Python
    ``float`` NaN/Inf) before ``_decode_value()`` has a chance to touch them.
    """
    cursor = conn.cursor()
    try:
        _fijar_pagina(cursor)
        cursor.execute(sql)
        if cursor.description is None:
            raise RuntimeError(
                f"Query returned no column metadata (non-SELECT or p4d quirk): {sql[:200]}"
            )
        columns = [_decode_column_name(desc[0]) for desc in cursor.description]

        # El servidor 4D declara CUANTAS filas tiene el statement en su
        # respuesta al EXECUTE, antes de enviar ninguna. p4d lo expone aqui,
        # sin leer todavia una sola fila. Es la unica forma que tenemos de
        # saber si la lectura llego entera -- ver el porque abajo.
        # `getattr` y no `cursor.rowcount`: un cursor sin ese atributo no debe
        # tumbar el ETL entero. Con p4d siempre esta (verificado contra el 4D
        # de produccion), asi que en el camino real la comprobacion siempre
        # corre; esto solo evita que un cursor atipico rompa la carga.
        declaradas = getattr(cursor, "rowcount", None)

        rows = cursor.fetchall()
    finally:
        cursor.close()

    # ── Por que hace falta comprobar esto ────────────────────────────────────
    #
    # El driver NO distingue "se acabaron los datos" de "fallo la red". En
    # `fourd.c:176`:
    #
    #     if(res->numRow >= res->row_count) return 0;        /* fin legitimo */
    #     if(res->numRow > res->first_row + res->row_count_sent - 1) {
    #         if(_fetch_result(res,123))  return 0;          /* FALLO: tambien 0 */
    #     }
    #
    # Los dos casos devuelven 0, y en Python (`p4d.py:474`) 0 se traduce a
    # `None`, que `fetchall()` interpreta como final limpio. Un fallo de red a
    # mitad de la paginacion se convierte en un resultado corto y CORRECTO a
    # ojos del llamador: ni excepcion, ni aviso, nada.
    #
    # Ademas `__fetch_result` (`fourd_interne.c:322-338`) descarta el valor de
    # retorno de `socket_receiv_data`, asi que si el parseo de una pagina falla
    # a mitad, el resto de esa pagina queda sin rellenar y llega como filas
    # todo-NULL.
    #
    # Eso paso el 2026-09-01 con Articulos: el servidor declaro 42.275, la
    # pagina 398 se recibio hasta su fila 71 y el resto llego como 29 filas
    # vacias, el siguiente FETCH-RESULT fallo sobre la conexion ya rota y
    # `fetchall()` devolvio 39.800 filas -- 398 paginas exactas de 100 -- sin
    # una sola queja. Se escribieron en el espejo y la pasada se marco `ok`:
    # el 43 % del catalogo desaparecio y el dashboard empezo a responder que no
    # habia datos de la temporada V26.
    #
    # Comparar con `rowcount` cuesta cero (ya viene en la respuesta al EXECUTE),
    # no tiene carrera -- las filas y el total salen del MISMO statement, cosa
    # que un `SELECT COUNT(*)` aparte no garantiza -- y cubre todos los caminos:
    # full, delta, streaming y upsert.
    if declaradas is not None and declaradas >= 0 and len(rows) != declaradas:
        raise FetchTruncatedError(
            f"lectura incompleta: el servidor declaro {declaradas} filas y "
            f"llegaron {len(rows)} ({declaradas - len(rows)} menos). El driver "
            f"no distingue un fallo de red del fin de los datos, asi que una "
            f"lectura corta llega sin error. Se aborta en vez de escribir "
            f"datos incompletos. SQL: {sql[:200]}"
        )

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


class FetchAnomalyError(RuntimeError):
    """Se hallo una fila anomala durante una lectura troceada.

    En modo troceado no se refetchea para discriminar: las filas anteriores ya
    se han entregado. Se aborta, y como el consumidor carga en una sola
    transaccion, la tabla se queda intacta.
    """


class FetchTruncatedError(RuntimeError):
    """Llegaron menos filas de las que el servidor 4D dijo que tenia.

    Es la deteccion de raiz: el driver convierte un fallo de red a mitad de la
    paginacion en un final de resultados limpio, asi que sin esta comprobacion
    una lectura truncada es indistinguible de una completa. Ver el comentario
    largo en `_fetch_raw`.
    """


class FetchShrankError(RuntimeError):
    """El refetch del guardian trajo bastantes menos filas que el fetch original.

    Ver el comentario en `safe_fetch`. Se lanza en vez de devolver la lectura
    corta, para que la pasada falle de forma visible en lugar de escribir medio
    catalogo y marcarse `ok`.
    """


#: Cuanto puede encoger un refetch antes de considerarse un segundo fallo.
_MAX_REFETCH_SHRINK_RATIO = 0.05

#: Por debajo de esto la guarda no aplica: en lecturas diminutas un par de
#: filas de diferencia es un porcentaje enorme y no significa nada.
_SHRINK_GUARD_MIN_ROWS = 100


def _conexion_limpia_o_la_de_siempre(conn) -> tuple[object, bool]:
    """Devuelve (conexion_para_el_refetch, hay_que_cerrarla).

    Intenta abrir una conexion nueva al 4D para que el refetch no herede el
    estado de la que acaba de dar problemas. Si no se puede -- credenciales no
    disponibles en este contexto, servidor rechazando conexiones nuevas --,
    devuelve la original y que el refetch haga lo que pueda.
    """
    try:
        from etl.config import Config

        return get_connection(Config()), True
    except Exception as exc:  # noqa: BLE001 - cualquier fallo cae a la de siempre
        logger.warning(
            "safe_fetch: no se pudo abrir una conexion nueva para el refetch "
            "(%s); se reusa la original, que puede estar desincronizada",
            exc,
        )
        return conn, False


def safe_fetch_streaming(
    conn,
    sql: str,
    *,
    guard_pk: str | None = None,
    chunk_size: int = 50_000,
) -> tuple[int, Iterator[dict]]:
    """Como `safe_fetch`, pero sin materializar el resultado entero.

    Devuelve `(filas_declaradas_por_el_servidor, iterador_de_dicts)`.

    Por que existe
    --------------
    `safe_fetch` hace `fetchall()` y despues `_rows_to_dicts()`, asi que durante
    la conversion conviven en memoria el millon de tuplas crudas Y el millon de
    diccionarios. D-059 arreglo la mitad del problema -- la INSERCION va por
    lotes -- pero la LECTURA seguia materializandolo todo, y es la que mata al
    proceso: 11 pasadas full muertas en 3 dias, sin traceback, salida limpia y
    contenedor reiniciado. Con 2 GiB de limite y `ps_gc_lin_albarane` en 1,05 M
    de filas, no hay margen.

    Y no es solo el coste de la caida: cada muerte reinicia el contenedor, que
    lanza otro full inmediato contra un 4D que todavia esta digiriendo el
    statement abandonado. Esa concentracion de lecturas grandes de madrugada es
    lo que multiplica las papeletas de que una venga truncada.

    Diferencia de comportamiento, deliberada
    ----------------------------------------
    Aqui una anomalia ABORTA en vez de refetchear y discriminar. No se puede
    "devolver el refetch en su lugar" cuando las filas ya se han entregado
    aguas abajo. Y abortar es seguro justamente aqui, porque el unico consumidor
    es `truncate_and_insert_streaming`, que trabaja en UNA transaccion: al
    propagarse la excepcion se deshace la carga entera y la tabla se queda como
    estaba.

    Ademas es la decision correcta a la luz de lo ocurrido: persistir lo dudoso
    es lo que hizo desaparecer el 43 % del catalogo el 2026-09-01. Las tablas
    pequenas conservan la discriminacion por refetch, que ahi si vale la pena.
    """
    cursor = conn.cursor()
    try:
        _fijar_pagina(cursor)
        cursor.execute(sql)
        if cursor.description is None:
            raise RuntimeError(
                f"Query returned no column metadata (non-SELECT or p4d quirk): {sql[:200]}"
            )
        columns = [_decode_column_name(desc[0]) for desc in cursor.description]
        declaradas = getattr(cursor, "rowcount", None)
    except Exception:
        cursor.close()
        raise

    if declaradas is None or declaradas < 0:
        cursor.close()
        raise RuntimeError(
            f"el servidor no declaro el numero de filas, y sin ese dato una "
            f"lectura truncada es indetectable en modo troceado. SQL: {sql[:200]}"
        )

    def _iterar() -> Iterator[dict]:
        leidas = 0
        try:
            while True:
                # `fetchone()` en bucle, NO `cursor.fetchmany()`.
                #
                # `fetchmany` de p4d 1.8 esta roto: su cuerpo hace
                # `if row is none:` -- con `none` en minuscula -- que es un
                # NameError. Solo se alcanza esa linea cuando `fetchone()`
                # devuelve None, o sea al terminar el resultado, asi que
                # `fetchmany` revienta SIEMPRE en el ultimo trozo. Comprobado
                # contra el driver instalado en produccion.
                trozo = []
                for _ in range(chunk_size):
                    fila = cursor.fetchone()
                    if fila is None:
                        break
                    trozo.append(fila)
                if not trozo:
                    break
                anomalias = scan_rows_for_anomalies(columns, trozo, guard_pk)
                if anomalias:
                    evidencia = _build_evidence(sql, trozo, anomalias)
                    evidencia["refetch_outcome"] = "streaming_abort"
                    _anomaly_log.append(evidencia)
                    raise FetchAnomalyError(
                        f"lectura troceada abortada: {len(anomalias)} fila(s) "
                        f"anomala(s) en el trozo que empieza en la fila {leidas}. "
                        f"En modo troceado no se refetchea -- las filas ya "
                        f"entregadas no se pueden retirar -- asi que se aborta y "
                        f"la transaccion de carga se deshace entera. "
                        f"SQL: {sql[:200]}"
                    )
                for fila in _rows_to_dicts(columns, trozo, sql):
                    yield fila
                leidas += len(trozo)

            if leidas != declaradas:
                raise FetchTruncatedError(
                    f"lectura incompleta: el servidor declaro {declaradas} filas "
                    f"y llegaron {leidas} ({declaradas - leidas} menos). "
                    f"SQL: {sql[:200]}"
                )
        finally:
            cursor.close()

    return declaradas, _iterar()


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
        # El refetch va por una conexion NUEVA, no por la que acaba de fallar.
        #
        # Antes reusaba la misma, y ese es un error de bulto: si la anomalia
        # viene de un desync del protocolo -- que es justo lo que produce las
        # filas todo-NULL y las lecturas cortas -- la conexion esta rota, y
        # volver a leer por ella no discrimina nada. El 2026-09-01 el refetch
        # sobre la conexion rota trajo 23.900 filas donde el original traia
        # 39.800, y esa lectura aun peor se dio por buena.
        #
        # Si no se puede abrir una nueva, se cae de vuelta a la vieja: es mejor
        # un refetch imperfecto que ninguno.
        conn_refetch, hay_que_cerrarla = _conexion_limpia_o_la_de_siempre(conn)
        try:
            refetch_columns, refetch_rows = _fetch_raw(conn_refetch, sql)
        finally:
            if hay_que_cerrarla:
                try:
                    conn_refetch.close()
                except Exception:
                    pass
    except Exception:
        evidence["refetch_outcome"] = "refetch_failed"
        _anomaly_log.append(evidence)
        raise

    refetch_anomalies = scan_rows_for_anomalies(refetch_columns, refetch_rows, guard_pk)
    evidence["refetch_total_rows"] = len(refetch_rows)

    # Un refetch MAS CORTO que el original no es un refetch limpio: es un
    # segundo fallo, peor que el primero. Las dos ramas de abajo devuelven las
    # filas del refetch, y ninguna comparaba el volumen -- asi que el
    # 2026-09-01 la pasada 1553 pidio 39.800 articulos, el refetch trajo 23.900
    # y se persistio el corto: 43 % del catalogo perdido, la pasada marcada
    # `ok`, y el dashboard respondiendo que no habia datos de la temporada V26.
    #
    # Crecer esta bien (filas nuevas entre las dos lecturas). Encoger, no.
    if len(rows) >= _SHRINK_GUARD_MIN_ROWS and len(refetch_rows) < len(rows) * (
        1 - _MAX_REFETCH_SHRINK_RATIO
    ):
        evidence["refetch_outcome"] = "refetch_shrank"
        _anomaly_log.append(evidence)
        raise FetchShrankError(
            f"refetch devolvio {len(refetch_rows)} filas donde el fetch "
            f"original trajo {len(rows)}. Un refetch que encoge no discrimina "
            f"nada: se aborta en vez de escribir la lectura corta. SQL: "
            f"{sql[:200]}"
        )

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
