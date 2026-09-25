---
id: D-067
title: Toda llamada bloqueante a p4d va vigilada contra el cierre del socket
date: 2026-09-25
---

# D-067: Toda llamada bloqueante a p4d va vigilada contra el cierre del socket

*Decided: 2026-09-25*

**Context**: El 2026-09-24 a las 03:12 UTC la pasada full se quedó en la tienda 16 de `sync_stock` y el proceso del ETL estuvo 28 horas al 100 % de CPU sin escribir una línea de log. El socket de 4D estaba en `CLOSE_WAIT` (4D había cerrado su extremo) y Postgres, ocioso. Como el planificador es un único hilo, tampoco corrió ningún delta horario y el espejo entero se congeló hasta que se reinició el contenedor a mano.

La causa está en `frecv()` de p4d 1.8 (`lib4d_sql/communication.c:42`): llama a `recv()` en bucle hasta tener `len` bytes y solo sale con un retorno `< 0`. En fin de fichero `recv()` devuelve `0` al instante, así que el bucle gira sin fin. `SO_RCVTIMEO` no sirve para esto, porque un socket en fin de fichero no espera.

La misma franja (03:09–03:30 UTC, en plena lectura de `Exportaciones`) concentra además las muertes por OOM del contenedor del 2026-09-08, 09-18 y 09-23 (en `dmesg` del host Docker constan las dos últimas, a 2 GiB). Apunta a que 4D hace algo a esa hora que rompe las conexiones SQL largas; desde aquí no se ve qué.

**Decision**: Toda llamada bloqueante al driver (`execute`, `fetchall`, cada trozo de `fetchone` en la lectura troceada) va dentro de `vigilar(conn, sql)` (`etl/db/vigia.py`). Un hilo vigía mira cada 2 s los sockets que están en uso con `recv(MSG_PEEK | MSG_DONTWAIT)`. Si devuelve vacío (el otro extremo cerró y no queda nada por leer), hace `dup2(/dev/null, fd)`: el siguiente `recv()` del driver falla, `frecv` sale y el bloque lanza `ConexionCerradaPor4D` (un `ConnectionError`). A partir de ahí actúa el reintento que ya existía en `_s()`: reconecta y repite la tabla una vez.

El vigía solo toca descriptores registrados dentro de un bloque vigilado, y registro y corte comparten cerrojo. Fuera del bloque el número del descriptor puede pasar a otro socket.

**Alternatives rejected**:
- *Parchear o vendorizar p4d*: descartado ya en D-051. Además, el paquete se compila en la imagen desde PyPI.
- *Timeout global por consulta*: no hay umbral bueno, porque hay lecturas legítimas de 20 minutos (`GCLinF`). Y un hilo Python no puede interrumpir una llamada C: habría que matar el proceso.
- *`SO_RCVTIMEO` / keepalive*: no cubren el fin de fichero, que es justo este caso.

**Límites** (de la revisión del PR #982, reproducidos en C):
- El reconectar y reintentar no está garantizado. Si el cierre de 4D cae a mitad de los 4 bytes de longitud de un campo de texto, tras el corte p4d hace `calloc` con una longitud negativa, recibe NULL y escribe en él: segfault. El contenedor se reinicia (`unless-stopped`), así que nada se congela, pero esa tabla se queda sin su reintento. Por eso el vigía escribe y vacía su log ANTES del corte: la caída deja rastro.
- Tras el corte el propio driver puede cerrar el número de descriptor sin olvidarlo. `vigilar` pone `connptr.socket = -1` para que un `conn.close()` posterior nunca escriba en un descriptor reciclado.
- Un extremo que desaparece sin FIN sigue bloqueando `recv` para siempre. Esto no lo cubre; no es lo que pasó.

**Rationale**: Detectar el fin de fichero no da falsos positivos: con el otro extremo cerrado y nada en el buffer, esa lectura ya no puede terminar. Cortar con `dup2` en vez de `close` evita que el número del descriptor se recicle mientras el driver aún lo usa.

**See**: `etl/db/vigia.py`, `etl/db/fourd.py`, `etl/tests/test_vigia_socket_cerrado.py`, `docs/skills/data-access.md` (gotcha de p4d), [D-051](D-051-fetch-anomaly-guard.md).
