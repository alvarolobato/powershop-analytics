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


# ── Silencio sin cierre (2026-11-08): el `recv` duerme, no gira ─────────────

_solo_linux = pytest.mark.skipif(
    vigia._TCP_INFO is None, reason="TCP_INFO solo existe en Linux"
)


def _leer_en_hilo(sock: socket.socket, n: int):
    resultado: list[object] = []

    def leer():
        try:
            with vigilar(_conn_con_socket(sock), "SELECT X FROM GCLinAlbaranes"):
                resultado.append(_como_frecv(sock, n))
        except BaseException as exc:  # noqa: BLE001
            resultado.append(exc)

    hilo = threading.Thread(target=leer, daemon=True)
    hilo.start()
    return hilo, resultado


def test_un_recv_dormido_se_despierta_al_cortar(monkeypatch):
    """El corte por silencio despierta un `recv` bloqueado, no solo el que gira."""
    monkeypatch.setattr(vigia, "_SILENCIO_MAX_S", 0.2)
    monkeypatch.setattr(vigia, "_silencio_s", lambda fd: 3600.0)
    cliente, remoto = _par_tcp()  # 4D vivo y mudo: no envia ni cierra

    hilo, resultado = _leer_en_hilo(cliente, 10)
    hilo.join(timeout=5)

    assert not hilo.is_alive(), "el recv sigue dormido: el corte no lo desperto"
    assert len(resultado) == 1
    assert isinstance(resultado[0], ConexionCerradaPor4D)
    cliente.close()
    remoto.close()


@_solo_linux
def test_4d_mudo_se_corta_por_silencio(monkeypatch):
    monkeypatch.setattr(vigia, "_SILENCIO_MAX_S", 0.3)
    cliente, remoto = _par_tcp()
    remoto.sendall(b"abc")  # empieza a responder y se calla

    hilo, resultado = _leer_en_hilo(cliente, 10)
    hilo.join(timeout=5)

    assert not hilo.is_alive()
    assert isinstance(resultado[0], ConexionCerradaPor4D)
    cliente.close()
    remoto.close()


@_solo_linux
def test_lectura_lenta_que_recibe_datos_no_se_corta(monkeypatch):
    """Lo que cuenta es el silencio, no lo que dura la llamada."""
    monkeypatch.setattr(vigia, "_SILENCIO_MAX_S", 0.3)
    cliente, remoto = _par_tcp()

    def gotear():
        for b in b"0123456789":  # 1 s en total, nunca 0,3 s callado
            threading.Event().wait(0.1)
            remoto.sendall(bytes([b]))

    threading.Thread(target=gotear, daemon=True).start()
    hilo, resultado = _leer_en_hilo(cliente, 10)
    hilo.join(timeout=5)

    assert resultado == [b"0123456789"]
    cliente.close()
    remoto.close()
