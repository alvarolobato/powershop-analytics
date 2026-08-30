"""Sincroniza LinAlbaranes (lineas de albaran de COMPRA) a ps_lin_albaranes.

Cierra la pata de compras de la formula de movimiento de stock (issue #918).
Hasta ahora `ps_albaranes` era solo cabecera y `ps_lineas_compras` son PEDIDOS,
no mercancia recibida, asi que "que tallas he comprado frente a que tallas he
vendido" no se podia responder contra el espejo.

Formato largo
-------------
Una fila de LinAlbaranes trae 34 slots `Talla1..34` / `Recibidas1..34`. Aqui se
despivota a una fila por talla no vacia, igual que `stock.py` hace con
Exportaciones. Medido en 4D el 2026-08-30: **45.967 lineas producen 291.068
filas**, 6,33 tallas de media por linea.

Al pasar de 100.000 filas de destino, la insercion va por
`truncate_and_insert_streaming` y no por `truncate_and_insert` (D-059).

Tipos de los slots
------------------
`_USER_COLUMNS` declara `Recibidas1..34` como **DATA_TYPE = 3, DATA_LENGTH = 2**
(entero de 16 bits), igual que `Exportaciones.Stock1..34`, asi que se les aplica
`decode_signed_int16_word` (D-017). La raiz `Recibidas` es Real (tipo 6) y NO
pasa por el decodificador.

Hoy el decodificador es un no-op sobre esta tabla: leidos los 781.439 valores de
slot, min 0, max 32767, **cero negativos**. Va igualmente, por lo mismo que dice
D-017 -- el widening reaparece en cuanto entra un negativo, y para entonces el
dato ya esta mal escrito en el espejo.

> Aviso sobre 4D SQL: `SELECT COUNT(*) ... WHERE Recibidas1 >= 32768 OR ...`
> devuelve **todas** las filas y es falso. Hay que filtrar en Python tras el
> fetch, no en la consulta.

Clave ajena
-----------
`NumAlbaran` -> `Albaranes.RegAlbaran`, verificado 3.759 de 3.759 (100 %).
NUNCA por `NAlbaran`, que es el numero visible y no es unico -- es el mismo
fallo que costo la FK del mayorista.

Estrategia
----------
Refresco completo: LinAlbaranes no tiene columna de modificacion, asi que no hay
delta posible. Con 45.967 filas de origen es asumible.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from etl.db.fourd import decode_signed_int16_word, safe_fetch
from etl.db.postgres import truncate_and_insert_streaming

logger = logging.getLogger(__name__)

_MAX_TALLA = 34

_CAMPOS = (
    "RegLineaAlbaran, NumAlbaran, NLinea, Codigo, NumArticulo, Descripcion, "
    "Color, Recibidas, PrecioCoste, PrecioNetoSI, TotalSI, NumProveedor, Abono"
)
_SLOTS = ", ".join(f"Talla{i}, Recibidas{i}" for i in range(1, _MAX_TALLA + 1))
SQL_LIN_ALBARANES = f"SELECT {_CAMPOS}, {_SLOTS} FROM LinAlbaranes"


def _a_decimal(valor: object) -> object:
    """float -> Decimal; el resto pasa tal cual.

    Las columnas de destino son NUMERIC y el resto del ETL mantiene el mismo
    contrato (`_to_decimal` en `compras.py`): meter floats en NUMERIC arrastra
    el error de representacion binaria a claves y a importes.
    """
    if isinstance(valor, float):
        return Decimal(str(valor))
    return valor


def _norm_talla(valor: object) -> str | None:
    """Talla en MAYUSCULAS y sin espacios, o None si no hay.

    Misma normalizacion que `ventas.py` y `stock.py`. Sin ella un cruce
    compras<->ventas<->stock por talla perderia filas en silencio, y ademas
    partiria la PK (reg_linea_albaran, talla) en dos filas para 'l' y 'L'.
    """
    if valor is None:
        return None
    texto = valor.strip() if isinstance(valor, str) else str(valor).strip()
    return texto.upper() or None


def normalizar_linea(src: dict) -> list[dict]:
    """Despivota una linea ancha en una fila por talla no vacia.

    Devuelve lista vacia si la linea no aporta ninguna talla; el helper de
    insercion lo tolera y sigue con el resto.
    """
    reg = src.get("reglineaalbaran")
    if reg is None:
        raise ValueError(
            f"normalizar_linea: RegLineaAlbaran nulo "
            f"(numalbaran={src.get('numalbaran')!r}, codigo={src.get('codigo')!r})"
        )

    comunes = {
        "reg_linea_albaran": _a_decimal(reg),
        "num_albaran": _a_decimal(src.get("numalbaran")),
        "n_linea": src.get("nlinea"),
        "codigo": src.get("codigo"),
        "num_articulo": _a_decimal(src.get("numarticulo")),
        "descripcion": src.get("descripcion"),
        "color": src.get("color"),
        # Raiz Real (tipo 6): NO pasa por el decodificador de 16 bits.
        "recibidas_total": _a_decimal(src.get("recibidas")),
        "precio_coste": _a_decimal(src.get("preciocoste")),
        "precio_neto_si": _a_decimal(src.get("precionetosi")),
        "total_si": _a_decimal(src.get("totalsi")),
        "num_proveedor": _a_decimal(src.get("numproveedor")),
        "abono": src.get("abono"),
    }

    filas: list[dict] = []
    vistas: set[str] = set()
    for i in range(1, _MAX_TALLA + 1):
        talla = _norm_talla(src.get(f"talla{i}"))
        if talla is None:
            continue
        # Una linea no deberia repetir talla, pero si el origen lo hiciera la
        # PK (reg_linea_albaran, talla) reventaria el lote entero. Se suman las
        # unidades en la primera aparicion en vez de perder la insercion.
        crudo = src.get(f"recibidas{i}")
        unidades = 0 if crudo is None else int(decode_signed_int16_word(crudo))
        if talla in vistas:
            for f in filas:
                if f["talla"] == talla:
                    f["recibidas"] += unidades
                    break
            continue
        vistas.add(talla)
        filas.append({**comunes, "talla": talla, "recibidas": unidades})
    return filas


def sync_lin_albaranes(conn_4d, conn_pg, since=None) -> int:
    """Refresco completo de ps_lin_albaranes.

    `since` se acepta y se ignora a proposito: LinAlbaranes no tiene columna de
    modificacion, asi que no hay delta posible. Se acepta para que la firma
    encaje con el resto de syncs del orquestador.
    """
    if since is not None:
        logger.info(
            "sync_lin_albaranes: LinAlbaranes no tiene campo de modificacion; "
            "refresco completo pese al watermark"
        )
    crudas = safe_fetch(conn_4d, SQL_LIN_ALBARANES)
    total = truncate_and_insert_streaming(
        conn_pg, "ps_lin_albaranes", crudas, normalizar_linea
    )
    logger.info(
        "sync_lin_albaranes: %d filas de destino desde %d lineas de origen",
        total,
        len(crudas),
    )
    return total
