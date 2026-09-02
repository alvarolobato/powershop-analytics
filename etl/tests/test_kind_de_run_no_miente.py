"""El tipo de ejecución que se registra tiene que ser el que de verdad se pidió.

Visible en el panel de ETL el 2026-09-02: la fila de las 18:00 decía
«Completa · Error · 6 ms». No fue una completa:

    id   | kind | status |   hora   | seg | total_tables | trigger
    1581 | full | failed | 16:00:24 | 0.0 |            1 | scheduled

Era el **delta horario** de las 16:00 UTC que no pudo alcanzar 4D.
`_record_connection_failure` llamaba a `create_run(conn_pg, trigger)` sin pasar
`kind`, y la firma tenía `kind: str = "full"`.

Dos daños distintos:

1. **Engaña al operador.** Una completa fallida sugiere que el repaso pesado no
   se hizo. Un delta fallido a las 16:00 se arregla solo a las 17:00.
2. **Envenena las métricas.** Cualquier consulta de «cuántas completas fallan»
   daba un número inventado — las 84 filas de «SQL Server is not running» del
   18 al 21 de agosto eran una por hora durante cuatro días, todas deltas.

El arreglo de fondo es que `create_run` ya no tiene defecto para `kind`: es
obligatorio, para que ningún sitio nuevo pueda heredarlo por descuido. Y si lo
tuviera, debería ser el barato y común, nunca el caro y alarmante.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from etl.db import postgres


class TestCreateRunExigeKind:
    def test_kind_es_obligatorio(self):
        """Sin defecto no se puede heredar 'full' por descuido."""
        with pytest.raises(TypeError):
            postgres.create_run(MagicMock(), "scheduled")  # type: ignore[call-arg]

    def test_sigue_rechazando_un_kind_inventado(self):
        with pytest.raises(ValueError, match="Invalid run kind"):
            postgres.create_run(MagicMock(), "scheduled", "profunda")


def _correr_loop_con_4d_caido(cron_hour: int):
    """Ejecuta el bucle con 4D inalcanzable y devuelve las llamadas al registro."""
    import etl.main as main_mod

    with (
        patch("etl.main._is_run_active", return_value=False),
        patch("etl.main._refresh_4d_connection", return_value=(None, "4D unreachable")),
        patch("etl.main._record_connection_failure") as mock_fail,
        patch("etl.main.run_full_sync"),
        patch("etl.db.postgres.check_and_consume_trigger", return_value=None),
        patch("schedule.run_pending"),
        patch("time.sleep", side_effect=StopIteration),
    ):
        try:
            main_mod._run_scheduler_loop(
                MagicMock(), MagicMock(), MagicMock(), cron_hour
            )
        except StopIteration:
            pass
        return mock_fail


class TestUnDeltaCaidoNoSeRegistraComoCompleta:
    def test_el_sync_de_arranque_que_no_alcanza_4d_es_delta(self):
        """El arranque es delta (D-…/#967): si falla, debe constar como delta.

        Este es exactamente el run 1581: `scheduled`, 0 ms, una sola tabla, y
        en el panel salía como «Completa».
        """
        from datetime import datetime, timezone

        # Hora de cron distinta de la actual, para que la guarda de reloj de
        # _job no descarte el delta de arranque y el test no falle una vez al día.
        otra_hora = (datetime.now(timezone.utc).hour + 5) % 24
        mock_fail = _correr_loop_con_4d_caido(otra_hora)

        assert mock_fail.call_count >= 1, "debería haberse registrado el fallo"
        llamada = mock_fail.call_args_list[0]
        # firma: (conn_pg, trigger, trigger_id, err_msg, kind)
        kind = llamada.args[4] if len(llamada.args) > 4 else llamada.kwargs.get("kind")
        assert kind == "delta", (
            f"un delta que no alcanza 4D debe registrarse como 'delta', no {kind!r}. "
            "Con 'full' el panel dice que falló el repaso pesado cuando en "
            "realidad se arregla solo a la hora siguiente."
        )
