"""El driver p4d confunde un fallo de red con el fin de los datos.

En `fourd.c:176`, `fourd_next_row` devuelve 0 tanto cuando se acabaron las
filas como cuando falla el `FETCH-RESULT` de la pagina siguiente. En Python eso
se traduce a `None` y `fetchall()` lo interpreta como final limpio: una lectura
truncada llega al llamador sin excepcion ni aviso, y es indistinguible de una
completa.

El 2026-09-01 con Articulos: el servidor declaro 42.275 filas, la pagina 398 se
recibio hasta su fila 71, las 29 restantes llegaron todo-NULL, el siguiente
FETCH-RESULT fallo sobre la conexion ya rota y `fetchall()` devolvio 39.800
(398 paginas exactas de 100). Se escribieron y la pasada se marco `ok`.

La deteccion: el servidor declara el total en la respuesta al EXECUTE y p4d lo
expone en `cursor.rowcount` ANTES de leer una sola fila. Verificado contra el 4D
de produccion el 2026-09-01: rowcount = 42275, fetchall() = 42275.
"""

import pytest

from etl.db.fourd import FetchTruncatedError, _fetch_raw


class _CursorFalso:
    """Imita a p4d: declara `rowcount` y devuelve las filas que se le digan."""

    def __init__(self, declaradas, filas):
        self.rowcount = declaradas
        self._filas = filas
        self.description = [(b"REGARTICULO",), (b"CODIGO",)]

    def execute(self, _sql):
        pass

    def fetchall(self):
        return self._filas

    def close(self):
        pass


class _ConnFalsa:
    def __init__(self, declaradas, filas):
        self._c = _CursorFalso(declaradas, filas)

    def cursor(self):
        return self._c


def _filas(n):
    return [(float(i), f"cod{i}") for i in range(n)]


def test_el_incidente_real_se_detecta():
    """39.800 llegadas contra 42.275 declaradas: la lectura vino corta."""
    conn = _ConnFalsa(42275, _filas(39800))
    with pytest.raises(FetchTruncatedError) as e:
        _fetch_raw(conn, "SELECT RegArticulo, Codigo FROM Articulos")
    assert "42275" in str(e.value)
    assert "39800" in str(e.value)


def test_una_lectura_completa_pasa():
    conn = _ConnFalsa(42275, _filas(42275))
    columnas, filas = _fetch_raw(conn, "SELECT RegArticulo, Codigo FROM Articulos")
    assert len(filas) == 42275
    assert columnas == ["regarticulo", "codigo"]


def test_una_tabla_vacia_es_legitima():
    conn = _ConnFalsa(0, [])
    _columnas, filas = _fetch_raw(conn, "SELECT RegArticulo, Codigo FROM Articulos")
    assert filas == []


def test_falta_una_sola_fila_y_tambien_se_detecta():
    """No hay tolerancia: o llegan todas o la lectura no vale."""
    conn = _ConnFalsa(1000, _filas(999))
    with pytest.raises(FetchTruncatedError):
        _fetch_raw(conn, "SELECT x FROM t")


def test_sin_rowcount_no_se_bloquea():
    """Algunos statements no declaran total (-1). No se puede comprobar."""
    conn = _ConnFalsa(-1, _filas(10))
    _columnas, filas = _fetch_raw(conn, "SELECT x FROM t")
    assert len(filas) == 10


@pytest.mark.parametrize("declaradas,llegadas", [(42275, 39800), (557000, 103600)])
def test_las_dos_truncaciones_conocidas(declaradas, llegadas):
    """Articulos el 01/09 y ventas el 29/08. Ambas terminan en multiplo de 100."""
    assert llegadas % 100 == 0, "la firma: la lectura corta acaba en limite de pagina"
    conn = _ConnFalsa(declaradas, _filas(llegadas))
    with pytest.raises(FetchTruncatedError):
        _fetch_raw(conn, "SELECT x FROM t")
