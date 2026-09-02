"""Un socket de 4D muerto no debe llevarse por delante las tablas siguientes.

Capturado en producción el 2026-09-02, run 1580:

    ventas        | failed | lectura incompleta: el servidor declaro
                             977019 filas y llegaron 784000
    lineas_ventas | failed | b''      <- 0 ms
    pagos_ventas  | failed | b''      <- 0 ms
    ... 16 tablas más, todas b'', todas 0 ms

Las 16 de detrás no fallaron de verdad: `run_full_sync` seguía usando el mismo
socket para todas. El driver p4d no lanza al enviar sobre una conexión rota —
devuelve `ProgrammingError(b'')` a cada consulta—, así que el síntoma es «todo
falló instantáneamente y sin mensaje».

`_refresh_4d_connection` ya existía y su docstring describe exactamente esta
firma, pero sólo se llamaba al entrar al job, nunca a mitad de pasada.

Reintentar **una sola vez** es deliberado: si reconectar no arregla la tabla,
el problema no era el socket, y el delta de la hora siguiente volverá a
intentarlo con su ventana intacta ([D-065](../../docs/decisions/D-065-watermark-solo-avanza-con-exito.md)).
"""

from __future__ import annotations

import socket
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from etl.db.fourd import FetchShrankError, FetchTruncatedError
from etl.main import _es_error_de_conexion

from .test_scheduler import _apply_patches, _make_conn


class TestClasificador:
    def test_lectura_incompleta_es_de_conexion(self):
        assert _es_error_de_conexion(
            FetchTruncatedError("el servidor declaro 977019 filas y llegaron 784000")
        )
        assert _es_error_de_conexion(FetchShrankError("el refetch trajo menos"))

    def test_errores_de_red_son_de_conexion(self):
        assert _es_error_de_conexion(ConnectionResetError("reset by peer"))
        assert _es_error_de_conexion(TimeoutError("Connect timed out"))
        assert _es_error_de_conexion(socket.error("broken pipe"))

    def test_un_fallo_de_esa_tabla_no_lo_es(self):
        """Una columna que no existe o una FK violada no tocan el socket.

        Reconectar por esto sería reintentar en balde y esconder el error real.
        """
        assert not _es_error_de_conexion(ValueError("column CCFoo does not exist"))
        assert not _es_error_de_conexion(
            RuntimeError("null value in column reg_lineas violates not-null")
        )

    def test_error_vacio_solo_cuenta_si_viene_del_driver(self):
        """`b''` es la firma del socket muerto, pero sólo si lo emite p4d.

        Un RuntimeError vacío de nuestro propio código no debe disparar una
        reconexión.
        """

        class ProgrammingError(Exception):
            pass

        ProgrammingError.__module__ = "p4d.p4d"
        assert _es_error_de_conexion(ProgrammingError(""))
        assert not _es_error_de_conexion(RuntimeError(""))


def _correr(side_effects: dict, *, config=object(), refresh=None):
    """Ejecuta run_full_sync con los syncs parcheados. Devuelve (mock_refresh,)."""
    conn_4d = _make_conn()
    conn_pg = _make_conn()
    with ExitStack() as stack:
        _apply_patches(stack, side_effects)
        import etl.main as main

        mock_refresh = stack.enter_context(
            patch.object(
                main,
                "_refresh_4d_connection",
                side_effect=refresh or (lambda c, cfg: (MagicMock(), None)),
            )
        )
        main.run_full_sync(conn_4d, conn_pg, config=config)
        return mock_refresh


class TestReconexionAMitadDePasada:
    def test_una_lectura_incompleta_reconecta_y_reintenta_esa_tabla(self):
        intentos: list[str] = []

        def _ventas(*a, **kw):
            intentos.append("ventas")
            if len(intentos) == 1:
                raise FetchTruncatedError("declaro 977019 y llegaron 784000")
            return 977019  # el reintento, ya con socket nuevo, va bien

        mock_refresh = _correr({"sync_ventas": _ventas})

        assert len(intentos) == 2, (
            f"ventas debía reintentarse una vez tras reconectar; intentos={intentos}"
        )
        assert mock_refresh.call_count == 1

    def test_las_tablas_de_detras_siguen_corriendo(self):
        """El bug de verdad: 16 tablas cayeron detrás de una."""
        llamadas: list[str] = []

        def _t(nombre):
            def _fn(*a, **kw):
                llamadas.append(nombre)
                return {} if nombre == "sync_catalogos" else 0

            return _fn

        side = {n: _t(n) for n in ("sync_lineas_ventas", "sync_pagos_ventas")}

        def _ventas(*a, **kw):
            llamadas.append("sync_ventas")
            raise FetchTruncatedError("socket muerto")

        side["sync_ventas"] = _ventas
        _correr(side)

        assert "sync_lineas_ventas" in llamadas
        assert "sync_pagos_ventas" in llamadas

    def test_un_fallo_normal_no_reconecta(self):
        """Sin esto reconectaríamos ante cualquier error, escondiendo el real."""
        intentos: list[str] = []

        def _ventas(*a, **kw):
            intentos.append("ventas")
            raise ValueError("column CCFoo does not exist")

        mock_refresh = _correr({"sync_ventas": _ventas})

        assert intentos == ["ventas"], "no debe reintentarse un error de la tabla"
        assert mock_refresh.call_count == 0

    def test_si_la_reconexion_falla_no_revienta_el_run(self):
        """4D suele rechazar la reconexión mientras digiere la consulta abortada.

        Es el `Connect timed out` que se ve en producción. No se insiste aquí:
        continuar es más barato que bloquear el run entero.
        """
        llamadas: list[str] = []

        def _ventas(*a, **kw):
            llamadas.append("sync_ventas")
            raise FetchTruncatedError("socket muerto")

        def _lineas(*a, **kw):
            llamadas.append("sync_lineas_ventas")
            return 0

        mock_refresh = _correr(
            {"sync_ventas": _ventas, "sync_lineas_ventas": _lineas},
            refresh=lambda c, cfg: (None, "Connect timed out"),
        )

        assert mock_refresh.call_count == 1
        assert llamadas.count("sync_ventas") == 1, "no se reintenta sin socket nuevo"
        assert "sync_lineas_ventas" in llamadas, "el run debe continuar"

    def test_sin_config_se_mantiene_el_comportamiento_de_siempre(self):
        """Los tests y llamadas antiguas no pasan config: no deben reconectar."""
        intentos: list[str] = []

        def _ventas(*a, **kw):
            intentos.append("ventas")
            raise FetchTruncatedError("socket muerto")

        mock_refresh = _correr({"sync_ventas": _ventas}, config=None)

        assert intentos == ["ventas"]
        assert mock_refresh.call_count == 0
