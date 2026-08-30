"""Tests de `etl/sync/lin_albaranes.py` (issue #918).

Lo que se vigila aqui es el despivotado y el decodificador de 16 bits, que son
las dos cosas que pueden escribir datos silenciosamente mal en el espejo.
"""

from __future__ import annotations

from decimal import Decimal

from etl.sync.lin_albaranes import _a_decimal, _norm_talla, normalizar_linea

import pytest


def _linea(**extra) -> dict:
    """Linea ancha minima, con todos los slots vacios salvo lo que se pase."""
    base = {
        "reglineaalbaran": 1001.99,
        "numalbaran": 5000.99,
        "nlinea": 1,
        "codigo": "123456",
        "numarticulo": 77.99,
        "descripcion": "PANTALON",
        "color": "NEGRO",
        "recibidas": 12.0,
        "preciocoste": 8.5,
        "precionetosi": 20.0,
        "totalsi": 240.0,
        "numproveedor": 9.99,
        "abono": False,
    }
    for i in range(1, 35):
        base[f"talla{i}"] = None
        base[f"recibidas{i}"] = None
    base.update(extra)
    return base


class TestNormalizarTalla:
    def test_mayusculas(self):
        # El origen mezcla 'l' y 'L'. Sin normalizar, la PK se parte en dos y
        # un cruce con ps_lineas_ventas (ya en mayusculas) pierde filas.
        assert _norm_talla("l") == "L"
        assert _norm_talla(" xl ") == "XL"
        assert _norm_talla("6Xl") == "6XL"

    def test_vacias_son_none(self):
        assert _norm_talla(None) is None
        assert _norm_talla("") is None
        assert _norm_talla("   ") is None


class TestDespivotado:
    def test_una_fila_por_talla_no_vacia(self):
        f = normalizar_linea(_linea(talla1="S", recibidas1=3, talla2="M", recibidas2=5))
        assert [(x["talla"], x["recibidas"]) for x in f] == [("S", 3), ("M", 5)]

    def test_los_slots_vacios_no_generan_filas(self):
        # 34 slots por linea y 6,33 tallas de media: emitir los vacios
        # multiplicaria la tabla por cinco con filas sin significado.
        assert normalizar_linea(_linea()) == []

    def test_talla_con_recibidas_nulo_cuenta_cero(self):
        # La talla existe en la serie del articulo aunque no se recibiera nada.
        f = normalizar_linea(_linea(talla1="S", recibidas1=None))
        assert len(f) == 1 and f[0]["recibidas"] == 0

    def test_los_campos_comunes_se_repiten_en_cada_fila(self):
        f = normalizar_linea(_linea(talla1="S", recibidas1=1, talla3="L", recibidas3=2))
        assert len(f) == 2
        for fila in f:
            # Decimal, no float: las columnas de destino son NUMERIC y meter
            # floats arrastra el error de representacion binaria a las claves.
            assert fila["reg_linea_albaran"] == Decimal("1001.99")
            assert isinstance(fila["reg_linea_albaran"], Decimal)
            assert fila["num_albaran"] == Decimal("5000.99")
            assert fila["codigo"] == "123456"

    def test_reg_nulo_falla_en_vez_de_escribir_una_pk_invalida(self):
        with pytest.raises(ValueError, match="RegLineaAlbaran"):
            normalizar_linea(_linea(reglineaalbaran=None, talla1="S", recibidas1=1))

    def test_talla_repetida_se_suma_en_vez_de_reventar_la_pk(self):
        # La PK es (reg_linea_albaran, talla). Dos slots con la misma talla
        # harian fallar el lote ENTERO por conflicto de clave.
        f = normalizar_linea(_linea(talla1="M", recibidas1=2, talla5="m", recibidas5=3))
        assert len(f) == 1
        assert f[0]["talla"] == "M" and f[0]["recibidas"] == 5


class TestDecodificadorInt16:
    def test_los_negativos_widened_se_decodifican(self):
        # Los slots son DATA_TYPE=3 / DATA_LENGTH=2 igual que
        # Exportaciones.Stock1..34, y el camino 4D+p4d devuelve el negativo
        # ensanchado sin signo: 65535 es -1 (D-017).
        f = normalizar_linea(_linea(talla1="S", recibidas1=65535))
        assert f[0]["recibidas"] == -1
        f = normalizar_linea(_linea(talla1="S", recibidas1=65530))
        assert f[0]["recibidas"] == -6

    def test_los_positivos_no_se_tocan(self):
        f = normalizar_linea(_linea(talla1="S", recibidas1=32767))
        assert f[0]["recibidas"] == 32767

    def test_los_importes_van_como_decimal(self):
        f = normalizar_linea(_linea(talla1="S", recibidas1=1))
        for campo in ("precio_coste", "precio_neto_si", "total_si", "recibidas_total"):
            assert isinstance(f[0][campo], Decimal), f"{campo} deberia ser Decimal"

    def test_a_decimal_deja_pasar_lo_que_no_es_float(self):
        assert _a_decimal(None) is None
        assert _a_decimal(7) == 7 and isinstance(_a_decimal(7), int)
        assert _a_decimal("x") == "x"

    def test_la_raiz_real_no_pasa_por_el_decodificador(self):
        # `Recibidas` (sin numero) es Real, tipo 6: aplicarle el decodificador
        # de 16 bits corromperia cualquier valor por encima de 32767.
        f = normalizar_linea(_linea(talla1="S", recibidas1=1, recibidas=65535.0))
        assert f[0]["recibidas_total"] == Decimal("65535.0")
