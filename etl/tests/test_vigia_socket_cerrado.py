"""El vigia corta una lectura que 4D dejo colgada al cerrar la conexion.

Reproduce el bucle de `frecv()` de p4d: `recv()` devuelve b"" en fin de
fichero y se vuelve a llamar sin fin. Paso en produccion el 2026-09-24 y el
ETL estuvo 28 horas girando al 100 % de CPU sin escribir una linea.
"""

from __future__ import annotations

import socket
import threading
from types import SimpleNamespace

import pytest

from etl.db import vigia
from etl.db.vigia import ConexionCerradaPor4D, vigilar


@pytest.fixture(autouse=True)
def _vigia_rapido(monkeypatch):
    monkeypatch.setattr(vigia, "_INTERVALO_S", 0.05)


def _conn_con_socket(sock: socket.socket):
    return SimpleNamespace(connptr=SimpleNamespace(socket=sock.fileno()))


def _como_frecv(sock: socket.socket, n: int) -> bytes:
    """El bucle de p4d: sale con error, nunca con fin de fichero."""
    leido = b""
    while len(leido) < n:
        leido += sock.recv(n - len(leido))  # b"" en EOF: vuelve a intentarlo
    return leido


def _par_tcp() -> tuple[socket.socket, socket.socket]:
    servidor = socket.create_server(("127.0.0.1", 0))
    cliente = socket.create_connection(servidor.getsockname())
    remoto, _ = servidor.accept()
    servidor.close()
    return cliente, remoto


def test_4d_cierra_a_mitad_la_lectura_no_se_queda_girando():
    cliente, remoto = _par_tcp()
    remoto.sendall(b"abc")
    remoto.close()  # 4D cierra; faltan bytes que nunca llegaran

    resultado: list[BaseException] = []

    def leer():
        try:
            with vigilar(_conn_con_socket(cliente), "SELECT X FROM Exportaciones"):
                _como_frecv(cliente, 10)
        except BaseException as exc:  # noqa: BLE001
            resultado.append(exc)

    hilo = threading.Thread(target=leer, daemon=True)
    hilo.start()
    hilo.join(timeout=5)

    assert not hilo.is_alive(), "la lectura sigue girando: el vigia no la corto"
    assert len(resultado) == 1
    assert isinstance(resultado[0], ConexionCerradaPor4D)
    # main.py reconecta y reintenta ante cualquier ConnectionError.
    assert isinstance(resultado[0], ConnectionError)
    cliente.close()


def test_4d_vivo_calculando_no_se_toca():
    cliente, remoto = _par_tcp()

    def responder_tarde():
        threading.Event().wait(0.4)  # varios intervalos del vigia sin datos
        remoto.sendall(b"0123456789")

    threading.Thread(target=responder_tarde, daemon=True).start()
    with vigilar(_conn_con_socket(cliente), "SELECT 1"):
        assert _como_frecv(cliente, 10) == b"0123456789"

    # El socket sigue siendo un socket: nadie lo sustituyo por /dev/null.
    remoto.sendall(b"z")
    assert cliente.recv(1) == b"z"
    cliente.close()
    remoto.close()


def test_fuera_del_bloque_el_vigia_no_toca_el_descriptor():
    """Cerrado por 4D pero sin nadie leyendo: el llamador decide que hacer."""
    cliente, remoto = _par_tcp()
    with vigilar(_conn_con_socket(cliente), "SELECT 1"):
        pass
    remoto.close()
    threading.Event().wait(0.3)
    assert cliente.recv(1) == b""  # fin de fichero normal, no ENOTSOCK
    cliente.close()


def test_conexion_sin_socket_pasa_sin_vigilancia():
    with vigilar(object(), "SELECT 1"):
        pass


def test_tras_el_corte_la_conexion_olvida_su_descriptor():
    """Un close() posterior no puede escribir en un descriptor reciclado."""
    cliente, remoto = _par_tcp()
    remoto.close()
    conn = _conn_con_socket(cliente)
    with pytest.raises(ConexionCerradaPor4D):
        with vigilar(conn, "SELECT 1"):
            _como_frecv(cliente, 4)
    assert conn.connptr.socket == -1
    cliente.close()
