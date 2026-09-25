"""Vigia de las llamadas bloqueantes al driver p4d.

El problema
-----------
`frecv()` de p4d 1.8 (`lib4d_sql/communication.c:42`) lee asi:

    do{
        iResult=recv(s,buf+rec,len-rec, 0);
        if(iResult<0) return iResult;
        else rec+=iResult;
    }while(rec<len);

Si 4D cierra la conexion a mitad de una lectura, `recv()` devuelve 0 -- fin de
fichero, no error -- y el bucle gira para siempre al 100 % de CPU. Ni
excepcion, ni log, ni timeout: `SO_RCVTIMEO` no sirve, porque un socket en
fin de fichero responde al instante.

Paso el 2026-09-24: la pasada full se quedo en la tienda 16 de `sync_stock` a
las 03:12 y el proceso estuvo 28 horas girando con el socket en CLOSE_WAIT.
Como el planificador es un solo hilo, tampoco corrio ningun delta horario: el
espejo se congelo entero.

La salida
---------
Mientras el hilo principal esta dentro del driver (con el GIL soltado: CFFI lo
suelta en cada llamada a C), un hilo aparte mira el socket cada pocos segundos
con `recv(MSG_PEEK | MSG_DONTWAIT)`. Una respuesta vacia significa que el otro
extremo cerro y que no queda nada por leer: esa lectura ya no puede terminar.

Entonces se hace `dup2(/dev/null, fd)`. El descriptor sigue existiendo -- nadie
puede reciclar el numero a medias --, pero ya no es un socket: el siguiente
`recv()` devuelve -1 (ENOTSOCK), `frecv` sale, y la llamada al driver vuelve.
Al salir del bloque vigilado se lanza `ConexionCerradaPor4D`, que es un
`ConnectionError`, asi que `_s()` en `main.py` reconecta y reintenta la tabla
como con cualquier otro socket muerto.

Solo se actua sobre descriptores registrados DENTRO de un bloque vigilado, y el
registro y la accion comparten cerrojo: fuera del bloque el hilo principal
puede cerrar la conexion y el numero puede pasar a otro socket, y el vigia no
debe tocarlo jamas.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Cada cuanto mira el vigia. Detectar un cierre tarda como mucho esto; el coste
# es un `recv` no bloqueante por conexion activa, despreciable.
_INTERVALO_S = 2.0


class ConexionCerradaPor4D(ConnectionError):
    """4D cerro la conexion a mitad de una llamada al driver.

    Es `ConnectionError` a proposito: `_es_error_de_conexion()` la reconoce y
    la tabla se reintenta sobre una conexion nueva.
    """


@dataclass
class _Vigilada:
    fd: int
    sql: str
    desde: float
    rota: bool = False


_cerrojo = threading.Lock()
_activas: dict[int, _Vigilada] = {}
_hilo: threading.Thread | None = None


def _fd_de(conn) -> int | None:
    """Descriptor del socket de una conexion p4d, o None si no lo expone."""
    fd = getattr(getattr(conn, "connptr", None), "socket", None)
    if isinstance(fd, int) and not isinstance(fd, bool) and fd >= 0:
        return fd
    return None


def _cerrado_por_el_otro_lado(fd: int) -> bool:
    """True si el socket esta en fin de fichero sin nada pendiente de leer."""
    try:
        s = socket.fromfd(fd, socket.AF_INET, socket.SOCK_STREAM)  # dup interno
    except OSError:
        return False
    try:
        return s.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b""
    except (BlockingIOError, InterruptedError):
        return False  # vivo y sin datos todavia: lo normal mientras 4D calcula
    except OSError:
        return False  # otro error: no es la firma que buscamos, no se toca
    finally:
        s.close()  # cierra el duplicado, no el original


def _romper(v: _Vigilada) -> None:
    """Sustituye el socket por /dev/null para que el `recv` del driver falle."""
    # Se marca ANTES del corte: en cuanto `dup2` vuelve, el hilo lector puede
    # recibir el error y mirar `rota` antes de que este hilo siga.
    v.rota = True
    nulo = os.open(os.devnull, os.O_RDWR)
    try:
        os.dup2(nulo, v.fd)
    finally:
        os.close(nulo)


def _vaciar_logs() -> None:
    for h in logging.getLogger().handlers:
        try:
            h.flush()
        except Exception:  # noqa: BLE001
            pass


def _olvidar_socket(conn) -> None:
    """Deja la conexion sin descriptor tras un corte.

    Tras el corte el propio driver puede cerrar el numero de descriptor (su
    siguiente `send` falla y `socket_disconnect` hace `closesocket`) sin
    olvidarlo. Si otro hilo reutiliza ese numero, el `LOGOUT` de un
    `conn.close()` posterior iria a parar a un socket ajeno. Con -1 cualquier
    operacion posterior falla con EBADF y no toca nada. Si el driver no lo
    habia cerrado, se pierde un descriptor a /dev/null: irrelevante.
    """
    try:
        conn.connptr.socket = -1
    except Exception:  # noqa: BLE001 - mejor esfuerzo
        pass


def _revisar() -> None:
    with _cerrojo:
        for v in _activas.values():
            if v.rota or not _cerrado_por_el_otro_lado(v.fd):
                continue
            # El log va ANTES del corte y se vacia: tras el `dup2` el driver
            # puede reventar (segfault) en microsegundos -- p.ej. si el cierre
            # cayo a mitad del campo de longitud de un texto, `calloc` de una
            # longitud negativa da NULL y lo escribe --, y sin esto la caida
            # volveria a no dejar ni una linea.
            logger.error(
                "vigia: 4D cerro la conexion a mitad de una lectura (%.0f s "
                "dentro); se corta el socket para que el driver no gire para "
                "siempre. SQL: %s",
                time.monotonic() - v.desde,
                v.sql[:200],
            )
            _vaciar_logs()
            _romper(v)


def _bucle() -> None:
    while True:
        time.sleep(_INTERVALO_S)
        try:
            _revisar()
        except Exception:  # noqa: BLE001 - el vigia no puede morir
            logger.exception("vigia: fallo revisando las conexiones")


def _arrancar() -> None:
    global _hilo
    if _hilo is None or not _hilo.is_alive():
        _hilo = threading.Thread(target=_bucle, name="vigia-4d", daemon=True)
        _hilo.start()


@contextmanager
def vigilar(conn, sql: str) -> Iterator[None]:
    """Vigila el socket de *conn* mientras dura el bloque.

    Si 4D cierra la conexion dentro, el vigia la corta y aqui se lanza
    `ConexionCerradaPor4D`, encadenada al error del driver si lo hubo. Una
    conexion que no expone su socket (dobles de test) pasa sin vigilancia.
    """
    fd = _fd_de(conn)
    if fd is None:
        yield
        return

    v = _Vigilada(fd=fd, sql=sql, desde=time.monotonic())
    clave = id(v)
    with _cerrojo:
        _activas[clave] = v
        _arrancar()
    try:
        yield
    except Exception as exc:
        if v.rota:
            _olvidar_socket(conn)
            raise ConexionCerradaPor4D(
                f"4D cerro la conexion a mitad de la lectura. SQL: {sql[:200]}"
            ) from exc
        raise
    finally:
        with _cerrojo:
            _activas.pop(clave, None)
    if v.rota:
        _olvidar_socket(conn)
        # El driver puede volver "bien" con un resultado corto: tras el corte
        # no hay forma de saber si lo leido esta completo.
        raise ConexionCerradaPor4D(
            f"4D cerro la conexion a mitad de la lectura. SQL: {sql[:200]}"
        )
