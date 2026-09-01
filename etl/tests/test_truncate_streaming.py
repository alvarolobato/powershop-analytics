"""Tests de `truncate_and_insert_streaming`.

Existe porque `truncate_and_insert` materializa la lista mapeada entera antes
de insertar, y con las tablas de linea del mayorista (~1M filas) eso deja tres
copias vivas a la vez -- crudo, mapeado y el lote de psycopg2. El proceso muere
sin traza de Python: salida limpia, contenedor reiniciado, pasada marcada como
fallida. Paso dos veces seguidas en produccion con `ps_gc_lin_albarane`
(runs 1504 y 1506).

Lo que se prueba aqui es el contrato observable: que trocea, que mapea sobre la
marcha (no todo por delante), y que ante un fallo deja la transaccion deshecha.
"""

from unittest.mock import MagicMock

import pytest

from etl.db.postgres import truncate_and_insert_streaming


class _Cursor:
    def __init__(self, registro):
        self.registro = registro

    def execute(self, stmt, *a):
        self.registro.append(("execute", str(stmt)))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _conn(registro):
    c = MagicMock()
    c.cursor.return_value = _Cursor(registro)
    c.commit.side_effect = lambda: registro.append(("commit", ""))
    c.rollback.side_effect = lambda: registro.append(("rollback", ""))
    return c


def test_trocea_en_lotes_del_tamano_pedido(monkeypatch):
    lotes = []
    monkeypatch.setattr(
        "psycopg2.extras.execute_values",
        lambda cur, stmt, vals, page_size=None: lotes.append(len(vals)),
    )
    registro = []
    n = truncate_and_insert_streaming(
        _conn(registro), "t", list(range(250)), lambda r: {"a": r}, chunk_size=100
    )
    assert n == 250
    assert lotes == [100, 100, 50], "debe insertar por lotes, no de una vez"


def test_mapea_sobre_la_marcha_no_todo_por_delante(monkeypatch):
    """El mapeo no puede adelantarse a la insercion: es lo que consume memoria."""
    orden = []
    monkeypatch.setattr(
        "psycopg2.extras.execute_values",
        lambda cur, stmt, vals, page_size=None: orden.append("insert"),
    )

    def mapper(r):
        orden.append("map")
        return {"a": r}

    registro = []
    truncate_and_insert_streaming(
        _conn(registro), "t", list(range(4)), mapper, chunk_size=2
    )
    # map,map,insert,map,map,insert -- no los cuatro map seguidos
    assert orden == ["map", "map", "insert", "map", "map", "insert"]


def test_trunca_antes_de_insertar(monkeypatch):
    monkeypatch.setattr("psycopg2.extras.execute_values", lambda *a, **k: None)
    registro = []
    truncate_and_insert_streaming(
        _conn(registro), "t", [1], lambda r: {"a": r}, chunk_size=10
    )
    # El invariante es el ORDEN relativo -- truncar antes de insertar -- no que
    # el TRUNCATE sea la primera sentencia del todo: la guarda de encogimiento
    # lee el historico de la tabla antes, y esa lectura es deliberada (es la
    # ultima oportunidad de saber cuantas filas habia).
    sentencias = [
        r[1].upper() for r in registro if len(r) > 1 and isinstance(r[1], str)
    ]
    i_truncate = next(i for i, q in enumerate(sentencias) if "TRUNCATE" in q)
    inserts = [i for i, q in enumerate(sentencias) if "INSERT" in q]
    assert all(i > i_truncate for i in inserts), "se inserto antes de truncar"
    assert registro[-1][0] == "commit"


def test_deshace_la_transaccion_si_falla_un_lote(monkeypatch):
    def revienta(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr("psycopg2.extras.execute_values", revienta)
    registro = []
    with pytest.raises(RuntimeError):
        truncate_and_insert_streaming(
            _conn(registro), "t", [1], lambda r: {"a": r}, chunk_size=10
        )
    assert ("rollback", "") in registro, (
        "una tabla truncada a medias es peor que no sincronizar"
    )
    assert ("commit", "") not in registro


def test_no_reescanea_la_lista_en_cada_trozo(monkeypatch):
    """El troceado consume un iterador, no corta ni re-escanea.

    `islice(lista, i, i+chunk)` dentro de un bucle por indices vuelve a
    recorrer desde el principio en cada vuelta: O(n^2) sobre un millon de
    filas, justo en el camino que este helper existe para aligerar. Un objeto
    que cuenta sus lecturas lo delata.
    """
    monkeypatch.setattr("psycopg2.extras.execute_values", lambda *a, **k: None)

    class Contador:
        def __init__(self, n):
            self.datos = list(range(n))
            self.leidas = 0

        def __len__(self):
            return len(self.datos)

        def __iter__(self):
            for x in self.datos:
                self.leidas += 1
                yield x

    filas = Contador(1000)
    registro = []
    truncate_and_insert_streaming(
        _conn(registro), "t", filas, lambda r: {"a": r}, chunk_size=100
    )
    # Con re-escaneo serian ~50.000 lecturas (10 trozos x media de 500).
    assert filas.leidas == 1000, (
        f"la lista se recorrio {filas.leidas} veces mas de lo necesario: "
        "el troceado esta re-escaneando"
    )


def test_el_limite_es_por_filas_de_destino_no_de_origen(monkeypatch):
    """El troceado cuenta filas MAPEADAS, no leidas (#918).

    Con un mapper que devuelve listas, contar filas de origen dejaba entrar
    `chunk_size * N` mapeadas de golpe: con 50.000 lineas de albaran y 6,33
    tallas de media serian ~316.000 vivas a la vez, justo lo que este helper
    existe para no hacer. Lo vio Copilot revisando el PR.
    """
    lotes = []
    monkeypatch.setattr(
        "psycopg2.extras.execute_values",
        lambda cur, stmt, vals, page_size=None: lotes.append(len(vals)),
    )
    n = truncate_and_insert_streaming(
        _conn([]),
        "t",
        list(range(100)),
        lambda r: [{"a": r, "b": i} for i in range(10)],
        chunk_size=25,
    )
    assert n == 1000, f"esperadas 1.000 filas de destino, insertadas {n}"
    assert lotes, "no se llamo a execute_values"
    assert max(lotes) <= 25, (
        f"un lote llevaba {max(lotes)} filas con chunk_size=25: "
        "el troceado esta contando filas de origen, no de destino"
    )
    assert sum(lotes) == 1000


def test_un_tramo_sin_filas_de_destino_no_corta_el_recorrido(monkeypatch):
    """Un bloque entero que no produce nada no puede terminar la carga.

    Con `if not trozo: break`, un tramo de lineas sin ninguna talla se habria
    llevado por delante todo lo que viniera detras, en silencio.
    """
    lotes = []
    monkeypatch.setattr(
        "psycopg2.extras.execute_values",
        lambda cur, stmt, vals, page_size=None: lotes.append(len(vals)),
    )
    n = truncate_and_insert_streaming(
        _conn([]),
        "t",
        list(range(100)),
        lambda r: [] if r < 50 else [{"a": r}],
        chunk_size=10,
    )
    assert n == 50, f"se perdieron filas posteriores al hueco: {n} de 50"
