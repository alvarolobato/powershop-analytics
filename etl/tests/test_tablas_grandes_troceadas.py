"""Ninguna tabla grande puede usar el camino que materializa todo.

`truncate_and_insert` construye la lista mapeada entera antes de insertar. Con
tablas de un millon de filas eso deja tres copias vivas a la vez -- las tuplas
crudas, los diccionarios mapeados y el lote de psycopg2 -- y el proceso muere
sin traza: salida limpia, contenedor reiniciado, pasada marcada como fallida.
Paso con `ps_gc_lin_albarane` en el 79 % de las sincronizaciones completas
(104 fallos de 132 en 30 dias).

Su propio docstring ya lo dice -- "Used for full-refresh tables (catalogs,
small dimension tables)" -- pero eso es una nota, no una barrera. Este test es
la barrera: si alguien enchufa manana una tabla de un millon de filas a ese
camino, salta aqui y no en produccion a las tres de la madrugada.

Los tamanos son de produccion, medidos el 2026-08-30. No hace falta que esten
al dia: lo que importa es el orden de magnitud, y el umbral tiene margen de
sobra.
"""

import pathlib
import re

# Filas en produccion (2026-08-30). Solo las que superan el umbral o andan
# cerca; el resto son de miles y no necesitan vigilancia.
FILAS_EN_PRODUCCION = {
    "ps_stock_tienda": 13_556_743,
    "ps_lineas_ventas": 1_823_179,
    "ps_gc_lin_albarane": 1_048_417,
    "ps_pagos_ventas": 1_033_286,
    "ps_gc_lin_facturas": 1_009_447,
    "ps_ventas": 977_734,
    "ps_traspasos": 262_724,
    "ps_gc_albaranes": 52_148,
    "ps_lineas_compras": 46_201,
    "ps_stock_central": 42_848,
    "ps_articulos": 42_270,
    "ps_clientes": 29_533,
    "ps_gc_facturas": 19_352,
}

#: Por encima de esto hay que trocear. `ps_lineas_compras` (46.201) es la mayor
#: que hoy usa el camino sin trocear y queda holgadamente por debajo.
UMBRAL = 100_000


def _tablas_con_insercion_sin_trocear() -> set[str]:
    """Tablas pasadas a `truncate_and_insert` como literal en etl/sync/."""
    encontradas = set()
    for f in (pathlib.Path(__file__).parent.parent / "sync").glob("*.py"):
        texto = f.read_text()
        # `truncate_and_insert(conn_pg, "ps_x", ...)` -- solo el no-streaming
        for m in re.finditer(r'(?<!_streaming)\(\s*conn_pg\s*,\s*"(ps_\w+)"', texto):
            i = texto.rfind("truncate_and_insert", 0, m.start())
            if i != -1 and "streaming" not in texto[i : m.start()]:
                encontradas.add(m.group(1))
    return encontradas


def test_ninguna_tabla_grande_usa_el_camino_sin_trocear():
    grandes = {
        t
        for t in _tablas_con_insercion_sin_trocear()
        if FILAS_EN_PRODUCCION.get(t, 0) > UMBRAL
    }
    assert not grandes, (
        "Estas tablas superan las "
        f"{UMBRAL:,} filas y usan `truncate_and_insert`, que materializa la "
        "lista entera: "
        + ", ".join(f"{t} ({FILAS_EN_PRODUCCION[t]:,})" for t in sorted(grandes))
        + ". Usa `truncate_and_insert_streaming`."
    )


def test_el_detector_ve_las_llamadas_que_existen():
    """Contrapeso: si el regex dejara de casar, el test anterior pasaria vacio."""
    encontradas = _tablas_con_insercion_sin_trocear()
    assert len(encontradas) >= 5, (
        f"El detector solo encontro {len(encontradas)} llamadas a "
        "truncate_and_insert; deberia ver una decena. Probablemente el patron "
        "dejo de casar y este guardian esta verde por vacio."
    )
