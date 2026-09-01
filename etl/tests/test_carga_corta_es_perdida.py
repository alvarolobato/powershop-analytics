"""El 2026-09-01 un full refresh escribio medio catalogo y se marco `ok`.

Pasada 1553: `ps_articulos` paso de 42.275 filas a 23.898. El guardian de
anomalias (D-051) SI vio la corrupcion -- 29 filas todo-NULL en los indices
39771-39799 -- y la registro en `etl_fetch_anomalies`, pero el refetch trajo
23.900 filas donde el original traia 39.800 y se persistio el corto, porque
nada comparaba el volumen.

Consecuencia visible: el dashboard empezo a responder que no habia datos de la
temporada V26. Los habia; se habian perdido en el traslado.
"""

import pytest

from etl.db.postgres import (
    FullRefreshShrankError,
    _guard_full_refresh_shrink,
)


class _CursorFalso:
    def __init__(self, actual):
        self._actual = actual

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, _sql):
        pass

    def fetchone(self):
        return (self._actual,)


class _ConnFalsa:
    def __init__(self, actual):
        self._actual = actual

    def cursor(self):
        return _CursorFalso(self._actual)


def test_el_incidente_real_habria_fallado():
    """23.898 filas entrantes contra 42.275 existentes: eso es perdida de datos."""
    with pytest.raises(FullRefreshShrankError) as e:
        _guard_full_refresh_shrink(_ConnFalsa(42275), "ps_articulos", 23898)
    assert "23898" in str(e.value)
    assert "42275" in str(e.value)
    # el mensaje dice el porcentaje, para que el operador vea la magnitud
    assert "43" in str(e.value)


def test_cero_filas_no_vacia_la_tabla():
    """Un corte del 4D devolvia una lista vacia y se truncaba el catalogo entero."""
    with pytest.raises(FullRefreshShrankError):
        _guard_full_refresh_shrink(_ConnFalsa(42275), "ps_articulos", 0)


@pytest.mark.parametrize("entrantes", [42275, 42000, 45000, 38100])
def test_variaciones_normales_pasan(entrantes):
    """Crecer, quedarse igual o encoger poco son cosas que pasan a diario."""
    _guard_full_refresh_shrink(_ConnFalsa(42275), "ps_articulos", entrantes)


def test_el_umbral_esta_donde_se_dice():
    # 10 % es el limite: justo por encima pasa, justo por debajo no.
    _guard_full_refresh_shrink(_ConnFalsa(1000), "t", 900)
    with pytest.raises(FullRefreshShrankError):
        _guard_full_refresh_shrink(_ConnFalsa(1000), "t", 899)


@pytest.mark.parametrize("actual,entrantes", [(50, 0), (99, 1), (10, 2)])
def test_tablas_diminutas_quedan_fuera(actual, entrantes):
    """En una tabla de 50 filas, 'ha bajado un 40 %' son 20 filas y no dice nada."""
    _guard_full_refresh_shrink(_ConnFalsa(actual), "ps_tiendas", entrantes)


def test_tabla_vacia_se_puede_llenar():
    """La primera carga va contra una tabla a cero: no debe bloquearse."""
    _guard_full_refresh_shrink(_ConnFalsa(0), "ps_articulos", 42275)


# --- La otra mitad del incidente: el refetch del guardian de anomalias -------


def test_un_refetch_mas_corto_no_discrimina_nada():
    """39.800 -> 23.900 fue lo que ocurrio realmente, y se persistio el corto.

    El refetch existe para distinguir corrupcion transitoria de dato real. Uno
    que devuelve 16.000 filas menos no distingue nada: es un segundo fallo.
    """
    from etl.db.fourd import _MAX_REFETCH_SHRINK_RATIO, _SHRINK_GUARD_MIN_ROWS

    def encogio(original, refetch):
        return original >= _SHRINK_GUARD_MIN_ROWS and refetch < original * (
            1 - _MAX_REFETCH_SHRINK_RATIO
        )

    # el caso real
    assert encogio(39800, 23900)
    # variaciones normales entre dos lecturas de una tabla viva
    assert not encogio(39800, 39800)
    assert not encogio(39800, 39750)
    assert not encogio(39800, 40100)  # crecer esta bien
    # lecturas diminutas quedan fuera
    assert not encogio(50, 10)
