#!/usr/bin/env bash
# Job diario de fotos: espejo + alerta de desviacion de rutas. Lo lanza launchd
# (com.powershop.fotos-sync). Ambos pasos necesitan la VPN.
#
# El chequeo de rutas corre aunque el espejo falle, y al reves: son
# independientes y cada uno deja su linea en el log. El codigo de salida es el
# peor de los dos.
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Directorio del stack (el del docker-compose.yml). En produccion los scripts
# se instalan en <stack>/scripts, asi que es el padre.
STACK_DIR="${POWERSHOP_STACK_DIR:-$(cd "$AQUI/.." && pwd)}"

echo "=== fotos-sync $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

rc=0

# Tope de reloj. Un share colgado no falla: deja a la copia esperando para siempre
# con el lock cogido, y todas las noches siguientes saldrian con "ya hay una
# sincronizacion en curso". 8 h cubre de sobra la primera copia (~1,5 h a los
# 0,75 MB/s medidos con rclone).
TOPE_S="${FOTOS_SYNC_TIMEOUT_S:-28800}"

# Se ejecuta una COPIA del script, no el original.
#
# bash lee el fichero a trozos segun avanza: si alguien actualiza
# sync-fotos.sh mientras corre —un despliegue a mitad de la primera copia, que
# dura una hora y media— los desplazamientos se mueven bajo sus pies y el
# proceso acaba con un error de sintaxis a medio camino, dejando el espejo
# incompleto y sin marcador. Paso en produccion el 2026-10-09.
# El prefijo "sync-fotos" NO es decorativo: lock_vivo() en sync-fotos.sh mira
# la linea de comandos del proceso duenno del lock y solo lo cuenta como vivo
# si encuentra *sync-fotos*. Cambiar el prefijo haria que un lock legitimo se
# considerase huerfano y dos copias corrieran a la vez.
COPIA_SCRIPT="$(mktemp -t sync-fotos)"
cp "$AQUI/sync-fotos.sh" "$COPIA_SCRIPT"
trap 'rm -f "$COPIA_SCRIPT"' EXIT

bash "$COPIA_SCRIPT" &
SYNC_PID=$!
(
    sleep "$TOPE_S"
    echo "fotos-sync: el espejo lleva mas de ${TOPE_S}s; lo corto" >&2
    kill "$SYNC_PID" 2>/dev/null
) &
VIGIA_PID=$!
wait "$SYNC_PID" || {
    echo "fotos-sync: el espejo fallo (el anterior queda intacto)" >&2
    rc=1
}
kill "$VIGIA_PID" 2>/dev/null || true

# p4d y las credenciales de 4D viven en el contenedor del ETL, no en el host.
if (cd "$STACK_DIR" && docker compose exec -T etl python - < "$AQUI/check-fotos-paths.py"); then
    :
else
    estado=$?
    echo "fotos-sync: check-fotos-paths salio con $estado (1 = hay desviaciones, 2 = no se pudo consultar)" >&2
    rc=1
fi

exit "$rc"
