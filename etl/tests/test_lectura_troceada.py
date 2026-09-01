"""D-059 troceó la INSERCIÓN; la LECTURA seguía materializándolo todo.

`safe_fetch` hace `fetchall()` y después construye un dict por fila, así que
durante la conversión conviven en memoria el millón de tuplas crudas Y el
millón de diccionarios. Con 2 GiB de límite y `ps_gc_lin_albarane` en 1,05 M de
filas, eso mata al contenedor: 11 pasadas full muertas en 3 días, sin traceback,
salida limpia y reinicio.

Y cada muerte reinicia y lanza otro full inmediato contra un 4D que aún está
digiriendo el statement abandonado — lo que multiplica las papeletas de que
alguna lectura venga truncada.
"""

import pytest

from etl.db.fourd import (
    FetchAnomalyError,
    FetchTruncatedError,
    safe_fetch_streaming,
)


class _Cursor:
    def __init__(self, declaradas, filas, columnas=None):
        self.rowcount = declaradas
        self._filas = list(filas)
        self._i = 0
        self.description = [(c.encode(),) for c in (columnas or ["reg", "codigo"])]
        self.cerrado = False
        self.peticiones = []

    def execute(self, _sql):
        pass

    def fetchmany(self, n):
        trozo = self._filas[self._i : self._i + n]
        self._i += len(trozo)
        self.peticiones.append(len(trozo))
        return trozo

    def close(self):
        self.cerrado = True


class _Conn:
    def __init__(self, cursor):
        self._c = cursor

    def cursor(self):
        return self._c


def _filas(n):
    return [(float(i), f"c{i}") for i in range(n)]


def test_no_materializa_el_resultado_entero():
    """Se pide por trozos: el objetivo entero del cambio."""
    cur = _Cursor(1000, _filas(1000))
    declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=100
    )
    assert declaradas == 1000
    # Aún no se ha pedido nada: el iterador es perezoso.
    assert cur.peticiones == []
    primera = next(it)
    assert primera == {"reg": 0.0, "codigo": "c0"}
    # Se ha pedido UN trozo, no las mil filas.
    assert cur.peticiones == [100]


def test_entrega_todas_las_filas_y_en_orden():
    cur = _Cursor(250, _filas(250))
    _declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=100
    )
    todas = list(it)
    assert len(todas) == 250
    assert todas[0]["codigo"] == "c0"
    assert todas[-1]["codigo"] == "c249"


def test_una_lectura_truncada_revienta_al_final():
    """El servidor declara 1000 y sólo llegan 800: 8 páginas exactas."""
    cur = _Cursor(1000, _filas(800))
    _declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=100
    )
    with pytest.raises(FetchTruncatedError) as e:
        list(it)
    assert "1000" in str(e.value) and "800" in str(e.value)


def test_una_fila_anomala_aborta_en_vez_de_persistirse():
    """En troceado no se refetchea: las filas anteriores ya se entregaron.

    Abortar es seguro porque el consumidor carga en UNA transacción, así que la
    tabla se queda intacta. Y es la decisión correcta a la luz del incidente:
    persistir lo dudoso es lo que borró el 43 % del catálogo.
    """
    filas = _filas(150)
    filas[120] = (None, None)  # fila todo-NULL, la firma de la corrupción
    cur = _Cursor(150, filas)
    _declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=100
    )
    with pytest.raises(FetchAnomalyError):
        list(it)


def test_sin_rowcount_no_se_puede_garantizar_nada():
    """En troceado, sin total declarado una truncación es indetectable."""
    cur = _Cursor(-1, _filas(10))
    with pytest.raises(RuntimeError, match="no declaro el numero de filas"):
        safe_fetch_streaming(_Conn(cur), "SELECT reg, codigo FROM t")


def test_el_cursor_se_cierra_siempre():
    cur = _Cursor(100, _filas(100))
    _declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=50
    )
    list(it)
    assert cur.cerrado, "el cursor quedó abierto tras agotar el iterador"


def test_el_cursor_se_cierra_tambien_si_revienta():
    cur = _Cursor(500, _filas(100))
    _declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=50
    )
    with pytest.raises(FetchTruncatedError):
        list(it)
    assert cur.cerrado, "el cursor quedó abierto tras un fallo"


def test_tabla_vacia():
    cur = _Cursor(0, [])
    declaradas, it = safe_fetch_streaming(_Conn(cur), "SELECT reg, codigo FROM t")
    assert declaradas == 0
    assert list(it) == []


# --- Lo que importa de verdad: leer e insertar INTERCALADOS ----------------


def test_lee_e_inserta_intercalado_no_lee_todo_primero(monkeypatch):
    """Prueba el objetivo entero: nunca hay más de un trozo vivo en memoria.

    Si la lectura se completara antes de empezar a insertar, el pico de memoria
    seguiría siendo el resultado entero y no habríamos arreglado nada.
    """
    from etl.db import postgres

    orden = []

    class _CursorPg:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            if "TRUNCATE" in str(sql).upper():
                orden.append("truncate")

        def fetchone(self):
            return None  # sin histórico -> la guarda se abstiene

    class _ConnPg:
        def cursor(self):
            return _CursorPg()

        def commit(self):
            orden.append("commit")

        def rollback(self):
            pass

    monkeypatch.setattr(
        "psycopg2.extras.execute_values",
        lambda *a, **k: orden.append("insert"),
    )

    cur = _Cursor(300, _filas(300))
    original = cur.fetchmany

    def fetchmany_vigilado(n):
        trozo = original(n)
        if trozo:
            orden.append("lee")
        return trozo

    cur.fetchmany = fetchmany_vigilado

    declaradas, it = safe_fetch_streaming(
        _Conn(cur), "SELECT reg, codigo FROM t", chunk_size=100
    )
    postgres.truncate_and_insert_streaming(
        _ConnPg(),
        "t",
        it,
        lambda r: {"a": r["codigo"]},
        chunk_size=100,
        filas_origen=declaradas,
    )

    lecturas = [i for i, p in enumerate(orden) if p == "lee"]
    inserciones = [i for i, p in enumerate(orden) if p == "insert"]
    assert len(lecturas) >= 3 and len(inserciones) >= 3

    # LO CLAVE: hay al menos una lectura DESPUÉS de la primera inserción.
    # Si se leyera todo por delante, todas las lecturas irían antes.
    assert any(i > inserciones[0] for i in lecturas), (
        f"se leyó todo antes de insertar; orden={orden}"
    )
