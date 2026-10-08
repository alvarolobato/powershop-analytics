"""Tests de scripts/check-fotos-paths.py (alerta de desviacion de rutas, D-068).

No tocan 4D: se le inyectan las filas a `desviaciones` / `informar`.
"""

import importlib.util
import io
import pathlib
import types


def _load() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(
        "check_fotos_paths",
        pathlib.Path(__file__).parent.parent / "check-fotos-paths.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


cfp = _load()


def _fila(codigo, **cambios):
    paths = [
        f"W:\\PS_Ficheros\\Imagenes\\{slot}\\{codigo}.jpg" for slot in (1, 2, 3, 4)
    ]
    for slot, valor in cambios.items():
        paths[int(slot[1:]) - 1] = valor
    return (codigo, *paths)


def _muchas(n=cfp.MIN_FILAS):
    return [_fila(str(100000 + i)) for i in range(n)]


def test_todo_conforme_sale_0():
    salida = io.StringIO()
    assert cfp.informar(_muchas(), salida) == 0
    assert "OK" in salida.getvalue()


def test_una_fila_desviada_sale_1_y_la_lista():
    desviada = "W:\\PS_Ficheros\\Imagenes\\otra\\foto-bonita.jpg"
    filas = _muchas() + [_fila("144750", p2=desviada)]
    salida = io.StringIO()

    assert cfp.informar(filas, salida) == 1

    texto = salida.getvalue()
    assert "1 DESVIACIONES" in texto
    assert "'144750'" in texto
    assert "slot=2" in texto
    assert "foto-bonita.jpg" in texto


def test_solo_se_reporta_el_slot_desviado():
    fuera = cfp.desviaciones([_fila("169", p4="")])
    assert fuera == [("169", 4, "")]


def test_el_slot_forma_parte_de_la_convencion():
    # La ruta del slot 1 escrita en Path3 es una desviacion aunque el fichero exista.
    fila = _fila("132374", p3="W:\\PS_Ficheros\\Imagenes\\1\\132374.jpg")
    assert cfp.desviaciones([fila]) == [
        ("132374", 3, "W:\\PS_Ficheros\\Imagenes\\1\\132374.jpg")
    ]


def test_normaliza_bytes_y_relleno_nul_de_p4d():
    fila = (
        b"132374\x00\x00",
        b"W:\\PS_Ficheros\\Imagenes\\1\\132374.jpg\x00",
        "W:\\PS_Ficheros\\Imagenes\\2\\132374.jpg ",
        "W:\\PS_Ficheros\\Imagenes\\3\\132374.jpg",
        "W:\\PS_Ficheros\\Imagenes\\4\\132374.jpg",
    )
    assert cfp.desviaciones([fila]) == []


def test_resultado_corto_no_es_un_ok():
    # Un resultado vacio o truncado no puede leerse como "0 desviaciones".
    salida = io.StringIO()
    assert cfp.informar([], salida) == 2
    assert cfp.informar(_muchas(10), salida) == 2
    assert "no es fiable" in salida.getvalue()


def test_la_lista_se_trunca():
    filas = _muchas() + [_fila(str(i), p1="x") for i in range(cfp.MAX_LISTADAS + 7)]
    salida = io.StringIO()
    assert cfp.informar(filas, salida) == 1
    assert "y 7 mas" in salida.getvalue()
