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
# sincronizacion en curso". 8 h cubre de sobra la primera copia (~4,6 h).
TOPE_S="${FOTOS_SYNC_TIMEOUT_S:-28800}"
bash "$AQUI/sync-fotos.sh" &
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
