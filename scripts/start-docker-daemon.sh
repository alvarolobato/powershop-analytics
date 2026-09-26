#!/bin/bash
# Arranca el motor de Docker sin necesidad de sesión gráfica.
#
# EL PROBLEMA. Docker Desktop en macOS es una app de interfaz: se lanza cuando
# el usuario inicia sesión. Si el Mac se reinicia y nadie entra —que es lo
# normal en un servidor— el motor NO arranca, y con él se queda abajo todo el
# stack. Pasó el 2026-09-02: el Mac volvió del apagón, se quedó en la pantalla
# de inicio de sesión (`/dev/console` era `root`) y producción estuvo caída
# hasta que alguien lo notó.
#
# Y no se arregla desde fuera: por SSH, `open -a Docker` falla con
# "Launch failed / Domain does not support specified action", porque no hay
# sesión de interfaz a la que adjuntarse.
#
# LA SALIDA. `com.docker.backend` es el motor, y arranca sin interfaz. Es lo
# que se usó para recuperar el servicio a mano ese día, y es lo que automatiza
# este script.
#
# Los contenedores llevan `restart: unless-stopped`, así que en cuanto el motor
# responde vuelven solos: no hace falta un `compose up` aquí, y no hacerlo evita
# que este script decida por su cuenta levantar algo que alguien paró a
# propósito.
set -uo pipefail

BACKEND="/Applications/Docker.app/Contents/MacOS/com.docker.backend"
ESPERA_MAX=180   # segundos

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

if [ ! -x "$BACKEND" ]; then
  log "ERROR: no existe $BACKEND — ¿está instalado Docker Desktop?"
  exit 1
fi

if docker info >/dev/null 2>&1; then
  log "el motor ya responde; no hay nada que hacer"
  exit 0
fi

log "el motor no responde; arrancando $BACKEND"
"$BACKEND" >/dev/null 2>&1 &

for _ in $(seq 1 $((ESPERA_MAX / 5))); do
  sleep 5
  if docker info >/dev/null 2>&1; then
    log "motor arriba"
    # Los contenedores con `unless-stopped` vuelven solos, pero tardan: se
    # espera a que aparezca alguno para dejar constancia en el log de que la
    # recuperación llegó hasta el final.
    for _ in $(seq 1 12); do
      n=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
      if [ "${n:-0}" -gt 0 ]; then
        log "$n contenedor(es) en marcha"
        exit 0
      fi
      sleep 5
    done
    log "AVISO: el motor arrancó pero no hay contenedores tras 60 s"
    exit 0
  fi
done

log "ERROR: el motor no respondió en ${ESPERA_MAX}s"
exit 1
