"""El material (bolsas, perchas) no debe contar como venta en ningún momento.

Los artículos MA (`CCRefeJOFACM` que empieza por 'MA') se excluyen de
`ps_articulos` en la propia consulta al origen. La cascada a las tablas de
líneas la hacía `_cleanup_ma_linked_rows`, pero **sólo en las pasadas completas**,
con el razonamiento de que el conjunto MA sólo cambia al recargar
`ps_articulos`.

Eso es cierto y aun así insuficiente: lo que cambia cada hora son las LÍNEAS. El
delta horario reinserta líneas de material y nada las quitaba hasta el siguiente
full. Medido en producción el 2026-09-02: **296 líneas** en `ps_lineas_ventas`
cuyo `codigo` no existe en `ps_articulos` — bolsas contando como venta en
cualquier consulta de ingresos o unidades, durante horas.

Y los tickets que sólo vendían material se quedan sin líneas, contando como
ticket en los recuentos y en el denominador del ticket medio. Antes de borrar
nada se comprobó contra 4D: los 7.397 tickets sin líneas del espejo tenían todos
importe (8.308,61 EUR, mediana 0,08 EUR) y **cada uno tenía exactamente una
línea en 4D, siempre una bolsa** (MABOLMED1, MABOLGRAN1, MABAG37X48…). El espejo
no había perdido nada.
"""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from .test_scheduler import _apply_patches, _make_conn


def _sentencias_de(conn_pg: MagicMock) -> list[str]:
    """SQL ejecutado sobre el cursor de Postgres, normalizado."""
    cur = conn_pg.cursor.return_value.__enter__.return_value
    out = []
    for c in cur.execute.call_args_list:
        arg = c.args[0]
        out.append(" ".join(str(arg).split()))
    return out


def _borrados(conn_pg: MagicMock) -> list[str]:
    """Sólo los DELETE, para que un fallo no vomite el pipeline entero.

    La primera versión de este test afirmaba contra TODO el SQL de la pasada y
    su mensaje de fallo eran 3.000 caracteres de INSERTs de monitorización, con
    la línea que importaba enterrada. Un test que no se puede leer cuando falla
    no ayuda a nadie.
    """
    return [s for s in _sentencias_de(conn_pg) if s.upper().startswith("DELETE")]


def _correr(kind: str) -> MagicMock:
    conn_4d, conn_pg = _make_conn(), _make_conn()
    with ExitStack() as stack:
        _apply_patches(stack, {})
        stack.enter_context(
            patch(
                "etl.sync.articulos.get_ma_article_codes",
                return_value={"137137", "142211"},
            )
        )
        import etl.main as main

        main.run_full_sync(conn_4d, conn_pg, kind=kind)
    return conn_pg


class TestLimpiezaMA:
    def test_corre_tambien_en_los_deltas(self):
        """El caso que dejaba bolsas en los ingresos entre fulls."""
        borrados = _borrados(_correr("delta"))
        assert any("ps_lineas_ventas" in s for s in borrados), (
            "la limpieza MA debe correr en los deltas: son los que reinsertan "
            f"lineas de material cada hora. DELETEs emitidos: {borrados!r}"
        )

    def test_sigue_corriendo_en_las_completas(self):
        borrados = _borrados(_correr("full"))
        assert any("ps_lineas_ventas" in s for s in borrados), (
            f"DELETEs emitidos: {borrados!r}"
        )

    def test_borra_los_tickets_que_se_quedan_sin_lineas(self):
        borrados = [s for s in _borrados(_correr("full")) if "ps_ventas" in s]
        assert borrados, "hay que borrar los tickets que sólo vendían material"
        stmt = borrados[0]
        assert "NOT EXISTS" in stmt.upper() and "ps_lineas_ventas" in stmt, (
            f"sólo tickets sin ninguna línea; era: {stmt!r}"
        )

    def test_los_tickets_recientes_se_respetan(self):
        """`ventas` se sincroniza ANTES que `lineas_ventas`.

        Un ticket creado entre ambos fetch tiene cabecera y todavía no tiene
        líneas. Sin corte por antigüedad lo borraríamos y el upsert lo repondría
        en la pasada siguiente: inofensivo, pero absurdo — y ruidoso si alguien
        mira los contadores de filas borradas.
        """
        stmt = next(s for s in _borrados(_correr("full")) if "ps_ventas" in s)
        assert "fecha_creacion <" in stmt and "INTERVAL" in stmt.upper(), (
            f"falta el corte por antigüedad; era: {stmt!r}"
        )
