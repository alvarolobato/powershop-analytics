"""El watermark sólo avanza en una pasada correcta.

Contexto. El camino de error de ``_run_sync`` llamaba a ``set_watermark`` con
``last_sync_at = now()``, y su ``ON CONFLICT`` escribe esa columna igual que en
el camino bueno. O sea que un intento FALLIDO adelantaba la marca exactamente
igual que uno correcto.

Eso es pérdida de datos silenciosa y permanente. El delta siguiente calcula
``since = last_sync_at - lookback_days``, así que su ventana arranca en el
último INTENTO y no en el último ÉXITO. Si una tabla falla dos días seguidos sin
que se cuele un barrido con ``since=None``, las filas modificadas entre medias
no se vuelven a mirar JAMÁS: el delta nunca retrocede.

No es teórico. Auditando los 16.144 deltas correctos del histórico
(``watermark_from::date > último_ok::date``) aparecen dos casos reales, ambos
del run 41 el 2026-04-23: ``stock`` y ``traspasos`` venían fallando desde el 18
de abril y su ventana de recuperación empezó el 23. Cinco días de
modificaciones saltados, rescatados sólo por el siguiente barrido completo.

Que no haya vuelto a pasar desde entonces se debe a que el "full" nocturno usa
``since=2014-01-01`` y tapa el agujero cada noche — es decir, la seguridad del
delta depende hoy del mismo run que falla la mayoría de las veces. En cuanto se
reduzca la frecuencia de ese barrido, este pasa a ser el modo de pérdida
principal, y por eso se arregla antes de tocar la cadencia.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from etl.db.postgres import set_watermark_error


def _conn() -> tuple[MagicMock, MagicMock]:
    cur = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    return conn, cur


def _sql_de(cur: MagicMock) -> str:
    """Devuelve el UPDATE de watermarks, normalizado a espacios simples.

    ``_ensure_watermarks_table`` también ejecuta DDL por el mismo cursor, así
    que hay que quedarse con la sentencia que nos interesa en vez de asumir que
    es la última.
    """
    sentencias = [
        " ".join(c.args[0].split())
        for c in cur.execute.call_args_list
        if "etl_watermarks" in c.args[0] and "INSERT" in c.args[0].upper()
    ]
    assert sentencias, f"no se encontró el INSERT: {cur.execute.call_args_list!r}"
    return sentencias[-1]


class TestWatermarkDeError:
    def test_no_escribe_last_sync_at_al_actualizar(self):
        """La columna NO puede estar en el DO UPDATE SET. Es todo el arreglo."""
        conn, cur = _conn()

        set_watermark_error(conn, "ventas", "lectura incompleta")

        sql = _sql_de(cur)
        do_update = sql.upper().split("DO UPDATE SET", 1)[1]
        assert "LAST_SYNC_AT" not in do_update, (
            "last_sync_at no debe actualizarse en un fallo: adelantarla mueve la "
            f"ventana del próximo delta al último intento. SET era: {do_update!r}"
        )
        # Y sí debe dejar constancia de que falló.
        assert "STATUS" in do_update and "ERROR_MSG" in do_update
        conn.commit.assert_called_once()

    def test_una_tabla_sin_marca_previa_arranca_en_la_epoca(self):
        """Primer sync de su vida y falla: la marca no puede quedar en 'ahora'.

        Si el INSERT pusiera ``now()``, una tabla que nunca ha sincronizado
        bien se quedaría con una marca de hoy y su primer delta se traería sólo
        lo del último día, dando por bueno un espejo vacío. Con la época,
        ``get_watermark`` devuelve 1970 y el siguiente intento se trae todo.
        """
        conn, cur = _conn()

        set_watermark_error(conn, "lineas_ventas", "boom")

        sql = _sql_de(cur)
        valores = sql.upper().split("VALUES", 1)[1].split("ON CONFLICT", 1)[0]
        # last_sync_at es el 2º valor. (El NOW() que hay más adelante en la
        # misma lista es updated_at, que sí debe reflejar el intento.)
        assert "EPOCH" in valores, (
            f"el INSERT debe usar la época, no NOW(). VALUES era: {valores!r}"
        )
        segundo_valor = [v.strip() for v in valores.strip(" ()").split(",")][1]
        assert "EPOCH" in segundo_valor, (
            f"last_sync_at debe ser la época; era {segundo_valor!r}"
        )

    def test_un_fallo_al_escribir_hace_rollback_y_propaga(self):
        """A diferencia del relleno de `entrada`, aquí sí interesa que estalle.

        Si no se puede registrar el error, `_run_sync` ya envuelve la llamada y
        deja traza; lo que no se puede es dejar la transacción abierta.
        """
        conn, cur = _conn()
        cur.execute.side_effect = RuntimeError("se cayó la conexión")

        try:
            set_watermark_error(conn, "ventas", "boom")
        except RuntimeError:
            pass
        else:  # pragma: no cover
            raise AssertionError("debería haber propagado")

        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
