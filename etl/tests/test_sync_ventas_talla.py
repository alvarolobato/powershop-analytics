"""Talla y discriminador de devolucion en las lineas de venta.

Regresion de dos bugs reales:

* El PR #914 intento resolver la talla uniendo `LineasVentas.CodigoAsociado`
  con `BarrasAsociado.Codigo` y midio **0 % de cobertura** sobre 60.048 lineas
  de produccion: `CodigoAsociado` esta vacio siempre. La talla nunca estuvo en
  el articulo — el articulo codifica modelo + COLOR — sino en la propia linea,
  en `CCOPTallaOjo`, que el codigo de produccion usa desde hace anos.
* El origen mezcla mayusculas y minusculas: 46 valores distintos que eran 34.
  Sin normalizar, "L" y "l" cuentan por separado y en el articulo de control
  la talla mas vendida cambiaba de L a M.
"""

from decimal import Decimal

from etl.sync.ventas import _LINEAS_MAPPING, _LINEAS_NUMERIC, _SQL_LINEAS_BASE, _map_row


def test_la_consulta_trae_talla_y_discriminador():
    # Sin estas tres columnas la talla vendida es inaccesible desde el
    # dashboard y hace falta el JOIN con ps_ventas para saber si es devolucion.
    assert "CCOPTallaOjo" in _SQL_LINEAS_BASE
    assert "Entrada" in _SQL_LINEAS_BASE
    assert "MovimientoCaja" in _SQL_LINEAS_BASE


def test_talla_se_normaliza_a_mayusculas():
    row = _map_row({"ccoptallaojo": "l"}, _LINEAS_MAPPING, _LINEAS_NUMERIC)
    assert row["talla"] == "L", "sin UPPER, 'l' y 'L' son dos tallas distintas"


def test_talla_se_recorta():
    row = _map_row({"ccoptallaojo": "  xxl  "}, _LINEAS_MAPPING, _LINEAS_NUMERIC)
    assert row["talla"] == "XXL"


def test_talla_vacia_es_null_no_cadena_vacia():
    # "sin talla" no es una talla llamada "": agrupar por '' crearia una
    # categoria fantasma en todo ranking por talla.
    row = _map_row({"ccoptallaojo": "   "}, _LINEAS_MAPPING, _LINEAS_NUMERIC)
    assert row["talla"] is None


def test_las_tallas_numericas_no_se_tocan():
    row = _map_row({"ccoptallaojo": "42"}, _LINEAS_MAPPING, _LINEAS_NUMERIC)
    assert row["talla"] == "42"


def test_el_discriminador_de_linea_se_mapea():
    row = _map_row(
        {"entrada": False, "movimientocaja": "Devolucion"},
        _LINEAS_MAPPING,
        _LINEAS_NUMERIC,
    )
    assert row["entrada"] is False
    assert row["movimiento_caja"] == "Devolucion"


def test_la_normalizacion_no_toca_otras_columnas():
    # Solo la talla se pasa a mayusculas; una descripcion en minusculas debe
    # llegar intacta al espejo.
    row = _map_row(
        {"descripcion": "chaqueta de ante", "unidades": 2},
        _LINEAS_MAPPING,
        _LINEAS_NUMERIC,
    )
    assert row["descripcion"] == "chaqueta de ante"
    assert row["unidades"] == Decimal("2")
